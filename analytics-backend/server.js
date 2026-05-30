const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Enable CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Database connection pool
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("FATAL ERROR: DATABASE_URL environment variable is missing.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: {
    rejectUnauthorized: false // Required for Render Postgres connections
  }
});

// Helper to sanitize database names and ensure our schema and tables exist safely
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log("Initializing database schema...");
    
    // Create an isolated schema for analytics so we never touch the default 'public' schema tables
    await client.query("CREATE SCHEMA IF NOT EXISTS analytics;");
    
    // Create or update the visits table
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.visits (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        page_path VARCHAR(255) NOT NULL,
        referrer VARCHAR(512),
        session_hash VARCHAR(64) NOT NULL,
        country VARCHAR(10) DEFAULT 'Unknown',
        browser VARCHAR(50) DEFAULT 'Other',
        device VARCHAR(20) DEFAULT 'Desktop',
        is_bot BOOLEAN DEFAULT FALSE
      );
    `);

    // Perform safe schema migrations (add new columns if they do not exist)
    await client.query("ALTER TABLE analytics.visits ADD COLUMN IF NOT EXISTS persistent_hash VARCHAR(64);");
    await client.query("ALTER TABLE analytics.visits ADD COLUMN IF NOT EXISTS duration INTEGER DEFAULT 0;");
    await client.query("ALTER TABLE analytics.visits ADD COLUMN IF NOT EXISTS max_scroll INTEGER DEFAULT 0;");

    // Create the events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics.events (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        visit_id INTEGER REFERENCES analytics.visits(id) ON DELETE CASCADE,
        event_name VARCHAR(100) NOT NULL,
        event_value VARCHAR(255)
      );
    `);

    // Create indexes for efficient dashboard queries
    await client.query("CREATE INDEX IF NOT EXISTS idx_visits_timestamp ON analytics.visits(timestamp);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_visits_is_bot ON analytics.visits(is_bot);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_visits_persistent_hash ON analytics.visits(persistent_hash);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_events_visit_id ON analytics.visits(id);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_events_event_name ON analytics.events(event_name);");

    console.log("Database initialized successfully.");
  } catch (err) {
    console.error("Error initializing database:", err);
  } finally {
    client.release();
  }
}

// User-Agent parser utility
function parseUserAgent(uaString) {
  if (!uaString) {
    return { browser: 'Other', device: 'Desktop', isBot: false };
  }

  const ua = uaString.toLowerCase();
  
  // Check for common bots / crawlers / scrapers
  const botPatterns = [
    'bot', 'crawler', 'spider', 'slurp', 'lighthouse', 'chrome-lighthouse',
    'google', 'baidu', 'yandex', 'duckduckgo', 'ia_archiver', 'curl', 'wget',
    'python', 'postman', 'node-fetch', 'axios', 'headless'
  ];
  const isBot = botPatterns.some(pattern => ua.includes(pattern));

  // Determine device
  let device = 'Desktop';
  if (ua.includes('ipad') || (ua.includes('macintosh') && 'ontouchend' in {})) {
    device = 'Tablet';
  } else if (ua.includes('mobi') || ua.includes('android') || ua.includes('iphone')) {
    device = 'Mobile';
  }

  // Determine browser
  let browser = 'Other';
  if (ua.includes('edg/')) {
    browser = 'Edge';
  } else if (ua.includes('opr/') || ua.includes('opera')) {
    browser = 'Opera';
  } else if (ua.includes('chrome') && !ua.includes('chromium')) {
    browser = 'Chrome';
  } else if (ua.includes('firefox')) {
    browser = 'Firefox';
  } else if (ua.includes('safari') && !ua.includes('chrome')) {
    browser = 'Safari';
  } else if (ua.includes('msie') || ua.includes('trident/')) {
    browser = 'Internet Explorer';
  }

  return { browser, device, isBot };
}

// Session Hash generator (IP + UA + Date + Salt) to protect PII
function generateSessionHash(ip, ua, salt = '') {
  const today = new Date().toISOString().split('T')[0]; // Reset session hash every 24h
  const data = `${ip}-${ua}-${today}-${salt}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Persistent Cookieless Hash generator (IP + UA + Salt) to track returning visitors across days
function generatePersistentHash(ip, ua, salt = '') {
  const data = `${ip}-${ua}-${salt}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// --- TRACKING ENDPOINT ---
app.post('/api/track', async (req, res) => {
  const { page_path, referrer } = req.body;

  if (!page_path) {
    return res.status(400).json({ error: 'page_path is required' });
  }

  try {
    // 1. Resolve IP address (handling proxies like Render / Cloudflare)
    const ip = req.headers['cf-connecting-ip'] || 
               (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
               req.socket.remoteAddress || 
               '127.0.0.1';

    // 2. Resolve Country (Cloudflare cf-ipcountry header passed through Render)
    const country = req.headers['cf-ipcountry'] || 'Unknown';

    // 3. Parse User-Agent
    const uaString = req.headers['user-agent'] || '';
    const { browser, device, isBot } = parseUserAgent(uaString);

    // 4. Generate privacy-safe daily session hash and persistent cross-day hash
    const salt = process.env.SALT || 'dunes-secure-salt';
    const sessionHash = generateSessionHash(ip, uaString, salt);
    const persistentHash = generatePersistentHash(ip, uaString, salt);

    // 5. Insert visit into Postgres and return the row ID
    const query = `
      INSERT INTO analytics.visits (page_path, referrer, session_hash, persistent_hash, country, browser, device, is_bot)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    const cleanReferrer = referrer ? referrer.substring(0, 512) : null;
    const cleanPath = page_path.substring(0, 255);

    const result = await pool.query(query, [cleanPath, cleanReferrer, sessionHash, persistentHash, country, browser, device, isBot]);
    const visitId = result.rows[0].id;

    res.status(200).json({ success: true, visit_id: visitId });
  } catch (err) {
    console.error("Error logging visit:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- SESSION UPDATE ENDPOINT (Duration & Scroll Depth) ---
app.post('/api/update', async (req, res) => {
  const { visit_id, duration, max_scroll } = req.body;

  if (!visit_id) {
    return res.status(400).json({ error: 'visit_id is required' });
  }

  try {
    const query = `
      UPDATE analytics.visits
      SET duration = GREATEST(duration, $1),
          max_scroll = GREATEST(max_scroll, $2)
      WHERE id = $3
    `;
    const cleanDuration = parseInt(duration, 10) || 0;
    const cleanScroll = parseInt(max_scroll, 10) || 0;

    await pool.query(query, [cleanDuration, cleanScroll, visit_id]);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error updating session metrics:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- CUSTOM EVENT LOGGING ENDPOINT ---
app.post('/api/event', async (req, res) => {
  const { visit_id, event_name, event_value } = req.body;

  if (!visit_id || !event_name) {
    return res.status(400).json({ error: 'visit_id and event_name are required' });
  }

  try {
    const query = `
      INSERT INTO analytics.events (visit_id, event_name, event_value)
      VALUES ($1, $2, $3)
    `;
    const cleanName = event_name.substring(0, 100);
    const cleanVal = event_value ? event_value.substring(0, 255) : null;

    await pool.query(query, [visit_id, cleanName, cleanVal]);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error logging custom event:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- SECURITY MIDDLEWARE FOR STATS ---
function checkAuth(req, res, next) {
  const password = process.env.DASHBOARD_PASSWORD || 'admin123';
  
  // Accept token in Authorization header or in the 'pwd' query parameter
  const authHeader = req.headers['authorization'];
  const queryPwd = req.query.pwd;
  
  let incomingToken = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    incomingToken = authHeader.split(' ')[1];
  } else if (queryPwd) {
    incomingToken = queryPwd;
  }

  if (incomingToken === password) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Invalid dashboard password.' });
  }
}

// --- STATS ENDPOINT FOR THE DASHBOARD ---
app.get('/api/stats', checkAuth, async (req, res) => {
  const timeframe = req.query.timeframe || '30'; // Timeframe in days
  const daysLimit = parseInt(timeframe, 10) || 30;

  try {
    // 1. Traffic over time (Page views & Unique visitors per day)
    const trafficQuery = `
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as page_views,
        COUNT(DISTINCT session_hash) as unique_visitors
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY DATE(timestamp)
      ORDER BY DATE(timestamp) ASC;
    `;

    // 2. Top Pages
    const pagesQuery = `
      SELECT page_path, COUNT(*) as views
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY page_path
      ORDER BY views DESC
      LIMIT 10;
    `;

    // 3. Top Referrers
    const referrersQuery = `
      SELECT COALESCE(referrer, 'Direct / Bookmark') as referrer_source, COUNT(*) as views
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY referrer_source
      ORDER BY views DESC
      LIMIT 10;
    `;

    // 4. Top Countries
    const countriesQuery = `
      SELECT country, COUNT(*) as views, COUNT(DISTINCT session_hash) as uniques
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY country
      ORDER BY views DESC
      LIMIT 15;
    `;

    // 5. Devices & Browsers breakdown
    const devicesQuery = `
      SELECT device, COUNT(*) as views
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY device;
    `;

    const browsersQuery = `
      SELECT browser, COUNT(*) as views
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
      GROUP BY browser;
    `;

    // 6. Bot Breakdown
    const botsQuery = `
      SELECT is_bot, COUNT(*) as views
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days'
      GROUP BY is_bot;
    `;

    // 7. Average Duration (Time spent on page)
    const durationQuery = `
      SELECT COALESCE(ROUND(AVG(duration)), 0) as avg_duration
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE AND duration > 0;
    `;

    // 8. Bounce Rate
    const bounceQuery = `
      WITH session_counts AS (
        SELECT session_hash, COUNT(*) as page_views, MAX(duration) as max_dur
        FROM analytics.visits
        WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE
        GROUP BY session_hash
      )
      SELECT 
        COUNT(*) as total_sessions,
        SUM(CASE WHEN page_views = 1 AND max_dur < 12 THEN 1 ELSE 0 END) as bounced_sessions
      FROM session_counts;
    `;

    // 9. Scroll Depth Breakdown
    const scrollQuery = `
      SELECT 
        SUM(CASE WHEN max_scroll >= 25 THEN 1 ELSE 0 END) as scroll_25,
        SUM(CASE WHEN max_scroll >= 50 THEN 1 ELSE 0 END) as scroll_50,
        SUM(CASE WHEN max_scroll >= 75 THEN 1 ELSE 0 END) as scroll_75,
        SUM(CASE WHEN max_scroll >= 100 THEN 1 ELSE 0 END) as scroll_100,
        COUNT(*) as total_visits
      FROM analytics.visits
      WHERE timestamp >= NOW() - INTERVAL '${daysLimit} days' AND is_bot = FALSE;
    `;

    // 10. New vs. Returning Visitors
    const visitorTypeQuery = `
      WITH first_visits AS (
        SELECT persistent_hash, MIN(DATE(timestamp)) as first_date
        FROM analytics.visits
        WHERE is_bot = FALSE
        GROUP BY persistent_hash
      ),
      visit_types AS (
        SELECT 
          v.id,
          CASE WHEN DATE(v.timestamp) > f.first_date THEN 'Returning' ELSE 'New' END as visitor_type
        FROM analytics.visits v
        JOIN first_visits f ON v.persistent_hash = f.persistent_hash
        WHERE v.timestamp >= NOW() - INTERVAL '${daysLimit} days' AND v.is_bot = FALSE
      )
      SELECT visitor_type, COUNT(*) as count
      FROM visit_types
      GROUP BY visitor_type;
    `;

    // 11. Custom Events Aggregated (for Conversion Funnel)
    const eventsQuery = `
      SELECT event_name, COUNT(*) as count
      FROM analytics.events e
      JOIN analytics.visits v ON e.visit_id = v.id
      WHERE e.timestamp >= NOW() - INTERVAL '${daysLimit} days' AND v.is_bot = FALSE
      GROUP BY event_name;
    `;

    // 12. FAQ Interest Breakdown
    const faqQuery = `
      SELECT event_value as faq_question, COUNT(*) as count
      FROM analytics.events e
      JOIN analytics.visits v ON e.visit_id = v.id
      WHERE e.timestamp >= NOW() - INTERVAL '${daysLimit} days' 
        AND e.event_name = 'faq_expanded' AND v.is_bot = FALSE
      GROUP BY event_value
      ORDER BY count DESC
      LIMIT 5;
    `;

    // Run all database queries in parallel
    const [
      trafficRes,
      pagesRes,
      referrersRes,
      countriesRes,
      devicesRes,
      browsersRes,
      botsRes,
      durationRes,
      bounceRes,
      scrollRes,
      visitorTypeRes,
      eventsRes,
      faqRes
    ] = await Promise.all([
      pool.query(trafficQuery),
      pool.query(pagesQuery),
      pool.query(referrersQuery),
      pool.query(countriesQuery),
      pool.query(devicesQuery),
      pool.query(browsersQuery),
      pool.query(botsQuery),
      pool.query(durationQuery),
      pool.query(bounceQuery),
      pool.query(scrollQuery),
      pool.query(visitorTypeQuery),
      pool.query(eventsQuery),
      pool.query(faqQuery)
    ]);

    // Parse bots breakdown safely
    let humanViews = 0;
    let botViews = 0;
    botsRes.rows.forEach(row => {
      if (row.is_bot) botViews = parseInt(row.views, 10);
      else humanViews = parseInt(row.views, 10);
    });

    // Parse bounce rate safely
    const totalSessions = parseInt(bounceRes.rows[0].total_sessions, 10) || 0;
    const bouncedSessions = parseInt(bounceRes.rows[0].bounced_sessions, 10) || 0;
    const bounceRate = totalSessions > 0 ? Math.round((bouncedSessions / totalSessions) * 100) : 0;

    res.json({
      summary: {
        total_views: humanViews,
        bot_views: botViews,
        unique_visitors: trafficRes.rows.reduce((sum, r) => sum + parseInt(r.unique_visitors, 10), 0),
        avg_duration: parseInt(durationRes.rows[0].avg_duration, 10) || 0,
        bounce_rate: bounceRate
      },
      traffic: trafficRes.rows,
      pages: pagesRes.rows,
      referrers: referrersRes.rows,
      countries: countriesRes.rows,
      devices: devicesRes.rows,
      browsers: browsersRes.rows,
      scroll: scrollRes.rows[0] || { scroll_25: 0, scroll_50: 0, scroll_75: 0, scroll_100: 0, total_visits: 0 },
      visitor_types: visitorTypeRes.rows,
      events: eventsRes.rows,
      faq: faqRes.rows
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- DATABASE RESET ENDPOINT ---
app.all('/api/reset', checkAuth, async (req, res) => {
  try {
    console.log("Database reset requested. Executing safe table truncation...");
    
    // Clear the events first to satisfy foreign key constraints, then clear visits
    await pool.query("DELETE FROM analytics.events;");
    await pool.query("DELETE FROM analytics.visits;");
    
    res.status(200).json({ success: true, message: 'All telemetry statistics cleared successfully. You can now start monitoring fresh traffic!' });
  } catch (err) {
    console.error("Error resetting database:", err);
    res.status(500).json({ error: 'Internal server error during database reset.' });
  }
});

// --- SERVE THE ADMIN DASHBOARD PAGE ---
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Initialize DB and start server
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Dunes Analytics Backend running on port ${PORT}`);
    
    // Automated Self-Pinging to keep the Render free tier awake 24/7
    const selfUrl = process.env.RENDER_EXTERNAL_URL || process.env.SELF_URL;
    if (selfUrl) {
      const pingerInterval = 10 * 60 * 1000; // 10 minutes
      
      // Delay the first ping by 10 minutes
      setInterval(() => {
        const url = `${selfUrl.replace(/\/$/, '')}/health`;
        console.log(`Self-pinging to keep awake: ${url}`);
        
        const lib = url.startsWith('https') ? require('https') : require('http');
        lib.get(url, (res) => {
          console.log(`Self-ping status: ${res.statusCode}`);
        }).on('error', (err) => {
          console.error('Self-ping error:', err.message);
        });
      }, pingerInterval);
      
      console.log(`Self-pinging activated for: ${selfUrl} (every 10m)`);
    } else {
      console.log("Self-pinging inactive: RENDER_EXTERNAL_URL environment variable not set.");
    }
  });
});

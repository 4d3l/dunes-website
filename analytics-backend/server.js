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
    
    // Create the visits table
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

    // Create indexes for efficient dashboard queries
    await client.query("CREATE INDEX IF NOT EXISTS idx_visits_timestamp ON analytics.visits(timestamp);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_visits_is_bot ON analytics.visits(is_bot);");

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

    // 4. Generate a privacy-safe session hash (Salted with PORT to have a server-specific variable)
    const salt = process.env.SALT || 'dunes-secure-salt';
    const sessionHash = generateSessionHash(ip, uaString, salt);

    // 5. Insert visit into Postgres
    const query = `
      INSERT INTO analytics.visits (page_path, referrer, session_hash, country, browser, device, is_bot)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    // Clean up referrer length to fit 512 limit
    const cleanReferrer = referrer ? referrer.substring(0, 512) : null;
    const cleanPath = page_path.substring(0, 255);

    await pool.query(query, [cleanPath, cleanReferrer, sessionHash, country, browser, device, isBot]);

    res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error logging visit:", err);
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

    // Run all database queries in parallel
    const [
      trafficRes,
      pagesRes,
      referrersRes,
      countriesRes,
      devicesRes,
      browsersRes,
      botsRes
    ] = await Promise.all([
      pool.query(trafficQuery),
      pool.query(pagesQuery),
      pool.query(referrersQuery),
      pool.query(countriesQuery),
      pool.query(devicesQuery),
      pool.query(browsersQuery),
      pool.query(botsQuery)
    ]);

    // Parse bots breakdown safely
    let humanViews = 0;
    let botViews = 0;
    botsRes.rows.forEach(row => {
      if (row.is_bot) botViews = parseInt(row.views, 10);
      else humanViews = parseInt(row.views, 10);
    });

    res.json({
      summary: {
        total_views: humanViews,
        bot_views: botViews,
        unique_visitors: trafficRes.rows.reduce((sum, r) => sum + parseInt(r.unique_visitors, 10), 0)
      },
      traffic: trafficRes.rows,
      pages: pagesRes.rows,
      referrers: referrersRes.rows,
      countries: countriesRes.rows,
      devices: devicesRes.rows,
      browsers: browsersRes.rows
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: 'Internal server error' });
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

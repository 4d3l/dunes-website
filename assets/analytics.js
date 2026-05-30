(function() {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const currentScript = document.currentScript;
  const apiHost = currentScript ? currentScript.getAttribute('data-host') : '';

  if (!apiHost) {
    console.warn("Dunes Analytics: data-host attribute is missing on the script tag.");
    return;
  }

  // Avoid logging local dev visits unless explicitly desired
  if (isLocal && !currentScript.hasAttribute('data-track-local')) {
    console.log("Dunes Analytics: Skipping tracking on local development server.");
    return;
  }

  // Session State Variables
  let visitId = null;
  const startTime = Date.now();
  let maxScroll = 0;
  let sentScrollThresholds = new Set();
  
  // Track scroll depth and send update on crossing thresholds
  const scrollThresholds = [25, 50, 75, 100];

  function getDuration() {
    return Math.round((Date.now() - startTime) / 1000);
  }

  // --- 1. TRACK VISIT AND RECORD VISIT ID ---
  function trackPageView() {
    try {
      const page_path = window.location.pathname || '/';
      if (page_path.includes('/dashboard')) return;

      const payload = {
        page_path: page_path,
        referrer: document.referrer || null
      };

      fetch(`${apiHost}/api/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      })
      .then(res => res.json())
      .then(data => {
        if (data && data.visit_id) {
          visitId = data.visit_id;
          console.log(`Dunes Analytics: Visit registered (ID: ${visitId})`);
          
          // Once visitId is acquired, initialize event trackers
          initEventListeners();
        }
      })
      .catch(err => console.debug("Dunes Analytics: Track failed:", err));
    } catch (e) {
      console.debug("Dunes Analytics error:", e);
    }
  }

  // --- 2. UPDATE SESSION (Duration & Scroll Depth) ---
  function updateSession(isFinal = false) {
    if (!visitId) return;

    try {
      const payload = {
        visit_id: visitId,
        duration: getDuration(),
        max_scroll: maxScroll
      };

      fetch(`${apiHost}/api/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true // Crucial to ensure completion during page unload/exit
      })
      .catch(err => console.debug("Dunes Analytics: Update failed:", err));
    } catch (e) {
      console.debug("Dunes Analytics update error:", e);
    }
  }

  // --- 3. TRACK CUSTOM ACTION EVENTS ---
  function trackEvent(name, value = null) {
    if (!visitId) return;

    try {
      const payload = {
        visit_id: visitId,
        event_name: name,
        event_value: value
      };

      fetch(`${apiHost}/api/event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      })
      .catch(err => console.debug(`Dunes Analytics: Event '${name}' failed:`, err));
    } catch (e) {
      console.debug("Dunes Analytics event error:", e);
    }
  }

  // --- 4. SCROLL DEPTH MONITORING (Throttled) ---
  let scrollTimeout;
  function handleScroll() {
    if (scrollTimeout) return;

    scrollTimeout = setTimeout(() => {
      scrollTimeout = null;

      try {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        const scrollPercent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;

        // Check if any thresholds were crossed
        scrollThresholds.forEach(threshold => {
          if (scrollPercent >= threshold && !sentScrollThresholds.has(threshold)) {
            sentScrollThresholds.add(threshold);
            maxScroll = Math.max(maxScroll, threshold);
            
            // Log scroll depth update
            updateSession();
          }
        });
      } catch (e) {
        console.debug("Scroll tracking error:", e);
      }
    }, 200); // Check scroll depth every 200ms
  }

  // --- 5. BIND TRIGGERS & CLICK EVENTS ---
  function initEventListeners() {
    try {
      // A. Track primary APK downloads (direct APK files)
      document.querySelectorAll('a[href*=".apk"]').forEach(link => {
        link.addEventListener('click', () => {
          trackEvent('click_download_apk', link.getAttribute('href'));
        });
      });

      // B. Track click to "Get Dunes" or scroll intent
      document.querySelectorAll('a[href="#download"]').forEach(link => {
        link.addEventListener('click', () => {
          trackEvent('click_download_intent');
        });
      });

      // C. Track clicks to "Sideload Guide"
      const sideloadBtn = document.getElementById('btn-sideload-guide');
      if (sideloadBtn) {
        sideloadBtn.addEventListener('click', () => {
          trackEvent('click_sideload_guide');
        });
      }

      // D. Track FAQ expansion clicks (analyzes user pain-points)
      document.querySelectorAll('.faq-question').forEach(question => {
        question.addEventListener('click', () => {
          const faqItem = question.parentElement;
          // Check if it is currently expanding (i.e. is not active yet)
          const isExpanding = !faqItem.classList.contains('active');
          
          if (isExpanding) {
            const questionText = question.querySelector('span') ? question.querySelector('span').innerText : question.innerText;
            trackEvent('faq_expanded', questionText.trim());
          }
        });
      });
    } catch (e) {
      console.debug("Error binding click events:", e);
    }
  }

  // Initialize trackers
  if (document.readyState === 'complete') {
    trackPageView();
  } else {
    window.addEventListener('load', trackPageView);
  }

  // Bind scroll monitor
  window.addEventListener('scroll', handleScroll);

  // Interval updates: Send heartbeat every 15s to keep session alive and record time
  setInterval(() => {
    updateSession();
  }, 15000);

  // Tab Close / Page Unload Beacons: Send final session duration and scroll depth
  window.addEventListener('pagehide', () => updateSession(true));
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      updateSession(true);
    }
  });
})();

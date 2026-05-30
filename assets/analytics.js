(function() {
  // Prevent tracking during local development unless explicitly desired
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  
  // Find the currently running script tag to extract configuration
  const currentScript = document.currentScript;
  const apiHost = currentScript ? currentScript.getAttribute('data-host') : '';

  if (!apiHost) {
    console.warn("Dunes Analytics: data-host attribute is missing on the script tag.");
    return;
  }

  // Avoid logging visits from local test servers to keep database clean
  if (isLocal && !currentScript.hasAttribute('data-track-local')) {
    console.log("Dunes Analytics: Skipping tracking on local development server.");
    return;
  }

  function trackPageView() {
    try {
      const page_path = window.location.pathname || '/';
      
      // Do not log the admin dashboard itself in case it is loaded
      if (page_path.includes('/dashboard')) return;

      const payload = {
        page_path: page_path,
        referrer: document.referrer || null
      };

      // Send telemetry using fetch with keepalive to ensure request completes even if page changes
      fetch(`${apiHost}/api/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true // Highly robust: keeps request active during page navigation
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
      })
      .catch(error => {
        // Silently catch errors so the website user experience is never impacted
        console.debug("Dunes Analytics Telemetry failed:", error);
      });
    } catch (e) {
      console.debug("Dunes Analytics error:", e);
    }
  }

  // Run immediately on page load
  if (document.readyState === 'complete') {
    trackPageView();
  } else {
    window.addEventListener('load', trackPageView);
  }
})();

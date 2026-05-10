const { chromium } = require('playwright');

// Known tracker domains for classification
const TRACKER_DB = {
  advertising: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'facebook.net', 'facebook.com', 'fbcdn.net', 'ads-twitter.com',
    'tiktok.com', 'byteoversea.com', 'criteo.com', 'outbrain.com',
    'taboola.com', 'amazon-adsystem.com', 'bing.com', 'linkedin.com',
    'snap.com', 'pinterest.com', 'reddit.com', 'adroll.com'
  ],
  analytics: [
    'google-analytics.com', 'googletagmanager.com', 'analytics.google.com',
    'hotjar.com', 'mixpanel.com', 'segment.com', 'amplitude.com',
    'heap.io', 'fullstory.com', 'mouseflow.com', 'clarity.ms',
    'newrelic.com', 'sentry.io', 'logrocket.com', 'piwik.pro'
  ],
  fingerprinting: [
    'fingerprintjs.com', 'iovation.com', 'threatmetrix.com'
  ]
};

function classifyCookie(name, domain) {
  const nameLower = name.toLowerCase();
  const domainLower = (domain || '').toLowerCase();

  // Check domain against tracker DB
  for (const [category, domains] of Object.entries(TRACKER_DB)) {
    if (domains.some(d => domainLower.includes(d))) return category;
  }

  // Heuristic classification by cookie name
  if (/^(_ga|_gid|_gat|__utm|_gcl)/.test(nameLower)) return 'analytics';
  if (/^(_fb|_fbc|_fbp|fbp|fbq|fr)$/i.test(nameLower)) return 'advertising';
  if (/^(IDE|MUID|NID|ANID|APISID|SAPISID)$/i.test(nameLower)) return 'advertising';
  if (/sess|csrf|token|auth|login|sid/i.test(nameLower)) return 'essential';
  if (/consent|cookie|gdpr|ccpa/i.test(nameLower)) return 'essential';

  // Functional cookies (user preferences)
  if (/theme|color.?mode|dark.?mode|locale|lang|language|tz|timezone|preferred|bucket|device|screen|viewport/i.test(nameLower)) return 'essential';

  return 'unknown';
}

function classifyScript(domain) {
  for (const [category, domains] of Object.entries(TRACKER_DB)) {
    if (domains.some(d => domain.includes(d))) return category;
  }
  return 'unknown';
}

async function auditCookies(targetUrl, apiKey, sendProgress) {
  sendProgress('connecting', 'Connecting to stealth browser...');

  let browser;
  try {
    browser = await chromium.connectOverCDP(
      'wss://api.anakin.io/v1/browser-connect',
      { headers: { 'X-API-Key': apiKey }, timeout: 60000 }
    );

    const page = browser.contexts()[0].pages()[0];
    sendProgress('cookies', `Navigating to ${targetUrl}...`);

    // Navigate to target
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    sendProgress('cookies', 'Waiting for trackers and CMP to initialize...');
    await page.waitForTimeout(6000); // Wait longer for iframes and CMPs to inject the banner

    // --- BEFORE REJECTION: Extract everything ---
    sendProgress('cookies', 'Extracting cookies & trackers before interaction...');

    const beforeData = await page.evaluate(() => {
      // Parse document.cookie
      const cookies = document.cookie.split(';')
        .map(c => c.trim())
        .filter(c => c.length > 0)
        .map(c => {
          const [name, ...rest] = c.split('=');
          return { name: name.trim(), value: rest.join('=').substring(0, 50) };
        });

      // Get localStorage keys
      const localStorageKeys = Object.keys(localStorage);

      // Get all external scripts
      const scripts = Array.from(document.querySelectorAll('script[src]')).map(s => {
        try {
          const url = new URL(s.src);
          return { src: s.src, domain: url.hostname };
        } catch { return { src: s.src, domain: 'unknown' }; }
      });

      // Get tracking pixels (tiny images)
      const pixels = Array.from(document.querySelectorAll('img')).filter(img => {
        return (img.naturalWidth <= 2 && img.naturalHeight <= 2) ||
               (img.width <= 2 && img.height <= 2) ||
               /pixel|track|beacon|analytics/i.test(img.src);
      }).map(img => {
        try {
          return { src: img.src, domain: new URL(img.src).hostname };
        } catch { return { src: img.src, domain: 'unknown' }; }
      });

      // Get third-party iframes
      const iframes = Array.from(document.querySelectorAll('iframe')).map(f => {
        try {
          return { src: f.src, domain: new URL(f.src).hostname };
        } catch { return { src: f.src || 'about:blank', domain: 'unknown' }; }
      }).filter(f => f.domain !== 'unknown' && f.src !== 'about:blank');

      return { cookies, localStorageKeys, scripts, pixels, iframes };
    });

    // --- TRY TO FIND AND CLICK REJECT ---
    sendProgress('cookies', 'Looking for cookie banner...');

    let bannerFound = false;
    let rejectFound = false;
    let buttonText = null;

    try {
      const rejectRegex = /^(reject all|decline all|deny all|refuse all|reject|decline|deny|refuse|essential only|necessary only|essential cookies only|only necessary|only essential)$/i;
      const looseRejectRegex = /(reject all|decline all|deny all|refuse all|essential only|essential cookies|necessary only|only necessary|manage preferences|cookie settings)/i;
      
      let targetBtn = null;

      // 1. Check main frame first
      const mainBtns = page.locator('button, a[role="button"], [role="button"]');
      let count = await mainBtns.count();
      for (let i = 0; i < count; i++) {
        const text = (await mainBtns.nth(i).textContent()) || '';
        if (rejectRegex.test(text.trim()) || looseRejectRegex.test(text.trim())) {
          targetBtn = mainBtns.nth(i);
          break;
        }
      }

      // 2. If not found, check inside all iframes (crucial for Sourcepoint/TrustArc)
      if (!targetBtn) {
        for (const frame of page.frames()) {
          const frameBtns = frame.locator('button, a[role="button"], [role="button"]');
          const frameCount = await frameBtns.count().catch(() => 0);
          for (let i = 0; i < frameCount; i++) {
            const text = (await frameBtns.nth(i).textContent().catch(() => '')) || '';
            if (rejectRegex.test(text.trim()) || looseRejectRegex.test(text.trim())) {
              targetBtn = frameBtns.nth(i);
              break;
            }
          }
          if (targetBtn) break;
        }
      }

      // 3. Fallback check if banner exists but no reject button
      // Check main DOM for banner elements AND CMP iframe containers
      bannerFound = await page.evaluate(() => {
        // Standard banner selectors
        const bannerSel = '[class*="cookie"], [id*="cookie"], [class*="consent"], [class*="onetrust"], [id*="onetrust"]';
        if (document.querySelector(bannerSel)) return true;
        
        // Sourcepoint: injects an iframe with id like "sp_message_iframe_XXXXX" 
        // and a container div with class "sp_message_container"
        if (document.querySelector('iframe[id*="sp_message"]')) return true;
        if (document.querySelector('[class*="sp_message"]')) return true;
        if (document.querySelector('div[id*="sp_message"]')) return true;
        
        // TrustArc, Quantcast, generic CMP containers
        if (document.querySelector('#truste-consent-track, .qc-cmp2-container, [id*="consent-banner"]')) return true;
        
        // Also check for any visible overlay/modal that looks like a consent popup
        const overlays = document.querySelectorAll('[class*="privacy"], [id*="privacy"], [class*="gdpr"], [id*="gdpr"]');
        for (const o of overlays) {
          const rect = o.getBoundingClientRect();
          if (rect.height > 50 && rect.width > 100) return true;
        }
        
        return false;
      }).catch(() => false);

      if (targetBtn) {
        bannerFound = true;
        rejectFound = true;
        buttonText = (await targetBtn.textContent() || 'Reject').trim();
        
        // Playwright executes a real trusted click event
        await targetBtn.click({ force: true, timeout: 5000 });
        sendProgress('cookies', `Clicked "${buttonText}" — waiting 3s...`);
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log('Banner click error:', e.message);
    }

    const bannerResult = { bannerFound, rejectFound, buttonText };

    // --- AFTER REJECTION: Extract cookies again ---
    sendProgress('cookies', 'Extracting cookies after rejection...');

    const afterCookies = await page.evaluate(() => {
      return document.cookie.split(';')
        .map(c => c.trim())
        .filter(c => c.length > 0)
        .map(c => {
          const [name, ...rest] = c.split('=');
          return { name: name.trim(), value: rest.join('=').substring(0, 50) };
        });
    });

    // Take screenshot
    // (Moved to before interaction)

    await browser.close();

    // --- CLASSIFY & BUILD RESULT ---
    const siteDomain = new URL(targetUrl).hostname;
    // Extract brand name for first-party matching
    // e.g. "github.com" -> "github", "www.skysports.com" -> "skysports"
    const domainParts = siteDomain.replace('www.', '').split('.');
    const brandName = domainParts.length >= 2 ? domainParts[domainParts.length - 2] : domainParts[0];

    const classifiedBefore = beforeData.cookies.map(c => ({
      ...c,
      category: classifyCookie(c.name, siteDomain),
      isFirstParty: true
    }));

    const classifiedAfter = afterCookies.map(c => ({
      ...c,
      category: classifyCookie(c.name, siteDomain),
      isFirstParty: true
    }));

    // Filter scripts: exclude first-party by checking if domain contains the brand name
    const classifiedScripts = beforeData.scripts
      .filter(s => !s.domain.toLowerCase().includes(brandName.toLowerCase()))
      .map(s => ({ ...s, category: classifyScript(s.domain) }));

    const beforeNames = new Set(classifiedBefore.map(c => c.name));
    const afterNames = new Set(classifiedAfter.map(c => c.name));
    const removedCookies = [...beforeNames].filter(n => !afterNames.has(n));
    const addedCookies = [...afterNames].filter(n => !beforeNames.has(n));

    const categoryCounts = { essential: 0, analytics: 0, advertising: 0, fingerprinting: 0, unknown: 0 };
    classifiedBefore.forEach(c => categoryCounts[c.category] = (categoryCounts[c.category] || 0) + 1);

    return {
      url: targetUrl,
      cookies: {
        before_reject: classifiedBefore,
        after_reject: classifiedAfter,
        before_count: classifiedBefore.length,
        after_count: classifiedAfter.length,
        removed: removedCookies,
        added_after_reject: addedCookies,
        categories: categoryCounts
      },
      scripts: classifiedScripts,
      tracking_pixels: beforeData.pixels,
      iframes: beforeData.iframes,
      localStorage_keys: beforeData.localStorageKeys,
      cookie_banner_found: bannerResult.bannerFound,
      reject_button_found: bannerResult.rejectFound,
      reject_button_text: bannerResult.buttonText
    };

  } catch (error) {
    if (browser) try { await browser.close(); } catch {}
    throw new Error(`Cookie audit failed: ${error.message}`);
  }
}

module.exports = { auditCookies, classifyCookie, classifyScript, TRACKER_DB };

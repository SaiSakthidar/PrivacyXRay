const AnakinAPI = require('../anakin-api');
const { TRACKER_DB } = require('./cookie-auditor');

const COUNTRIES = [
  { code: 'us', name: 'United States', flag: '🇺🇸' },
  { code: 'de', name: 'Germany', flag: '🇩🇪' },
  { code: 'in', name: 'India', flag: '🇮🇳' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵' },
  { code: 'br', name: 'Brazil', flag: '🇧🇷' }
];

const ALL_TRACKER_DOMAINS = [
  ...TRACKER_DB.advertising,
  ...TRACKER_DB.analytics,
  ...TRACKER_DB.fingerprinting
];

function extractTrackersFromHtml(html) {
  if (!html) return { trackers: [], tracker_count: 0, has_consent_banner: false };

  const trackers = new Set();

  // Extract script src domains
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const domain = new URL(match[1]).hostname;
      if (ALL_TRACKER_DOMAINS.some(t => domain.includes(t))) {
        trackers.add(domain);
      }
    } catch {}
  }

  // Extract img tracking pixels
  const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*(width=["']1["']|height=["']1["'])/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    try {
      trackers.add(new URL(match[1]).hostname);
    } catch {}
  }

  // Extract iframe sources
  const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
  while ((match = iframeRegex.exec(html)) !== null) {
    try {
      const domain = new URL(match[1]).hostname;
      if (ALL_TRACKER_DOMAINS.some(t => domain.includes(t))) {
        trackers.add(domain);
      }
    } catch {}
  }

  // Check for common tracker patterns in inline scripts
  const inlinePatterns = [
    /gtag\(/i, /fbq\(/i, /ga\(\s*['"]create/i, /analytics\.js/i,
    /pixel/i, /ttq\./i, /linkedin.*tracking/i
  ];
  const hasInlineTrackers = inlinePatterns.filter(p => p.test(html));
  hasInlineTrackers.forEach((_, i) => {
    const names = ['google-analytics', 'facebook-pixel', 'google-analytics', 'google-analytics', 'tracking-pixel', 'tiktok-pixel', 'linkedin-tracking'];
    if (names[i]) trackers.add(names[i]);
  });

  // Check for consent banner
  const bannerPatterns = /cookie.?consent|cookie.?banner|gdpr|consent.?manager|onetrust|cookiebot|cookieyes/i;
  const has_consent_banner = bannerPatterns.test(html);

  return {
    trackers: [...trackers],
    tracker_count: trackers.size,
    has_consent_banner
  };
}

async function trackGeo(targetUrl, apiKey, sendProgress) {
  const api = new AnakinAPI(apiKey);

  sendProgress('geo', `Scanning ${targetUrl} from ${COUNTRIES.length} countries...`);

  // Fire all 5 country requests in parallel
  const results = await Promise.allSettled(
    COUNTRIES.map(async (country) => {
      sendProgress('geo', `Scanning from ${country.flag} ${country.name}...`);
      try {
        const result = await api.submitUrlScrape(targetUrl, false, country.code, true);
        const html = result.html || result.cleanedHtml || '';
        const analysis = extractTrackersFromHtml(html);
        return { country, ...analysis, status: 'success' };
      } catch (err) {
        return { country, trackers: [], tracker_count: 0, has_consent_banner: false, status: 'failed', error: err.message };
      }
    })
  );

  // Build country results
  const countries = {};
  for (const result of results) {
    const data = result.status === 'fulfilled' ? result.value : result.reason;
    countries[data.country.code] = {
      name: data.country.name,
      flag: data.country.flag,
      tracker_count: data.tracker_count || 0,
      trackers: data.trackers || [],
      has_consent_banner: data.has_consent_banner || false,
      status: data.status || 'failed'
    };
  }

  // Generate insights
  const countryEntries = Object.entries(countries).filter(([_, v]) => v.status === 'success');
  const sorted = countryEntries.sort((a, b) => b[1].tracker_count - a[1].tracker_count);

  let insights = {
    most_tracked_country: null,
    least_tracked_country: null,
    tracking_ratio: null,
    consent_banner_countries: []
  };

  if (sorted.length >= 2) {
    const most = sorted[0];
    const least = sorted[sorted.length - 1];
    insights.most_tracked_country = { code: most[0], name: most[1].name, count: most[1].tracker_count };
    insights.least_tracked_country = { code: least[0], name: least[1].name, count: least[1].tracker_count };

    if (least[1].tracker_count > 0) {
      const ratio = (most[1].tracker_count / least[1].tracker_count).toFixed(1);
      insights.tracking_ratio = `${ratio}x more trackers in ${most[1].name} than ${least[1].name}`;
    }

    insights.consent_banner_countries = countryEntries
      .filter(([_, v]) => v.has_consent_banner)
      .map(([code, v]) => v.name);
  }

  return { countries, insights };
}

module.exports = { trackGeo, extractTrackersFromHtml, COUNTRIES };

const AnakinAPI = require('../anakin-api');

// Known third-party services to look for in policies
const KNOWN_SERVICES = [
  'Google Analytics', 'Google Ads', 'Google Tag Manager', 'Google AdSense',
  'Facebook', 'Facebook Pixel', 'Meta Pixel', 'Instagram',
  'Twitter', 'X Corp', 'TikTok', 'Snapchat', 'Pinterest', 'LinkedIn',
  'Amazon', 'Microsoft', 'Bing', 'Yahoo', 'Adobe Analytics',
  'Hotjar', 'Mixpanel', 'Segment', 'Amplitude', 'Heap',
  'Criteo', 'Outbrain', 'Taboola', 'DoubleClick',
  'Cloudflare', 'Stripe', 'PayPal', 'Shopify',
  'HubSpot', 'Salesforce', 'Intercom', 'Zendesk', 'Drift'
];

function parsePrivacyClaims(markdown, generatedJson) {
  const claims = {
    claimed_cookie_types: [],
    claimed_third_parties: [],
    claims_no_tracking: false,
    claims_essential_only: false,
    claims_gdpr_compliant: false,
    claims_dpdp_compliant: false,
    data_retention_mentioned: null,
    raw_quotes: []
  };

  if (!markdown) return claims;
  const text = markdown.toLowerCase();

  // Check for "essential/necessary only" claims
  if (/only\s+(use\s+)?(essential|necessary|strictly necessary)\s+cookies/i.test(markdown)) {
    claims.claims_essential_only = true;
    const match = markdown.match(/.{0,80}only\s+(use\s+)?(essential|necessary|strictly necessary)\s+cookies.{0,80}/i);
    if (match) claims.raw_quotes.push(match[0].trim());
  }

  // Check for "no tracking" claims
  if (/do not (track|use tracking|collect personal|sell your data)/i.test(markdown) ||
      /we don't (track|use tracking|collect personal)/i.test(markdown)) {
    claims.claims_no_tracking = true;
    const match = markdown.match(/.{0,60}(do not|don't)\s+(track|use tracking|collect personal|sell your data).{0,60}/i);
    if (match) claims.raw_quotes.push(match[0].trim());
  }

  // Check for GDPR compliance claims
  if (/gdpr|general data protection/i.test(text)) claims.claims_gdpr_compliant = true;

  // Check for DPDP compliance claims
  if (/dpdp|digital personal data protection|indian data protection/i.test(text)) claims.claims_dpdp_compliant = true;

  // Extract cookie types mentioned
  const cookieTypes = ['essential', 'necessary', 'functional', 'analytics', 'performance', 'marketing', 'advertising', 'targeting', 'social media', 'preference'];
  cookieTypes.forEach(type => {
    if (text.includes(type)) claims.claimed_cookie_types.push(type);
  });

  // Find mentioned third parties
  KNOWN_SERVICES.forEach(service => {
    if (markdown.includes(service) || text.includes(service.toLowerCase())) {
      claims.claimed_third_parties.push(service);
    }
  });

  // Extract data retention periods
  const retentionMatch = markdown.match(/(\d+)\s*(days?|months?|years?)\s*(retention|stored|kept|deleted|removed)/i) ||
                         markdown.match(/(retain|store|keep|delete|remove).*?(\d+)\s*(days?|months?|years?)/i);
  if (retentionMatch) {
    claims.data_retention_mentioned = retentionMatch[0].trim().substring(0, 100);
  }

  // Extract cookie count claims
  const countMatch = markdown.match(/(?:use|set|place|deploy)\s+(\d+)\s+(?:cookies?|trackers?)/i);
  if (countMatch) {
    claims.raw_quotes.push(countMatch[0].trim());
  }

  // Use generatedJson if available
  if (generatedJson && typeof generatedJson === 'object') {
    // The AI might have extracted structured data — merge it
    if (generatedJson.cookies) claims.ai_extracted = generatedJson.cookies;
    if (generatedJson.third_parties) {
      const aiParties = Array.isArray(generatedJson.third_parties)
        ? generatedJson.third_parties
        : [generatedJson.third_parties];
      claims.claimed_third_parties = [...new Set([...claims.claimed_third_parties, ...aiParties])];
    }
  }

  return claims;
}

async function analyzePolicy(targetUrl, apiKey, sendProgress) {
  const api = new AnakinAPI(apiKey);

  sendProgress('policy', 'Discovering privacy policy page...');

  // Search for privacy-related URLs using Map API
  let policyUrl = null;
  try {
    const mapResult = await api.searchMap(targetUrl, 'privacy');
    const links = mapResult.links || [];

    // Find best match (excluding news articles/videos that just mention privacy)
    const privacyLinks = links.filter(l =>
      /privacy|cookie.?policy|data.?protection|legal\/privacy/i.test(l) &&
      !/\/article\/|\/video\/|\/news\/|\/story\/|\/post\/|\d{5,}/i.test(l)
    );

    if (privacyLinks.length > 0) {
      // Prefer shortest (most likely the main policy page)
      policyUrl = privacyLinks.sort((a, b) => a.length - b.length)[0];
    }
  } catch (err) {
    sendProgress('policy', `Map API search failed (${err.message}), trying common URLs...`);
  }

  // Fallback: try common privacy policy paths
  if (!policyUrl) {
    const domain = new URL(targetUrl).origin;
    const commonPaths = ['/privacy', '/privacy-policy', '/cookie-policy', '/legal/privacy', '/privacy.html'];
    for (const path of commonPaths) {
      try {
        const result = await api.submitUrlScrape(domain + path, false, 'us', false);
        if (result.status === 'completed' && result.markdown && result.markdown.length > 500) {
          policyUrl = domain + path;
          break;
        }
      } catch { /* try next */ }
    }
  }

  if (!policyUrl) {
    sendProgress('policy', 'No privacy policy found.');
    return {
      policy_url: null,
      policy_found: false,
      claims: parsePrivacyClaims('', null),
      markdown_snippet: null
    };
  }

  // Scrape the policy page with AI extraction
  sendProgress('policy', `Found policy: ${policyUrl} — analyzing...`);

  try {
    const result = await api.submitUrlScrape(policyUrl, true, 'us', false);

    const claims = parsePrivacyClaims(result.markdown, result.generatedJson);

    return {
      policy_url: policyUrl,
      policy_found: true,
      claims,
      markdown_snippet: (result.markdown || '').substring(0, 2000)
    };
  } catch (err) {
    sendProgress('policy', `Policy analysis failed: ${err.message}`);
    return {
      policy_url: policyUrl,
      policy_found: true,
      claims: parsePrivacyClaims('', null),
      markdown_snippet: null,
      error: err.message
    };
  }
}

module.exports = { analyzePolicy, parsePrivacyClaims };

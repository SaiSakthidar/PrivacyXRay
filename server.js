require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { auditCookies } = require('./audit/cookie-auditor');
const { analyzePolicy } = require('./audit/policy-analyzer');
const { trackGeo } = require('./audit/geo-tracker');
const { analyzeWithAI } = require('./audit/ai-analyzer');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANAKIN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Scoring Algorithm ---
function calculateScore(cookieData, policyData, geoData) {
  let score = 100;
  const violations = [];

  // Non-essential cookies after rejection (-2 each, max -30)
  if (cookieData) {
    const nonEssentialAfter = cookieData.cookies.after_reject
      .filter(c => c.category !== 'essential').length;
    const cookiePenalty = Math.min(nonEssentialAfter * 2, 30);
    score -= cookiePenalty;
    if (cookiePenalty > 0) violations.push(`${nonEssentialAfter} non-essential cookies persist after rejection (-${cookiePenalty})`);

    // Cookie banner missing (-10)
    if (!cookieData.cookie_banner_found) {
      score -= 10;
      violations.push('No cookie consent banner found (-10)');
    }

    // Reject button missing (-10)
    if (cookieData.cookie_banner_found && !cookieData.reject_button_found) {
      score -= 10;
      violations.push('Cookie banner has no reject option (-10)');
    }

    // Cookies ADDED after rejecting (-15)
    if (cookieData.cookies.added_after_reject.length > 0) {
      score -= 15;
      violations.push(`${cookieData.cookies.added_after_reject.length} cookies ADDED after clicking reject (-15)`);
    }
  }

  // Undisclosed trackers (-5 each, max -25)
  if (cookieData && policyData && policyData.policy_found) {
    const actualTrackers = cookieData.scripts.map(s => s.domain);
    const claimedParties = (policyData.claims.claimed_third_parties || []).map(p => p.toLowerCase());
    const undisclosed = actualTrackers.filter(t =>
      !claimedParties.some(c => t.toLowerCase().includes(c.toLowerCase().split(' ')[0]))
    );
    const trackerPenalty = Math.min(undisclosed.length * 5, 25);
    score -= trackerPenalty;
    if (trackerPenalty > 0) violations.push(`${undisclosed.length} undisclosed third-party trackers (-${trackerPenalty})`);
  }

  // Policy not found (-10)
  if (policyData && !policyData.policy_found) {
    score -= 10;
    violations.push('No privacy policy found (-10)');
  }

  // Claims "no tracking" but trackers found (-15)
  if (policyData && policyData.claims.claims_no_tracking && cookieData && cookieData.scripts.length > 0) {
    score -= 15;
    violations.push('Policy claims "no tracking" but trackers detected (-15)');
  }

  // Geo tracking ratio > 2x (-5)
  if (geoData && geoData.insights.tracking_ratio) {
    const ratioMatch = geoData.insights.tracking_ratio.match(/([\d.]+)x/);
    if (ratioMatch && parseFloat(ratioMatch[1]) > 2) {
      score -= 5;
      violations.push(`Geo-discriminatory tracking: ${geoData.insights.tracking_ratio} (-5)`);
    }
  }

  score = Math.max(0, Math.min(100, score));

  let grade, label;
  if (score >= 90) { grade = 'A'; label = 'Privacy Respectful'; }
  else if (score >= 70) { grade = 'B'; label = 'Mostly Compliant'; }
  else if (score >= 50) { grade = 'C'; label = 'Needs Improvement'; }
  else if (score >= 30) { grade = 'D'; label = 'Deceptive'; }
  else { grade = 'F'; label = 'Manipulative'; }

  return { score, grade, label, violations };
}

// --- SSE Audit Endpoint ---
app.get('/api/audit', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Validate URL
  try { new URL(targetUrl); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendSSE = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const sendProgress = (phase, message) => {
    sendSSE('phase', { phase, message });
  };

  let cookieData = null, policyData = null, geoData = null;

  try {
    // Phase 1: Cookie Audit (sequential — needs browser)
    cookieData = await auditCookies(targetUrl, API_KEY, sendProgress);
    sendSSE('result', { type: 'cookies', data: cookieData });

    // Phase 2 & 3: Policy Analysis + Geo Tracking (parallel!)
    const [policyResult, geoResult] = await Promise.allSettled([
      analyzePolicy(targetUrl, API_KEY, sendProgress),
      trackGeo(targetUrl, API_KEY, sendProgress)
    ]);

    policyData = policyResult.status === 'fulfilled' ? policyResult.value : {
      policy_url: null, policy_found: false, claims: {}, error: policyResult.reason?.message
    };
    sendSSE('result', { type: 'policy', data: policyData });

    geoData = geoResult.status === 'fulfilled' ? geoResult.value : {
      countries: {}, insights: {}, error: geoResult.reason?.message
    };
    sendSSE('result', { type: 'geo', data: geoData });

    // Phase 4: Scoring
    sendProgress('scoring', 'Calculating privacy score...');
    const scoring = calculateScore(cookieData, policyData, geoData);
    
    // Phase 5: AI Analysis
    const aiData = await analyzeWithAI(cookieData, policyData, geoData, GEMINI_API_KEY, sendProgress);
    sendSSE('result', { type: 'ai_analysis', data: aiData });

    sendSSE('result', {
      type: 'final',
      data: {
        url: targetUrl,
        score: scoring,
        cookies: cookieData,
        policy: policyData,
        geo: geoData,
        ai: aiData,
        timestamp: new Date().toISOString()
      }
    });

    sendSSE('done', {});

  } catch (error) {
    sendSSE('error', { message: error.message });
  }

  res.end();
});

// Fallback to index.html
app.get('{*path}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🔬 Privacy X-Ray running at http://localhost:${PORT}`);
  console.log(`   API Key: ${API_KEY ? '✅ loaded' : '❌ MISSING — set ANAKIN_API_KEY in .env'}`);
});

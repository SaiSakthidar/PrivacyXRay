// ===== DOM ELEMENTS =====
const searchForm = document.getElementById('search-form');
const urlInput = document.getElementById('url-input');
const scanBtn = document.getElementById('scan-btn');
const heroSection = document.getElementById('hero-section');
const pipelineSection = document.getElementById('pipeline-section');
const resultsSection = document.getElementById('results-section');
const scanAgainBtn = document.getElementById('scan-again-btn');

// Category colors
const CATEGORY_COLORS = {
  essential: { bg: 'rgba(0,232,123,0.12)', color: '#00e87b', dot: '#00e87b', label: 'Essential' },
  analytics: { bg: 'rgba(255,194,58,0.12)', color: '#ffc23a', dot: '#ffc23a', label: 'Analytics' },
  advertising: { bg: 'rgba(255,59,92,0.12)', color: '#ff3b5c', dot: '#ff3b5c', label: 'Advertising' },
  fingerprinting: { bg: 'rgba(99,102,241,0.12)', color: '#6366f1', dot: '#6366f1', label: 'Fingerprinting' },
  unknown: { bg: 'rgba(120,120,160,0.12)', color: '#7878a0', dot: '#7878a0', label: 'Unknown' }
};

// Store AI cookie explanations globally
let cookieExplanations = {};

// ===== FORM HANDLING =====
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http')) url = 'https://' + url;
  startAudit(url);
});

document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    urlInput.value = chip.dataset.url;
    startAudit('https://' + chip.dataset.url);
  });
});

scanAgainBtn.addEventListener('click', () => {
  heroSection.classList.remove('hidden');
  pipelineSection.classList.add('hidden');
  resultsSection.classList.add('hidden');
  resetPipeline();
  urlInput.value = '';
  urlInput.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ===== SSE AUDIT =====
function startAudit(url) {
  scanBtn.disabled = true;
  scanBtn.querySelector('.scan-btn-text').textContent = 'SCANNING...';
  heroSection.classList.add('hidden');
  pipelineSection.classList.remove('hidden');
  resultsSection.classList.remove('hidden');
  resetPipeline();
  resetResults();

  try {
    const urlObj = new URL(url.startsWith('http') ? url : 'https://' + url);
    document.getElementById('target-site-heading').textContent = 'Auditing ' + urlObj.hostname.replace(/^www\./, '');
    document.getElementById('target-site-url').textContent = urlObj.href;
    document.getElementById('target-site-url').href = urlObj.href;
  } catch (e) {
    document.getElementById('target-site-heading').textContent = 'Auditing ' + url;
    document.getElementById('target-site-url').textContent = url;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });

  const eventSource = new EventSource(`/api/audit?url=${encodeURIComponent(url)}`);

  eventSource.addEventListener('phase', (e) => {
    const { phase, message } = JSON.parse(e.data);
    updatePipeline(phase, message);
  });

  eventSource.addEventListener('result', (e) => {
    const { type, data } = JSON.parse(e.data);
    switch (type) {
      case 'cookies': renderCookies(data); break;
      case 'policy': renderPolicy(data); break;
      case 'geo': renderGeo(data); break;
      case 'ai_analysis': renderAIAnalysis(data); break;
      case 'final': renderFinal(data); break;
    }
  });

  eventSource.addEventListener('done', () => {
    eventSource.close();
    completePipeline();
    scanBtn.disabled = false;
    scanBtn.querySelector('.scan-btn-text').textContent = 'SCAN';
  });

  eventSource.addEventListener('error', (e) => {
    try {
      const { message } = JSON.parse(e.data);
      alert('Audit error: ' + message);
    } catch {
      // SSE connection error
    }
    eventSource.close();
    scanBtn.disabled = false;
    scanBtn.querySelector('.scan-btn-text').textContent = 'SCAN';
  });
}

// ===== PIPELINE =====
let activePhase = null;

function resetPipeline() {
  document.querySelectorAll('.pipeline-step').forEach(s => {
    s.classList.remove('active', 'done');
    s.querySelector('.step-status').textContent = '';
  });
  activePhase = null;
}

function updatePipeline(phase, message) {
  // Mark previous phase as done
  if (activePhase && activePhase !== phase) {
    const prev = document.querySelector(`[data-step="${activePhase}"]`);
    if (prev) {
      prev.classList.remove('active');
      prev.classList.add('done');
      prev.querySelector('.step-status').textContent = '✓ Done';
    }
  }

  // Mark current phase as active
  const current = document.querySelector(`[data-step="${phase}"]`);
  if (current) {
    current.classList.add('active');
    current.querySelector('.step-status').textContent = message;
  }

  activePhase = phase;
}

function completePipeline() {
  document.querySelectorAll('.pipeline-step').forEach(s => {
    s.classList.remove('active');
    s.classList.add('done');
    if (!s.querySelector('.step-status').textContent.includes('Done')) {
      s.querySelector('.step-status').textContent = '✓ Done';
    }
  });
}

// ===== RESULTS RESET =====
function resetResults() {
  ['claims-card', 'cookie-card', 'atlas-card', 'ai-card'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  document.getElementById('score-grade').textContent = '—';
  document.getElementById('score-value').textContent = '—/100';
  document.getElementById('score-label').textContent = 'Scanning...';
  document.getElementById('violations-list').innerHTML = '<li class="violation-placeholder">Waiting for scan results...</li>';
  document.getElementById('verdict-icon').textContent = '🔍';
}

// ===== RENDER COOKIES =====
function renderCookies(data) {
  const card = document.getElementById('cookie-card');
  card.classList.remove('hidden');

  // Categories summary
  const cats = data.cookies.categories || {};
  const catContainer = document.getElementById('cookie-categories');
  catContainer.innerHTML = Object.entries(cats)
    .filter(([_, count]) => count > 0)
    .map(([cat, count]) => {
      const c = CATEGORY_COLORS[cat] || CATEGORY_COLORS.unknown;
      return `<div class="category-chip"><span class="category-dot" style="background:${c.dot}"></span>${c.label} (${count})</div>`;
    }).join('');

  // Set up tab events
  document.querySelectorAll('.cookie-tab').forEach(tab => {
    // Only add listener once
    tab.onclick = (e) => {
      document.querySelectorAll('.cookie-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      renderCookieTable(data.cookies, e.target.dataset.view);
    };
  });

  // Render initial table
  renderCookieTable(data.cookies, 'before');

  // Before/After stats
  const ba = document.getElementById('cookie-before-after');
  ba.innerHTML = `
    <div class="before-after-stat">
      <span class="stat-number">${data.cookies.before_count}</span>
      Cookies before reject
    </div>
    <div class="before-after-stat">
      <span class="stat-number" style="color:${data.cookies.after_count >= data.cookies.before_count ? 'var(--accent-red)' : 'var(--accent-green)'}">
        ${data.cookies.after_count}
      </span>
      Cookies after reject
    </div>
    <div class="before-after-stat">
      <span class="stat-number" style="color:var(--accent-red)">${data.cookies.added_after_reject.length}</span>
      Added AFTER reject
    </div>
    <div class="before-after-stat">
      <span class="stat-number">${data.scripts.length}</span>
      Third-party scripts
    </div>
  `;
}

function renderCookieTable(cookiesData, view) {
  const tbody = document.getElementById('cookie-tbody');
  
  let list = [];
  if (view === 'before') list = cookiesData.before_reject || [];
  if (view === 'after') list = cookiesData.after_reject || [];
  if (view === 'added') list = cookiesData.added_after_reject || []; // this is just names right now, wait
  
  // Actually added_after_reject was just an array of names. Let's map them to their full object from after_reject.
  if (view === 'added') {
    list = cookiesData.after_reject.filter(c => cookiesData.added_after_reject.includes(c.name));
  }

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px;">No cookies found for this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.slice(0, 50).map(c => {
    const cat = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.unknown;
    const explanation = cookieExplanations[c.name] || '';
    return `<tr>
      <td>
        <div>${escapeHtml(c.name)}</div>
        ${explanation ? `<div style="font-size:0.7rem;color:var(--text-muted);font-family:var(--font);margin-top:3px;font-style:italic">${escapeHtml(explanation)}</div>` : ''}
      </td>
      <td><span class="cookie-category-badge" style="background:${cat.bg};color:${cat.color}">${cat.label}</span></td>
      <td title="${escapeHtml(c.value || '')}">${escapeHtml((c.value || '').substring(0, 40))}${(c.value || '').length > 40 ? '…' : ''}</td>
    </tr>`;
  }).join('');

  if (list.length > 50) {
    tbody.innerHTML += `<tr><td colspan="3" style="color:var(--text-muted);text-align:center">...and ${list.length - 50} more</td></tr>`;
  }
}

// ===== RENDER POLICY =====
function renderPolicy(data) {
  if (!data.policy_found) return;

  const card = document.getElementById('claims-card');
  card.classList.remove('hidden');

  const claimsList = document.getElementById('claims-list');
  const claims = data.claims;

  const claimItems = [];
  if (claims.claims_essential_only) claimItems.push('🟢 "Essential cookies only"');
  if (claims.claims_no_tracking) claimItems.push('🟢 "We do not track users"');
  if (claims.claims_gdpr_compliant) claimItems.push('🟢 Claims GDPR compliance');
  if (claims.claims_dpdp_compliant) claimItems.push('🟢 Claims DPDP compliance');
  if (claims.claimed_cookie_types.length) claimItems.push(`🟢 Cookie types: ${claims.claimed_cookie_types.join(', ')}`);
  if (claims.claimed_third_parties.length) claimItems.push(`🟢 Discloses: ${claims.claimed_third_parties.slice(0, 5).join(', ')}`);
  if (claims.data_retention_mentioned) claimItems.push(`🟢 Retention: ${claims.data_retention_mentioned}`);
  if (claimItems.length === 0) claimItems.push('🟡 No specific claims extracted');

  claimsList.innerHTML = claimItems.map(item => {
    const [icon, ...text] = item.split(' ');
    return `<div class="claim-item"><span class="claim-icon">${icon}</span><span>${text.join(' ')}</span></div>`;
  }).join('');

  // Show quotes
  if (claims.raw_quotes && claims.raw_quotes.length > 0) {
    const quoteDiv = document.getElementById('policy-quote');
    quoteDiv.classList.remove('hidden');
    document.getElementById('quote-text').textContent = claims.raw_quotes[0];
  }
}

// ===== RENDER REALITY (called from renderFinal) =====
function renderReality(cookieData, policyData) {
  const realityList = document.getElementById('reality-list');
  const items = [];

  if (cookieData) {
    items.push(`🔴 ${cookieData.cookies.before_count} cookies detected`);
    items.push(`🔴 ${cookieData.scripts.length} third-party trackers`);
    if (cookieData.cookies.added_after_reject.length > 0) {
      items.push(`🔴 ${cookieData.cookies.added_after_reject.length} cookies added AFTER reject`);
    }
    if (!cookieData.cookie_banner_found) items.push('🔴 No cookie consent banner');
    if (cookieData.cookie_banner_found && !cookieData.reject_button_found) items.push('🔴 No reject option in banner');

    const adCookies = cookieData.cookies.categories?.advertising || 0;
    if (adCookies > 0) items.push(`🔴 ${adCookies} advertising cookies`);

    const topTrackers = [...new Set(cookieData.scripts.map(s => s.domain))].slice(0, 4);
    if (topTrackers.length) items.push(`🔴 Trackers: ${topTrackers.join(', ')}`);
  }

  if (items.length === 0) items.push('🟡 Waiting for cookie data...');

  realityList.innerHTML = items.map(item => {
    const [icon, ...text] = item.split(' ');
    return `<div class="claim-item"><span class="claim-icon">${icon}</span><span>${text.join(' ')}</span></div>`;
  }).join('');
}

// ===== RENDER GEO =====
function renderGeo(data) {
  const card = document.getElementById('atlas-card');
  card.classList.remove('hidden');

  const barsContainer = document.getElementById('atlas-bars');
  const countries = data.countries || {};
  const maxCount = Math.max(...Object.values(countries).map(c => c.tracker_count || 0), 1);

  barsContainer.innerHTML = Object.entries(countries).map(([code, c]) => {
    const pct = ((c.tracker_count / maxCount) * 100).toFixed(0);
    const bannerTag = c.has_consent_banner ? ' <span style="color:var(--accent-green);font-size:0.7rem">(consent banner)</span>' : '';
    return `
      <div class="atlas-bar-row">
        <div class="atlas-country">${c.flag || ''} ${c.name || code.toUpperCase()}</div>
        <div class="atlas-bar-track">
          <div class="atlas-bar-fill" style="width:0%" data-width="${pct}%"></div>
        </div>
        <div class="atlas-count">${c.tracker_count}${bannerTag}</div>
      </div>`;
  }).join('');

  // Animate bars
  requestAnimationFrame(() => {
    setTimeout(() => {
      document.querySelectorAll('.atlas-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.width;
      });
    }, 100);
  });

  // Insights
  const insightDiv = document.getElementById('atlas-insight');
  const insights = data.insights || {};
  const insightParts = [];
  if (insights.tracking_ratio) insightParts.push(`⚡ <strong>${insights.tracking_ratio}</strong>`);
  if (insights.consent_banner_countries?.length) {
    insightParts.push(`🛡️ Consent banner shown in: <strong>${insights.consent_banner_countries.join(', ')}</strong>`);
  }
  if (insights.consent_banner_countries?.length === 0) {
    insightParts.push('⚠️ <strong>No consent banner shown in any country</strong>');
  }
  insightDiv.innerHTML = insightParts.join('<br>') || 'No geo insights available.';
}

// ===== RENDER AI ANALYSIS =====
function renderAIAnalysis(data) {
  const aiCard = document.getElementById('ai-card');
  aiCard.classList.remove('hidden');

  if (data.error) {
    document.getElementById('ai-summary').innerHTML = `<div class="ai-error-msg">⚠️ AI Analysis Failed<br><small>${escapeHtml(data.error)}</small></div>`;
    document.getElementById('ai-violations').innerHTML = '';
    document.getElementById('ai-praise').textContent = '';
    document.getElementById('ai-risk-level').textContent = '—';
    document.getElementById('ai-risk-explanation').textContent = '';
    return;
  }

  // Executive summary
  document.getElementById('ai-summary').textContent = data.executive_summary || '';

  // Violations
  const violationsList = document.getElementById('ai-violations');
  if (data.key_violations && data.key_violations.length) {
    violationsList.innerHTML = data.key_violations.map(v => `<li>${escapeHtml(v)}</li>`).join('');
  } else {
    violationsList.innerHTML = '<li style="border-left-color:var(--accent-green);background:rgba(0,232,123,0.05)">No violations identified</li>';
  }

  // Praise
  document.getElementById('ai-praise').textContent = data.praise || 'None identified';

  // Risk gauge animation
  const riskLevel = (data.dark_pattern_risk || 'Unknown').toLowerCase();
  const riskLevelEl = document.getElementById('ai-risk-level');
  const riskRingFill = document.getElementById('ai-risk-ring-fill');
  const circumference = 301.59;

  let riskPct = 0.33;
  let riskColor = 'var(--accent-green)';
  if (riskLevel === 'high') { riskPct = 1.0; riskColor = 'var(--accent-red)'; }
  else if (riskLevel === 'medium') { riskPct = 0.6; riskColor = 'var(--accent-yellow)'; }
  else if (riskLevel === 'low') { riskPct = 0.25; riskColor = 'var(--accent-green)'; }

  riskLevelEl.textContent = data.dark_pattern_risk || 'Unknown';
  riskLevelEl.style.color = riskColor;

  // Animate the ring after a short delay
  requestAnimationFrame(() => {
    setTimeout(() => {
      riskRingFill.style.stroke = riskColor;
      riskRingFill.style.strokeDashoffset = circumference - (riskPct * circumference);
    }, 200);
  });

  document.getElementById('ai-risk-explanation').textContent = data.dark_pattern_explanation || '';

  // Store cookie explanations and re-render table if cookies already loaded
  if (data.cookie_explanations && typeof data.cookie_explanations === 'object') {
    cookieExplanations = data.cookie_explanations;
    // Re-render the currently active cookie tab to show explanations
    const activeTab = document.querySelector('.cookie-tab.active');
    if (activeTab) {
      const cookieCard = document.getElementById('cookie-card');
      if (!cookieCard.classList.contains('hidden')) {
        // We need the cookie data - get it from the existing table state
        // Trigger a click on the active tab to re-render
        activeTab.click();
      }
    }
  }
}

// ===== RENDER FINAL SCORE =====
function renderFinal(data) {
  const score = data.score;

  // Animate score ring
  const ringFill = document.getElementById('score-ring-fill');
  const circumference = 326.73;
  const offset = circumference - (score.score / 100) * circumference;
  ringFill.style.strokeDashoffset = offset;

  // Color based on grade
  const gradeColors = {
    A: 'var(--accent-green)', B: 'var(--accent-green)',
    C: 'var(--accent-yellow)',
    D: 'var(--accent-red)', F: 'var(--accent-red)'
  };
  ringFill.style.stroke = gradeColors[score.grade] || 'var(--accent-purple)';

  // Set score text
  document.getElementById('score-grade').textContent = score.grade;
  document.getElementById('score-grade').style.color = gradeColors[score.grade];
  document.getElementById('score-value').textContent = `${score.score}/100`;
  document.getElementById('score-label').textContent = `"${score.label}"`;
  document.getElementById('score-label').style.color = gradeColors[score.grade];

  // Verdict
  const verdictIcons = { A: '🟢', B: '🟢', C: '🟡', D: '🔴', F: '🔴' };
  document.getElementById('verdict-icon').textContent = verdictIcons[score.grade] || '🔍';

  // Violations
  const violationsList = document.getElementById('violations-list');
  if (score.violations.length > 0) {
    violationsList.innerHTML = score.violations.map(v => `<li>${escapeHtml(v)}</li>`).join('');
  } else {
    violationsList.innerHTML = '<li style="color:var(--accent-green)">✅ No violations detected!</li>';
  }

  // Render the reality column
  renderReality(data.cookies, data.policy);

  // Show claims card if not already visible
  const claimsCard = document.getElementById('claims-card');
  if (claimsCard.classList.contains('hidden')) {
    claimsCard.classList.remove('hidden');
  }
}

// ===== HELPERS =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

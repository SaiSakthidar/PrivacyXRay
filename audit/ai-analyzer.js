const { GoogleGenerativeAI } = require('@google/generative-ai');

async function analyzeWithAI(cookieData, policyData, geoData, apiKey, sendProgress) {
  if (!apiKey) {
    sendProgress('ai_analysis', 'Skipping AI analysis (no Gemini API key)');
    return { error: 'No Gemini API key provided' };
  }

  sendProgress('ai_analysis', 'Generating AI Insights with Gemini...');

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { responseMimeType: "application/json" } });

    // Format the data for the LLM
    const dataSummary = {
      url: cookieData?.url || 'Unknown',
      cookies_before_reject: cookieData?.cookies?.before_count || 0,
      cookies_after_reject: cookieData?.cookies?.after_count || 0,
      third_party_scripts: cookieData?.scripts?.length || 0,
      cookie_banner_found: cookieData?.cookie_banner_found || false,
      reject_button_found: cookieData?.reject_button_found || false,
      cookie_names: cookieData?.cookies?.before_reject?.map(c => c.name) || [],
      policy_found: policyData?.policy_found || false,
      policy_claims: policyData?.claims || {},
      policy_text_snippet: policyData?.markdown_snippet || '',
      geo_insights: geoData?.insights || {},
      top_trackers: cookieData?.scripts ? [...new Set(cookieData.scripts.map(s => s.domain))].slice(0, 5) : []
    };

    const prompt = `
    You are an expert privacy auditor. Analyze this raw scan data of a website's cookie and tracking behavior.
    
    Data:
    ${JSON.stringify(dataSummary, null, 2)}
    
    Respond with a JSON object containing:
    {
      "executive_summary": "A 2-3 sentence hard-hitting summary of the site's privacy practices.",
      "key_violations": ["List of 2-4 major issues, e.g. dark patterns, undisclosed trackers, GDPR/DPDP concerns"],
      "praise": "Any good practices found (or 'None' if awful)",
      "dark_pattern_risk": "High, Medium, or Low",
      "dark_pattern_explanation": "1 sentence explaining the risk level based on the banner/reject behavior.",
      "cookie_explanations": {"cookie_name": "One sentence explaining what this cookie likely does and whether it is essential, tracking, or advertising"},
      "policy_summary": ["3 bullet points summarizing what the privacy policy ACTUALLY says in plain English. Be blunt and specific, not corporate-speak."],
      "policy_word_count": 0
    }
    `;

    const result = await model.generateContent(prompt);
    let responseText = result.response.text();
    
    // Strip markdown formatting if present
    if (responseText.startsWith('```json')) {
      responseText = responseText.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (responseText.startsWith('```')) {
      responseText = responseText.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    
    return JSON.parse(responseText.trim());

  } catch (err) {
    sendProgress('ai_analysis', `AI analysis failed: ${err.message}`);
    return { error: err.message };
  }
}

module.exports = { analyzeWithAI };

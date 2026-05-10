# Privacy X-Ray

A real-time privacy compliance auditor. Give it any website and it exposes the gap between what they say and what they actually do.

**Live:** https://privacyxray-production.up.railway.app

## What it does

1. **Launches a stealth browser** via Anakin's Browser API and navigates to the target site
2. **Extracts all cookies and third-party scripts** before any interaction
3. **Finds and clicks the "Reject" button** on cookie banners (supports Sourcepoint, OneTrust, and others)
4. **Extracts cookies again** to see what actually changed
5. **Scrapes the privacy policy** using Anakin's URL Scraper + Map APIs and extracts claims
6. **Scans from 5 countries** (US, Germany, India, Japan, Brazil) to detect geo-discriminatory tracking
7. **Gemini 2.5 Flash** analyzes everything — flags violations, explains each cookie, and rates dark pattern risk

The result is a privacy score (A–F) with full evidence breakdown.

## Tech Stack

- **Backend:** Node.js, Express, Server-Sent Events
- **Browser Automation:** Playwright via Anakin Browser API
- **Data Collection:** Anakin URL Scraper API, Anakin Map API
- **AI Analysis:** Google Gemini 2.5 Flash
- **Frontend:** Vanilla HTML/CSS/JS
- **Deployment:** Railway

## Setup

```bash
git clone https://github.com/SaiSakthidar/PrivacyXRay.git
cd PrivacyXRay
npm install
```

Create a `.env` file:

```
ANAKIN_API_KEY=your_anakin_key
GEMINI_API_KEY=your_gemini_key
PORT=3000
```

```bash
npm start
```

Open `http://localhost:3000`

## How it works

```
User enters URL
      │
      ▼
┌─────────────────┐
│  Anakin Browser  │──▶ Extract cookies + scripts
│  (Headless CDP)  │──▶ Click "Reject All"
│                  │──▶ Extract cookies again
└─────────────────┘
      │
      ├──▶ Anakin Map API ──▶ Find privacy policy URL
      ├──▶ Anakin URL Scraper ──▶ Extract policy text + claims
      ├──▶ Anakin Geo Routing ──▶ Scan from 5 countries
      │
      ▼
┌─────────────────┐
│  Gemini 2.5     │──▶ Executive summary
│  Flash          │──▶ Violation list
│                 │──▶ Cookie explanations
│                 │──▶ Dark pattern risk rating
└─────────────────┘
      │
      ▼
   Dashboard with score, evidence, and AI insights
```

## License

MIT

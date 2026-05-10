const fetch = require('node-fetch');

const BASE_URL = 'https://api.anakin.io/v1';

class AnakinAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.headers = {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json'
        };
    }

    async pollJob(endpoint, jobId, interval = 5000, timeout = 300000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const res = await fetch(`${BASE_URL}/${endpoint}/${jobId}`, { headers: this.headers });
            const data = await res.json();

            if (data.status === 'completed') return data;
            if (data.status === 'failed') throw new Error(data.error || 'Job failed');

            await new Promise(resolve => setTimeout(resolve, interval));
        }
        throw new Error('Job polling timed out');
    }

    async submitUrlScrape(url, generateJson = false, country = 'us', useBrowser = false) {
        const res = await fetch(`${BASE_URL}/url-scraper`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ url, generateJson, country, useBrowser })
        });
        const data = await res.json();
        if (!data.jobId) throw new Error(data.error || 'Failed to submit scrape job');
        return this.pollJob('url-scraper', data.jobId);
    }

    async submitBatchUrlScrape(urls, country = 'us') {
        const res = await fetch(`${BASE_URL}/url-scraper/batch`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ urls, country, useBrowser: false, generateJson: false })
        });
        const data = await res.json();
        if (!data.jobId) throw new Error(data.error || 'Failed to submit batch job');
        return this.pollJob('url-scraper', data.jobId);
    }

    async searchMap(url, searchString = '') {
        const res = await fetch(`${BASE_URL}/map`, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ url, includeSubdomains: false, limit: 100, search: searchString })
        });
        const data = await res.json();
        if (!data.jobId) throw new Error(data.error || 'Failed to submit map job');
        return this.pollJob('map', data.jobId);
    }
}

module.exports = AnakinAPI;

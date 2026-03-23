const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { analyzeHTML, extractLinks, discoverStructure } = require('./lib/audit');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 靜態檔案路徑：指向 frontend 打包後的 dist 資料夾
const distPath = path.join(__dirname, 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

/**
 * [New] 智能偵測接口
 */
app.post('/api/discover', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '請提供網址' });
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const discovered = discoverStructure($, url);
    res.json({ success: true, discovered });
  } catch (err) {
    res.status(500).json({ error: `偵測失敗: ${err.message}` });
  }
});

app.post('/api/scan', async (req, res) => {
  try {
    const { url, fontSizeThreshold = 18 } = req.body;
    if (!url) return res.status(400).json({ error: '請提供網址' });
    const html = await fetchPage(url);
    const result = analyzeHTML(html, { fontSizeThreshold });
    res.json({ success: true, url, ...result });
  } catch (err) {
    res.status(500).json({ error: `掃描失敗: ${err.message}` });
  }
});

app.post('/api/crawl', async (req, res) => {
  try {
    const { url, mode = 'all', customPrefix, fontSizeThreshold = 18 } = req.body;
    if (!url) return res.status(400).json({ error: '請提供網址' });

    const homeHtml = await fetchPage(url);
    const $ = cheerio.load(homeHtml);
    let links = extractLinks($, url, mode, customPrefix);
    
    // Odoo 自動深入邏輯
    if (!customPrefix && mode === 'product' && links.length === 0) {
      const catLinks = [];
      $('a[href*="/shop/category/"]').each((i, el) => {
        const h = $(el).attr('href');
        try { catLinks.push(new URL(h, url).href); } catch(e) {}
      });
      if (catLinks.length > 0) {
        const firstCatHtml = await fetchPage(catLinks[0]);
        links = extractLinks(cheerio.load(firstCatHtml), catLinks[0], mode);
      }
    }

    links = Array.from(new Set([url, ...links])).slice(0, 30);

    const results = [];
    const batchSize = 3;
    for (let i = 0; i < links.length; i += batchSize) {
      const batchResults = await Promise.allSettled(links.slice(i, i + batchSize).map(async (p) => {
        const h = await fetchPage(p);
        return { url: p, ...analyzeHTML(h, { fontSizeThreshold }), success: true };
      }));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') results.push(r.value);
        else results.push({ url: '未知故障', success: false });
      }
    }
    res.json({ success: true, mode, summary: buildSummary(results), pages: results });
  } catch (err) {
    res.status(500).json({ error: `爬蟲失敗: ${err.message}` });
  }
});

async function fetchPage(url) {
  const response = await axios.get(url, { 
    timeout: 15000, 
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' } 
  });
  return response.data;
}

function buildSummary(results) {
  const succ = results.filter(r => r.success);
  const avg = succ.length > 0 ? Math.round(succ.reduce((s, r) => s + r.score, 0) / succ.length) : 0;
  const counts = { heading: 0, seo: 0, b2b: 0, style: 0, fontTag: 0 };
  for (const r of succ) if (r.categories) for (const k of Object.keys(counts)) counts[k] += r.categories[k]?.count || 0;
  return { avgScore: avg, totalIssues: Object.values(counts).reduce((a,b)=>a+b,0), categoryCounts: counts };
}

// 支援所有路由回傳 index.html (React 路由)
if (fs.existsSync(path.join(distPath, 'index.html'))) {
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.listen(PORT, () => console.log(`🚀 SEO 工具伺服器運作中：Port ${PORT}`));


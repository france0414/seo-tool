const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const { analyzeHTML, extractLinks, discoverStructure } = require('./lib/audit');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 靜態檔案路徑：多重候選路徑搜尋 (解決雲端環境路徑差異)
const distCandidates = [
  path.resolve(__dirname, 'frontend', 'dist'),
  path.resolve(__dirname, 'dist'),
  path.resolve(process.cwd(), 'frontend', 'dist'),
  path.resolve(process.cwd(), 'dist')
];

let distPath = distCandidates[0];
let found = false;
for (const cand of distCandidates) {
  if (fs.existsSync(path.join(cand, 'index.html'))) {
    distPath = cand;
    found = true;
    console.log(`✅ 找到有效的靜態網頁路徑：${distPath}`);
    break;
  }
}

if (!found) {
  console.warn('⚠️ 警告：找不到前端靜態檔案 (index.html)。');
  console.warn('嘗試過的路徑：', distCandidates);
}

app.use(cors());
app.use(express.json());

// 服務靜態檔案
app.use(express.static(distPath));

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
    const result = analyzeHTML(html, { fontSizeThreshold, pageUrl: url });
    res.json({ success: true, url, ...result });
  } catch (err) {
    res.status(500).json({ error: `掃描失敗: ${err.message}` });
  }
});

app.post('/api/crawl', async (req, res) => {
  try {
    const { url, mode = 'all', customPrefix, fontSizeThreshold = 18, maxPages = 1000 } = req.body;
    if (!url) return res.status(400).json({ error: '請提供網址' });
    const pageLimit = Math.min(1000, Math.max(1, maxPages)); // 上限 1000 頁

    const origin = new URL(url).origin;
    const allLinks = new Set();
    const visitedForDiscovery = new Set(); // 已經拜訪過用來「發現更多連結」的頁面

    // === 第一步：從起始頁取得初始連結 ===
    const homeHtml = await fetchPage(url);
    const $ = cheerio.load(homeHtml);
    const initialLinks = extractLinks($, url, mode, customPrefix);
    initialLinks.forEach(l => allLinks.add(l));
    allLinks.add(url);
    visitedForDiscovery.add(url);
    console.log(`📄 初始頁面找到 ${initialLinks.length} 個連結`);

    // === 第二步：自動深入掃描（無固定層數限制）===
    // 適用於 /shop、/blog 等多層分類結構
    // 持續探索直到找不到新的分類頁為止
    const MAX_DISCOVERY_PAGES = Math.min(100, Math.ceil(pageLimit / 2)); // 最多拜訪的分類頁數量上限
    let discoveryRound = 0;

    while (visitedForDiscovery.size < MAX_DISCOVERY_PAGES) {
      discoveryRound++;
      // 從目前已知的連結中，找出還沒拜訪過的「可能是分類/列表頁」的連結
      const candidates = Array.from(allLinks).filter(link => {
        if (visitedForDiscovery.has(link)) return false;
        try {
          const p = new URL(link).pathname;
          // 分類頁特徵：含有 category、或是 /shop/、/blog/ 列表頁
          const isCategory = /\/category\//i.test(p);
          const isListingPage = /^\/(shop|blog)\/?$/i.test(p);
          // 產品頁通常以 -數字 結尾，排除掉
          const isProductDetail = /\-\d+$/.test(p);
          return isCategory || isListingPage || (!isProductDetail && discoveryRound === 1);
        } catch (e) { return false; }
      });

      if (candidates.length === 0) break;

      const remaining = MAX_DISCOVERY_PAGES - visitedForDiscovery.size;
      if (remaining <= 0) break;
      const toVisit = candidates.slice(0, remaining);

      console.log(`🔍 第 ${discoveryRound} 輪探索：拜訪 ${toVisit.length} 個分類頁...`);

      const batchSize = 3;
      for (let i = 0; i < toVisit.length; i += batchSize) {
        const batch = toVisit.slice(i, i + batchSize);
        const results = await Promise.allSettled(batch.map(u => fetchPage(u)));
        for (let j = 0; j < results.length; j++) {
          visitedForDiscovery.add(batch[j]);
          if (results[j].status === 'fulfilled') {
            const newLinks = extractLinks(cheerio.load(results[j].value), batch[j], mode, customPrefix);
            newLinks.forEach(l => allLinks.add(l));
          }
        }
      }
      console.log(`   → 目前共發現 ${allLinks.size} 個連結`);
    }

    // === 第三步：對所有發現的連結進行 SEO 審計 ===
    const finalLinks = [url, ...Array.from(allLinks).filter(l => l !== url)].slice(0, pageLimit);
    console.log(`✅ 最終將審計 ${finalLinks.length} 個頁面 (上限 ${pageLimit})`);

    const results = [];
    let commonIssues = null; // Header/Footer 共用問題只取一次
    const batchSize = 3;
    for (let i = 0; i < finalLinks.length; i += batchSize) {
      const batchResults = await Promise.allSettled(finalLinks.slice(i, i + batchSize).map(async (p, batchIdx) => {
        const h = await fetchPage(p);
        const isFirstPage = (i + batchIdx === 0);
        return { url: p, ...analyzeHTML(h, { fontSizeThreshold, skipHeaderFooter: !isFirstPage, pageUrl: p }), success: true, isFirstPage };
      }));
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          const pageResult = r.value;
          // 從第一頁提取 Header/Footer 共用問題
          if (pageResult.isFirstPage && !commonIssues) {
            commonIssues = { headerFooter: { label: '🔒 Header / Footer 共用問題 (僅顯示一次)', issues: [] } };
            for (const catKey of Object.keys(pageResult.categories)) {
              const cat = pageResult.categories[catKey];
              const hfIssues = cat.issues.filter(iss => iss.section === 'Header' || iss.section === 'Footer');
              const contentIssues = cat.issues.filter(iss => iss.section !== 'Header' && iss.section !== 'Footer');
              // 把 HF issues 收到 commonIssues
              hfIssues.forEach(iss => commonIssues.headerFooter.issues.push({ ...iss, category: cat.label }));
              // 只保留 Content issues 在 page result
              cat.issues = contentIssues;
              cat.count = contentIssues.length;
            }
          }
          delete pageResult.isFirstPage;
          results.push(pageResult);
        } else {
          results.push({ url: '未知故障', success: false });
        }
      }
    }
    res.json({ success: true, mode, summary: buildSummary(results), commonIssues, pages: results });
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
  const counts = { heading: 0, seo: 0, b2b: 0, style: 0, fontTag: 0 };
  for (const r of succ) if (r.categories) for (const k of Object.keys(counts)) counts[k] += r.categories[k]?.count || 0;
  return { totalIssues: Object.values(counts).reduce((a, b) => a + b, 0), categoryCounts: counts };
}

// 支援所有路由回傳 index.html (React 路由)
app.get('*', (req, res) => {
  const indexPath = path.join(distPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // 萬一還是找不到，列出搜尋路徑給環境除錯用
    res.status(404).send(`前端檔案定位失敗。<br>嘗試過的路徑：<pre>${distCandidates.join('\n')}</pre>`);
  }
});

/**
 * [New] 圖片批次下載功能
 */
async function downloadFile(url, folderPath, fileName) {
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
  const localFilePath = path.join(folderPath, fileName);
  
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'arraybuffer', // 改用 arraybuffer 以便 sharp 處理
    timeout: 30000
  });

  // 使用 sharp 轉為 PNG 並保留透明度 (Alpha 通道)
  await sharp(response.data)
    .png()
    .toFile(localFilePath);

  return Promise.resolve();
}

// [New] 分辨目前的環境與功能開關
const IS_VERCEL = !!process.env.VERCEL;

app.get('/api/config', (req, res) => {
  res.json({
    isVercel: IS_VERCEL,
    downloadEnabled: !IS_VERCEL
  });
});

app.post('/api/download-images', async (req, res) => {
  // 如果在 Vercel 環境，禁用下載功能
  if (IS_VERCEL) {
    return res.status(403).json({ error: '雲端版不支援直接下載到本地，請在本地執行本程式。' });
  }
  try {
    const { products } = req.body; // Array of { name, urls: [] }
    if (!products || !Array.isArray(products)) {
      return res.status(400).json({ error: '請提供產品資料清單' });
    }

    const baseDownloadDir = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(baseDownloadDir)) fs.mkdirSync(baseDownloadDir);

    const results = [];
    console.log(`📥 開始下載 ${products.length} 個產品的圖片...`);

    for (const prod of products) {
      const { name, urls } = prod;
      const safeName = (name || 'unnamed-product').replace(/[\/\\?%*:|"<>]/g, '-').trim();
      const prodDir = path.join(baseDownloadDir, safeName);
      
      const prodResults = [];
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        try {
          // 強制使用 .png 副檔名
          const fileName = `${safeName}_${i + 1}.png`;
          
          await downloadFile(url, prodDir, fileName);
          prodResults.push({ url, success: true, fileName });
          // 下載間隔，避免被鎖
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (err) {
          console.error(`❌ 下載失敗 [${url}]:`, err.message);
          prodResults.push({ url, success: false, error: err.message });
        }
      }
      results.push({ product: name, details: prodResults });
    }

    res.json({ success: true, message: '下載任務完成', results, downloadPath: baseDownloadDir });
  } catch (err) {
    res.status(500).json({ error: `下載過程發生錯誤: ${err.message}` });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 SEO 工具伺服器運作中：Port ${PORT} (0.0.0.0)`));




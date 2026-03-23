const cheerio = require('cheerio');

/**
 * 分析 HTML 內容，進行字體樣式與 SEO 審計
 */
function analyzeHTML(html, options = {}) {
  const $ = cheerio.load(html);
  const fontSizeThreshold = options.fontSizeThreshold || 18;

  const sections = identifySections($);
  const styleIssues = findStyleIssues($, fontSizeThreshold, sections);
  const headingIssues = findHeadingIssues($, sections);
  const seoIssues = findSeoIssues($);
  const b2bIssues = findB2bIssues($, sections);

  const fontTagIssues = styleIssues.filter(i => i.type === 'font-tag');
  const otherStyleIssues = styleIssues.filter(i => i.type !== 'font-tag');

  const allIssues = [...styleIssues, ...headingIssues, ...seoIssues, ...b2bIssues];
  const score = calculateScore(allIssues);

  return {
    score,
    totalIssues: allIssues.length,
    categories: {
      heading: { order: 1, label: '標題結構問題', issues: headingIssues, count: headingIssues.length },
      seo: { order: 2, label: 'SEO 基礎問題', issues: seoIssues, count: seoIssues.length },
      b2b: { order: 3, label: 'B2B 外銷加強項', issues: b2bIssues, count: b2bIssues.length },
      style: { order: 4, label: '內聯樣式問題', issues: otherStyleIssues, count: otherStyleIssues.length },
      fontTag: { 
        order: 5, 
        label: '已過期標籤 (font)', 
        description: '(icb 系統 font 為選擇色彩或樣式的時候自動產生)',
        issues: fontTagIssues, 
        count: fontTagIssues.length 
      },
    },
    sections,
  };
}

function identifySections($) {
  const hSelectors = ['header', '#header', '.header', '#o_header', 'nav.navbar', '.navbar-header'];
  const fSelectors = ['footer', '#footer', '.footer', '#o_footer', '.s_footer'];
  const mSelectors = ['main', '#wrap', '#wrapwrap .oe_structure', '.oe_structure', '[id*="content"]', 'article'];
  const found = { header: null, footer: null, main: null };
  for (const s of hSelectors) if ($(s).length) { found.header = s; break; }
  for (const s of fSelectors) if ($(s).length) { found.footer = s; break; }
  for (const s of mSelectors) if ($(s).length) { found.main = s; break; }
  return found;
}

function isSystemStructure($, el, sections) {
  const sec = getSection($, el, sections);
  if (sec === 'Header' || sec === 'Footer' || sec === 'Head') return true;
  const systemSelectors = [
    '.o_wsale_products_grid_table_wrapper', '#sh_website_page_sub_categ_style_5',
    '.dynamic_snippet_template', '[class*="dynamic_"]', '[id*="dynamic_"]',
    '.oe_structure', '.s_dynamic', 'nav', '.navbar', '.s_product_list', '.s_blog_posts',
    '.nav-pills', '.list-group', '.o_shop_collapse_category'
  ];
  if ($(el).closest(systemSelectors.join(',')).length > 0) return true;
  const classStr = $(el).closest('[class*="o_wsale_"], [class*="s_"], [id*="sh_website_"], [class*="dynamic"]').attr('class') || '';
  const idStr = $(el).closest('[class*="o_wsale_"], [class*="s_"], [id*="sh_website_"], [id*="dynamic"]').attr('id') || '';
  if (/o_wsale_|s_|^sh_website_|dynamic/i.test(classStr) || /sh_website_|dynamic/i.test(idStr)) return true;
  return false;
}

function getSection($, el, sections) {
  if (sections.header && $(el).closest(sections.header).length) return 'Header';
  if (sections.footer && $(el).closest(sections.footer).length) return 'Footer';
  if ($(el).closest('head').length) return 'Head';
  return 'Content';
}

function findStyleIssues($, fontSizeThreshold, sections) {
  const issues = [];
  $('[style]').each((i, el) => {
    const s = $(el).attr('style') || '';
    const tag = el.tagName || el.name;
    const text = $(el).text().substring(0, 80);
    const sec = getSection($, el, sections);
    const isSys = isSystemStructure($, el, sections);
    const htmlSnippet = $.html(el).substring(0, 200);
    const match = s.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
    if (match) {
      const size = parseFloat(match[1]);
      if (size > fontSizeThreshold) {
        issues.push({
          type: 'font-size', severity: size > 30 ? 'high' : 'medium', section: sec, isSystem: isSys,
          message: `發現內聯字體大小: ${size}px`, suggestion: isSys ? '系統結構樣式。建議回報工程師修正系統範本。' : '過大字體建議改用 CSS Class。',
          tag, text, code: htmlSnippet, deduction: isSys ? 0 : (size > 30 ? 8 : 5),
        });
      }
    }
    if (/font-family\s*:/i.test(s)) {
      issues.push({
        type: 'font-family', severity: 'medium', section: sec, isSystem: isSys,
        message: `發現內聯 font-family 設定`, suggestion: isSys ? '系統語法。建議調整主版。' : '建議統一全站字體。',
        tag, text, code: htmlSnippet, deduction: isSys ? 0 : 5,
      });
    }
  });
  $('font').each((i, el) => {
    const isSys = isSystemStructure($, el, sections);
    issues.push({
      type: 'font-tag', severity: 'low', section: getSection($, el, sections), isSystem: isSys,
      message: '發現舊式 <font> 標籤', suggestion: '主要用於色彩或樣式顯示。若不影響排版則可接受。',
      tag: 'font', text: $(el).text().substring(0, 50), code: $.html(el).substring(0, 150), deduction: isSys ? 0 : 2,
    });
  });
  return issues;
}

function findHeadingIssues($, sections) {
  const issues = [];
  const hArr = [];
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    const tag = el.tagName.toLowerCase();
    const lv = parseInt(tag.replace('h', ''));
    const txt = $(el).text().trim() || '(空白內容)';
    const sec = getSection($, el, sections);
    const isSys = isSystemStructure($, el, sections);
    const htmlSnippet = $.html(el).substring(0, 200);
    hArr.push({ lv, tag, txt, sec, html: htmlSnippet, isSystem: isSys });
    if (!$(el).text().trim()) {
      issues.push({
        type: 'empty-heading', severity: 'high', section: sec, isSystem: isSys,
        message: `發現空白的 <${tag}> 標籤`, suggestion: isSys ? '系統生成空白標籤，請工程師移除。' : '標題不應為空。',
        tag, text: '(空白)', code: htmlSnippet, deduction: isSys ? 0 : 10,
      });
    }
  });
  const h1s = hArr.filter(h => h.lv === 1);
  if (h1s.length === 0) {
    issues.push({ type: 'missing-h1', severity: 'high', section: 'Content', isSystem: false, message: '頁面缺少 <h1> 標籤', suggestion: '每個頁面應具備一個主標題。若首頁注重美觀，可考慮使用視覺隱藏的 H1 以供 SEO 索引。', tag: 'h1', text: '', code: '(整個頁面沒找到 h1)', deduction: 10 });
  } else if (h1s.length > 1) {
    h1s.forEach((h, idx) => { issues.push({ type: 'multiple-h1', severity: 'medium', section: h.sec, isSystem: h.isSystem, message: `多個 <h1> (第 ${idx + 1} 個)`, suggestion: '建議網頁內只有一個 <h1>。', tag: 'h1', text: h.txt, code: h.html, deduction: h.isSystem ? 0 : 8 }); });
  }
  for (let i = 1; i < hArr.length; i++) {
    const cur = hArr[i]; const prev = hArr[i - 1];
    if (cur.lv - prev.lv > 1) {
      issues.push({ type: 'heading-skip', severity: 'low', section: cur.sec, isSystem: cur.isSystem, message: `標題層級跳躍: <${prev.tag}> → <${cur.tag}>`, suggestion: `中間缺少了 <${'h' + (prev.lv + 1)}>。`, tag: cur.tag, text: `內容: "${cur.txt.substring(0, 50)}"`, code: `上一個: <${prev.tag}> ${prev.txt.substring(0, 20)}...\n目前抓到: ${cur.html}`, deduction: cur.isSystem ? 0 : 5 });
    }
  }
  return issues;
}

function findSeoIssues($) {
  const issues = [];
  if (!$('title').text().trim()) {
    issues.push({ type: 'missing-title', severity: 'high', section: 'Head', isSystem: false, message: '缺少 <title>', suggestion: '補上網頁 Title。請至後端 SEO 設定頁面填寫。', tag: 'title', text: '', code: '', deduction: 15 });
  }
  if (!$('meta[name="description"]').attr('content')) {
    issues.push({ type: 'missing-meta-desc', severity: 'high', section: 'Head', isSystem: false, message: '缺少 Meta Description', suggestion: '補上 Meta 描述。請至後端 SEO 設定頁面填寫，這對搜尋排名非常重要。', tag: 'meta', text: '', code: '', deduction: 15 });
  }
  return issues;
}

function findB2bIssues($, sections) {
  const issues = [];
  if (!$('html').attr('lang')) {
    issues.push({ type: 'missing-lang', severity: 'high', section: 'Head', isSystem: true, message: '網頁未設定語系 (lang)', suggestion: '設定如 lang="en"。此為系統動態結構需由工程師優化。', tag: 'html', text: '', code: '', deduction: 0 });
  }
  $('img').each((i, el) => {
    const alt = $(el).attr('alt');
    const isSys = isSystemStructure($, el, sections);
    if (!alt || alt.trim() === '') {
      issues.push({
        type: 'missing-alt', severity: 'medium', section: getSection($, el, sections), isSystem: isSys,
        message: `圖片缺少 alt 屬性`, 
        // 根據是否為系統結構給予不同建議
        suggestion: isSys ? '系統生成圖片，建議工程師於模組內加入自動 ALT (如產品名稱)。' : '請於後台圖片設定中補上 ALT 描述，幫助搜尋引擎理解圖片內容。',
        tag: 'img', text: '', code: $.html(el).substring(0, 150), deduction: isSys ? 0 : 3,
      });
    }
  });
  return issues;
}

function calculateScore(issues) {
  let score = 100;
  for (const issue of issues) score -= (issue.deduction || 0);
  return Math.max(0, Math.min(100, score));
}

function discoverStructure($, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const pathGroups = {};
  const rootPages = [];
  const treeCandidates = [];
  $('.list-group, .nav-pills, .nav-stacked, aside ul, .s_product_list_categories, .o_shop_collapse_category').each((i, el) => {
    const groupLinks = []; $(el).find('a[href]').each((j, a) => { const h = $(a).attr('href'); try { const u = new URL(h, baseUrl); if (u.origin === origin) groupLinks.push(u.pathname); } catch(e){} });
    if (groupLinks.length >= 2) { const commonPrefix = findCommonPrefix(groupLinks); if (commonPrefix && commonPrefix.length > 1) treeCandidates.push({ prefix: commonPrefix, count: groupLinks.length }); }
  });
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href'); if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try { const parsed = new URL(href, baseUrl); if (parsed.origin !== origin) return; const p = parsed.pathname; const segments = p.split('/').filter(Boolean); if (segments.length === 1) { if (!/^(login|logout|cart|search|my|profile|contact)/i.test(segments[0])) rootPages.push(parsed.href); } else if (segments.length > 1) { const prefix = '/' + segments.slice(0, 1).join('/'); if (!pathGroups[prefix]) pathGroups[prefix] = { count: 0 }; pathGroups[prefix].count++; } } catch (e) {}
  });
  const discoveredModes = []; const uniquePrefixes = new Set();
  treeCandidates.forEach(t => { if (!uniquePrefixes.has(t.prefix)) { uniquePrefixes.add(t.prefix); discoveredModes.push({ key: `tree-${t.prefix}`, prefix: t.prefix, label: `🌳 偵測到架構區 (${t.prefix})`, icon: '🔱', count: t.count }); } });
  const uniqueRootPages = Array.from(new Set(rootPages)); if (uniqueRootPages.length >= 1) { discoveredModes.push({ key: 'root-custom', prefix: 'ROOT', label: `📄 一般/自定義頁面 (${uniqueRootPages.length} 頁)`, icon: '📑', count: uniqueRootPages.length }); }
  for (const [prefix, data] of Object.entries(pathGroups)) {
    if (uniquePrefixes.has(prefix)) continue;
    const isKeywordTarget = /shop|product|blog|news|article|case|success|item/i.test(prefix);
    if (data.count >= 3 || (isKeywordTarget && data.count >= 1)) {
      let label = '內容區'; let icon = '📂'; if (/shop|product|item/i.test(prefix)) { label = '產品區'; icon = '📦'; } else if (/blog|news|article/i.test(prefix)) { label = '部落格/文章區'; icon = '📝'; } else if (/case|success/i.test(prefix)) { label = '案例/作品區'; icon = '🏆'; }
      discoveredModes.push({ key: `custom-${prefix}`, prefix, label: `${label} (${prefix})`, icon, count: data.count }); uniquePrefixes.add(prefix);
    }
  }
  return discoveredModes.sort((a,b) => b.count - a.count);
}

function findCommonPrefix(urls) {
  if (!urls.length) return '';
  const sorted = urls.slice().sort(); const first = sorted[0]; const last = sorted[sorted.length - 1];
  let i = 0; while (i < first.length && first.charAt(i) === last.charAt(i)) i++;
  const common = first.substring(0, i); return common.substring(0, common.lastIndexOf('/') + 1) || common;
}

function extractLinks($, baseUrl, mode, customPrefix = null) {
  const links = new Set(); const origin = new URL(baseUrl).origin;
  $('a[href]').each((i, el) => {
    let href = $(el).attr('href'); if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try { const parsed = new URL(href, baseUrl); if (parsed.origin !== origin) return; const p = parsed.pathname; const segments = p.split('/').filter(Boolean); if (customPrefix === 'ROOT' && segments.length === 1) { if (!/^(login|logout|cart|search|my|profile|contact)/i.test(segments[0])) links.add(parsed.origin + p); } else if (customPrefix && p.startsWith(customPrefix)) links.add(parsed.origin + p); else if (mode === 'product') { if (/^\/shop\/[^\/]+-\d+$/i.test(p) || /^\/shop\/product\//i.test(p) || /^\/product\//i.test(p)) links.add(parsed.origin + p); }  else if (mode === 'blog') { if (/^\/blog\/[^\/]+\/post\//i.test(p) || /^\/news\/post\//i.test(p) || /^\/blog\//i.test(p)) links.add(parsed.href); } else if (mode === 'pages') { if (!/^\/(shop|product|blog|news)/i.test(p)) links.add(parsed.href); } else if (mode === 'all') links.add(parsed.href); } catch (e) {}
  });
  return Array.from(links);
}

module.exports = { analyzeHTML, extractLinks, discoverStructure };

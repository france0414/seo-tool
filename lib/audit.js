const cheerio = require('cheerio');

/**
 * 分析 HTML 內容，進行字體樣式與 SEO 審計
 */
function analyzeHTML(html, options = {}) {
  const $ = cheerio.load(html);
  const fontSizeThreshold = options.fontSizeThreshold || 18;
  const pageUrl = options.pageUrl || '';

  const sections = identifySections($);
  const skipHF = options.skipHeaderFooter || false;
  const styleIssues = findStyleIssues($, fontSizeThreshold, sections, skipHF);
  const headingIssues = findHeadingIssues($, sections, skipHF);
  const seoIssues = findSeoIssues($);
  const b2bIssues = findB2bIssues($, sections, skipHF);
  const absoluteUrlIssues = pageUrl ? findAbsoluteUrlIssues($, pageUrl, sections, skipHF) : [];

  const fontTagIssues = styleIssues.filter(i => i.type === 'font-tag');
  const otherStyleIssues = styleIssues.filter(i => i.type !== 'font-tag');

  // 偵測空白標籤 (空的 p, h1-h6 等)
  const emptyTagItems = [];
  $('p, h1, h2, h3, h4, h5, h6').each((i, el) => {
    const text = $(el).text().trim();
    const hasImgChild = $(el).find('img, svg, iframe, video').length > 0;
    const tag = (el.tagName || el.name || '').toUpperCase();
    // 排除 Odoo 資料模型綁定欄位、placeholder 佔位描述、隱藏元素（d-none）
    const hasOeField = $(el).attr('data-oe-model') || $(el).attr('data-oe-field') 
      || $(el).attr('contenteditable') || $(el).attr('data-oe-type') || $(el).attr('data-oe-expression')
      || $(el).attr('placeholder') // Odoo 後台欄位描述佔位符
      || $(el).hasClass('d-none') || $(el).hasClass('d-none-lg') || $(el).hasClass('d-none-xl'); // 隱藏元素

    if (hasOeField) return;

    // 清除所有的空白符號和 &nbsp; 再判斷是否有純文字
    const strippedText = $(el).text().replace(/[\u00A0\s]+/g, '').trim();

    const sec = getSection($, el, sections);
    if (skipHF && (sec === 'Header' || sec === 'Footer')) return;

    let issueType = '';
    
    // 規則 1: 這是特定影響 JS 的 H2 標題 (table_of_content_heading)
    const elId = $(el).attr('id') || '';
    if (elId.startsWith('table_of_content_heading_') && strippedText === '') {
      issueType = 'critical_js_heading';
    } 
    // 規則 2: p 標籤包圖片沒關係，只有真正沒文字也沒圖片的才警告
    else if (tag === 'P' && strippedText === '' && !hasImgChild) {
      issueType = 'empty_p';
    }
    // 規則 3: H1-H6 標籤
    else if (/H[1-6]/.test(tag) && strippedText === '') {
      if (hasImgChild) {
        issueType = 'h_img_only'; // 只有圖片
      } else {
        issueType = 'empty_h'; // 真的全空
      }
    }

    if (issueType) {
      const isSys = isSystemStructure($, el, sections);
      const isPlaceholder = $(el).hasClass('o_default_snippet_text') || !!$(el).attr('placeholder');
      const htmlSnippet = $.html(el).replace(/\s+/g, ' ').substring(0, 120);
      
      // 父容器資訊
      const parent = $(el).parent();
      const parentClass = parent.attr('class') ? '.' + parent.attr('class').split(' ').slice(0, 3).join('.') : '';
      const parentInfo = parent.length ? `<${parent[0].tagName || parent[0].name}${parent.attr('id') ? '#' + parent.attr('id') : ''}${parentClass}>` : '';
      
      // 往前找有用的上下文 (找前面 3 個元素，如果沒文字至少抓它的 ID 或 Class)
      let prevText = '';
      let currPrev = $(el).prev();
      for (let j = 0; j < 3 && currPrev.length; j++) {
        const ptext = currPrev.text().replace(/\s+/g, ' ').trim();
        if (ptext) {
          prevText = `<${currPrev[0].tagName || currPrev[0].name}> "${ptext.substring(0, 80)}${ptext.length > 80 ? '...' : ''}"`;
          break;
        } else {
          // 如果沒文字，至少看它有沒有 id 或 class 當線索
          const id = currPrev.attr('id') ? '#' + currPrev.attr('id') : '';
          const cls = currPrev.attr('class') ? '.' + currPrev.attr('class').split(' ')[0] : '';
          if (id || cls) {
            prevText = `<${currPrev[0].tagName || currPrev[0].name}${id}${cls}> (無文字)`;
            break;
          }
        }
        currPrev = currPrev.prev();
      }
      const prevTag = prevText || '(無明顯前方參考點)';

      // 往後找有用的上下文
      let nextText = '';
      let currNext = $(el).next();
      for (let j = 0; j < 3 && currNext.length; j++) {
        const ntext = currNext.text().replace(/\s+/g, ' ').trim();
        if (ntext) {
          nextText = `<${currNext[0].tagName || currNext[0].name}> "${ntext.substring(0, 80)}${ntext.length > 80 ? '...' : ''}"`;
          break;
        } else {
          const id = currNext.attr('id') ? '#' + currNext.attr('id') : '';
          const cls = currNext.attr('class') ? '.' + currNext.attr('class').split(' ')[0] : '';
          if (id || cls) {
            nextText = `<${currNext[0].tagName || currNext[0].name}${id}${cls}> (無文字)`;
            break;
          }
        }
        currNext = currNext.next();
      }
      const nextTag = nextText || '(無明顯後方參考點)';
      
      emptyTagItems.push({ tag, sec, isSys, isPlaceholder, issueType, html: htmlSnippet, prevTag, nextTag, parentInfo });
    }
  });
  
  const emptyTagIssues = [];
  const severeEmptyTags = emptyTagItems.filter(i => i.issueType !== 'empty_p');
  const emptyPTags = emptyTagItems.filter(i => i.issueType === 'empty_p');

  if (severeEmptyTags.length > 0) {
    const emptyList = severeEmptyTags.map((item, idx) => {
      let note = '';
      if (item.isPlaceholder) { note = ' ⚙️ 系統佔位符'; }
      else if (item.issueType === 'critical_js_heading') { note = ' 🚨 嚴重警告 (破壞TOC結構)'; }
      else if (item.issueType === 'empty_h') { note = ' 🚨 務必刪除或補齊純文字'; }
      else if (item.issueType === 'h_img_only') { note = ' 🔵 錯誤：H 標籤內不要只包圖片，請補齊純文字'; }
      else { note = ' ⚠️ 可考慮刪除'; }
      
      return `── 第 ${idx + 1} 個 ──\n🎯 目標標籤：<${item.tag}>${note}  (位於 ${item.sec})\n\n▼ 尋找線索 (周遭環境) ▼\n  - 父級：${item.parentInfo || '未知'}\n  - 前方：${item.prevTag}\n  - 後方：${item.nextTag}\n\n▼ 請在 Odoo 裡刪除/修改這段 ▼\n💻 ${item.html}\n`;
    }).join('\n\n' + '='.repeat(40) + '\n\n');
    
    emptyTagIssues.push({
      type: 'empty-tag', severity: 'critical', section: 'Content',
      isSystem: severeEmptyTags.some(i => i.isSys),
      message: `發現 ${severeEmptyTags.length} 個嚴重無效標籤或排版異常`,
      suggestion: '空白標題或只包圖片的 H 標籤會嚴重影響 SEO，強烈建議移除或補上純文字內容。',
      tag: '', text: '', code: emptyList, details: severeEmptyTags
    });
  }

  if (emptyPTags.length > 0) {
    const emptyList = emptyPTags.map((item, idx) => {
      return `── 第 ${idx + 1} 個 ──\n🎯 目標標籤：<${item.tag}> ⚠️ 建議刪除  (位於 ${item.sec})\n\n▼ 尋找線索 (周遭環境) ▼\n  - 父級：${item.parentInfo || '未知'}\n  - 前方：${item.prevTag}\n  - 後方：${item.nextTag}\n\n▼ 建議刪除這段 ▼\n💻 ${item.html}\n`;
    }).join('\n\n' + '='.repeat(40) + '\n\n');
    
    emptyTagIssues.push({
      type: 'empty-p-tag', severity: 'low', section: 'Content',
      isSystem: emptyPTags.some(i => i.isSys),
      message: `發現 ${emptyPTags.length} 個多餘的空白段落 (<p><br></p>)`,
      suggestion: '編輯器易產生的無意義段落，純粹建議刪除以保持原始碼乾淨，不扣分。',
      tag: '', text: '', code: emptyList, details: emptyPTags, deduction: 0
    });
  }

  const allIssues = [...styleIssues, ...headingIssues, ...seoIssues, ...b2bIssues, ...emptyTagIssues, ...absoluteUrlIssues];
  const hasCritical = allIssues.some(i => i.severity === 'critical');

  return {
    totalIssues: allIssues.length,
    hasCritical,
    emptyTagCount: emptyTagItems.length,
    categories: {
      absoluteUrl: { order: -1, label: '🚨 絕對路徑警告', issues: absoluteUrlIssues, count: absoluteUrlIssues.length },
      emptyTag: { order: 0, label: '⚠️ 空白標籤警告', issues: emptyTagIssues, count: emptyTagIssues.length },
      heading: { order: 1, label: '標題結構問題', issues: headingIssues, count: headingIssues.length },
      seo: { order: 2, label: 'SEO 基礎問題', issues: seoIssues, count: seoIssues.length },
      b2b: { order: 3, label: 'B2B 外銷加強項', issues: b2bIssues, count: b2bIssues.length },
      style: { order: 4, label: '排版與多餘標籤', issues: otherStyleIssues, count: otherStyleIssues.length },
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

function findAbsoluteUrlIssues($, pageUrl, sections, skipHF = false) {
  let origin = '';
  try { origin = new URL(pageUrl).origin; } catch(e) { return []; }

  const found = []; // { type, tag, attr, url, sec }

  // 檢查圖片 src
  $('img[src]').each((i, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('.gtmc.app')) {
      const sec = getSection($, el, sections);
      if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
      found.push({ tag: 'img', attr: 'src', url: src, sec, isStaging: true });
    } else if (src.startsWith(origin + '/')) {
      const sec = getSection($, el, sections);
      if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
      found.push({ tag: 'img', attr: 'src', url: src, sec, isStaging: false });
    }
  });

  // 檢查 a href 連結
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href') || '';
    if (href.includes('.gtmc.app')) {
      const sec = getSection($, el, sections);
      if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
      const linkText = $(el).text().trim().substring(0, 40) || href.substring(0, 40);
      found.push({ tag: 'a', attr: 'href', url: href, sec, text: linkText, isStaging: true });
    } else if (href.startsWith(origin + '/')) {
      const sec = getSection($, el, sections);
      if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
      const linkText = $(el).text().trim().substring(0, 40) || href.substring(origin.length, origin.length + 40);
      found.push({ tag: 'a', attr: 'href', url: href, sec, text: linkText, isStaging: false });
    }
  });

  // 檢查 style 屬性的背景圖絕對路徑
  // 排除 s_custom_fullHoverBackground 的 .bg-image（JS 動態背景，刻意使用絕對路徑）
  $('[style]').each((i, el) => {
    const isJsBgImage = $(el).hasClass('bg-image') && $(el).closest('.s_custom_fullHoverBackground').length > 0;
    if (isJsBgImage) return; // 跳過此特殊結構
    const style = $(el).attr('style') || '';
    const urlMatch = style.match(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/i);
    if (urlMatch) {
      const url = urlMatch[1];
      if (url.includes('.gtmc.app')) {
        const sec = getSection($, el, sections);
        if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
        found.push({ tag: el.tagName || el.name, attr: 'style:url', url, sec, isStaging: true });
      } else if (url.startsWith(origin + '/')) {
        const sec = getSection($, el, sections);
        if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
        found.push({ tag: el.tagName || el.name, attr: 'style:url', url, sec, isStaging: false });
      }
    }
  });

  if (found.length === 0) return [];

  const hasStaging = found.some(f => f.isStaging);

  // 按 tag 類型分組呈現
  const imgItems = found.filter(f => f.tag === 'img');
  const linkItems = found.filter(f => f.tag === 'a');
  const otherItems = found.filter(f => f.tag !== 'img' && f.tag !== 'a');

  const lines = [];
  if (imgItems.length > 0) {
    lines.push(`📷 圖片絕對路徑 (${imgItems.length} 個)：`);
    imgItems.forEach((f, idx) => {
      const prefix = f.isStaging ? '🚨[舊測試網域]' : '⚠️';
      const short = f.url.replace(origin, '');
      lines.push(`  ${idx + 1}. ${prefix} [${f.sec}] ${short}`);
    });
  }
  if (linkItems.length > 0) {
    lines.push(`\n🔗 連結絕對路徑 (${linkItems.length} 個)：`);
    linkItems.forEach((f, idx) => {
      const prefix = f.isStaging ? '🚨[舊測試網域]' : '⚠️';
      const short = f.url.replace(origin, '');
      lines.push(`  ${idx + 1}. ${prefix} [${f.sec}] ${f.text || ''} → ${short}`);
    });
  }
  if (otherItems.length > 0) {
    lines.push(`\n🎨 CSS/其他絕對路徑 (${otherItems.length} 個)：`);
    otherItems.forEach((f, idx) => {
      const prefix = f.isStaging ? '🚨[舊測試網域]' : '⚠️';
      const short = f.url.replace(origin, '');
      lines.push(`  ${idx + 1}. ${prefix} [${f.sec}] <${f.tag}> ${f.attr} → ${short}`);
    });
  }

  return [{
    type: 'absolute-url',
    severity: hasStaging ? 'critical' : 'high',
    section: 'Content',
    isSystem: false,
    message: `發現 ${found.length} 個內部絕對路徑 (搬機時可能失效)`,
    suggestion: `請將 "${origin}" 開頭的路徑改為相對路徑 (例如 /shop/image.jpg)，以避免搬到正式機時連結失效。`,
    tag: '', text: '',
    code: lines.join('\n')
  }];
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
  if (sec === 'Head') return true; 
  
  // 僅針對真正的「動態生成/非手動」組件進行判定
  // 移除 Header/Footer 的自動判定，讓使用者可以在這些區域手動加 XML 時不被誤標
  const systemSelectors = [
    '.o_wsale_products_grid_table_wrapper', 
    '.o_wsale_products_main_alias',
    '#sh_website_page_sub_categ_style_5',
    '.dynamic_snippet_template', 
    '.s_dynamic', 
    '.s_product_list', 
    '.s_blog_posts',
    '.o_shop_collapse_category'
  ];
  
  if ($(el).closest(systemSelectors.join(',')).length > 0) return true;
  return false;
}

function getSection($, el, sections) {
  if (sections.header && $(el).closest(sections.header).length) return 'Header';
  if (sections.footer && $(el).closest(sections.footer).length) return 'Footer';
  if ($(el).closest('head').length) return 'Head';
  return 'Content';
}

function findStyleIssues($, fontSizeThreshold, sections, skipHF = false) {
  const issues = [];
  $('[style]').each((i, el) => {
    const s = $(el).attr('style') || '';
    const tag = el.tagName || el.name;
    const text = $(el).text().substring(0, 80);
    const sec = getSection($, el, sections);
    if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
    const isSys = isSystemStructure($, el, sections);
    const htmlSnippet = $.html(el).substring(0, 200);
    const match = s.match(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/i);
    if (match) {
      const size = parseFloat(match[1]);
      if (size > fontSizeThreshold) {
        issues.push({
          type: 'font-size', severity: size > 30 ? 'high' : 'medium', section: sec, isSystem: isSys,
          message: `發現內聯字體大小: ${size}px`, suggestion: isSys ? '系統結構樣式。建議回報工程師修正系統範本。' : '過大字體建議改用 CSS Class。',
          tag, text, code: htmlSnippet
        });
      }
    }
    if (/font-family\s*:/i.test(s)) {
      issues.push({
        type: 'font-family', severity: 'medium', section: sec, isSystem: isSys,
        message: `發現內聯 font-family 設定`, suggestion: isSys ? '系統語法。建議調整主版。' : '建議統一全站字體。',
        tag, text, code: htmlSnippet
      });
    }
  });
  // 收集 font 標籤，按區域分組
  const fontBySection = {};
  $('font').each((i, el) => {
    const sec = getSection($, el, sections);
    if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
    const isSys = isSystemStructure($, el, sections);
    if (!fontBySection[sec]) fontBySection[sec] = [];
    const text = $(el).text().substring(0, 50);
    const code = $.html(el).replace(/\s+/g, ' ').substring(0, 120);
    fontBySection[sec].push({ text, code, isSys });
  });
  for (const [sec, fonts] of Object.entries(fontBySection)) {
    const fontList = fonts.map((f, idx) => 
      `── 第 ${idx + 1} 個 ──\n📝 內容: ${f.text || '(無文字)'}\n💻 ${f.code}`
    ).join('\n\n');
    issues.push({
      type: 'font-tag', severity: 'low', section: sec, isSystem: fonts.some(f => f.isSys),
      message: `[${sec}] 共發現 ${fonts.length} 個舊式 <font> 標籤`,
      suggestion: '主要用於色彩或樣式顯示。若不影響排版則可接受。',
      tag: 'font', text: '', code: fontList
    });
  }
  return issues;
}

function findHeadingIssues($, sections, skipHF = false) {
  const issues = [];
  const hArr = [];
  $('h1, h2, h3, h4, h5, h6').each((i, el) => {
    const tag = el.tagName.toLowerCase();
    const lv = parseInt(tag.replace('h', ''));
    const txt = $(el).text().trim() || '(空白內容)';
    const sec = getSection($, el, sections);
    if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
    const isSys = isSystemStructure($, el, sections);
    const htmlSnippet = $.html(el).substring(0, 200);
    hArr.push({ lv, tag, txt, sec, html: htmlSnippet, isSystem: isSys });
    if (!$(el).text().trim()) {
      issues.push({
        type: 'empty-heading', severity: 'critical', section: sec, isSystem: isSys,
        message: `發現空白的 <${tag}> 標籤`, suggestion: isSys ? '系統生成空白標籤，請工程師移除。' : '標題不應為空，這是嚴重的結構錯誤。',
        tag, text: '(空白)', code: htmlSnippet
      });
    }
  });
  const h1s = hArr.filter(h => h.lv === 1);
  if (h1s.length === 0) {
    issues.push({ 
      type: 'missing-h1', 
      severity: 'high', 
      section: 'Content', 
      isSystem: false, 
      message: '頁面缺少 <h1> 標籤', 
      suggestion: '每個頁面應具備一個主標題。若首頁注重美觀，可考慮使用視覺隱藏的 H1 以供 SEO 索引。', 
      tag: 'h1', 
      text: '', 
      code: '(整個頁面沒找到 h1)' 
    });
  } else if (h1s.length > 1) {
    h1s.forEach((h, idx) => { issues.push({ type: 'multiple-h1', severity: 'medium', section: h.sec, isSystem: h.isSystem, message: `多個 <h1> (第 ${idx + 1} 個)`, suggestion: '建議網頁內只有一個 <h1>。', tag: 'h1', text: h.txt, code: h.html }); });
  }
  for (let i = 1; i < hArr.length; i++) {
    const cur = hArr[i]; const prev = hArr[i - 1];
    if (cur.lv - prev.lv > 1) {
      issues.push({ type: 'heading-skip', severity: 'low', section: cur.sec, isSystem: cur.isSystem, message: `標題層級跳躍: <${prev.tag}> → <${cur.tag}>`, suggestion: `中間缺少了 <${'h' + (prev.lv + 1)}>。`, tag: cur.tag, text: `內容: "${cur.txt.substring(0, 50)}"`, code: `上一個: <${prev.tag}> ${prev.txt.substring(0, 20)}...\n目前抓到: ${cur.html}` });
    }
  }
  return issues;
}

function findSeoIssues($) {
  const issues = [];
  if (!$('title').text().trim()) {
    issues.push({ type: 'missing-title', severity: 'low', section: 'Head', isSystem: false, message: '缺少 <title> (SEO部)', suggestion: '補上網頁 Title。這對搜尋排名很重要，通常由負責 SEO 的單位至後台設定。', tag: 'title', text: '', code: '' });
  }
  if (!$('meta[name="description"]').attr('content')) {
    issues.push({ type: 'missing-meta-desc', severity: 'low', section: 'Head', isSystem: false, message: '缺少 Meta Desc (SEO部)', suggestion: '補上 Meta 描述。這對搜尋排名很重要，通常由負責 SEO 的單位至後台設定。', tag: 'meta', text: '', code: '' });
  }
  return issues;
}

function findB2bIssues($, sections, skipHF = false) {
  const issues = [];
  if (!$('html').attr('lang')) {
    issues.push({ type: 'missing-lang', severity: 'low', section: 'Head', isSystem: true, message: '網頁未設定語系 (工程部)', suggestion: '設定如 lang="en"。此為系統動態結構需由工程師優化。', tag: 'html', text: '', code: '' });
  }
  
  // 分區收集缺少 alt 的圖片
  const missingAltBySection = {}; // { 'Content': [{src, isSys, code}], 'Header': [...] }
  $('img').each((i, el) => {
    const alt = $(el).attr('alt');
    const sec = getSection($, el, sections);
    // 如果 skipHF 模式，只處理 Content 區域
    if (skipHF && (sec === 'Header' || sec === 'Footer')) return;
    const isSys = isSystemStructure($, el, sections);
    if (!alt || alt.trim() === '') {
      if (!missingAltBySection[sec]) missingAltBySection[sec] = [];
      const src = $(el).attr('src') || '';
      // 提取乾淨的檔名
      let fileName = '';
      try {
        const decoded = decodeURIComponent(src);
        fileName = decoded.split('/').pop() || decoded;
        if (fileName.length > 50) fileName = fileName.substring(0, 50) + '...';
      } catch(e) { fileName = src.split('/').pop() || src; }
      const imgTag = $.html(el).replace(/\s+/g, ' ').substring(0, 100);
      missingAltBySection[sec].push({ fileName, isSys, imgTag });
    }
  });

  // 每個區域產生一個合併的 issue
  for (const [sec, imgs] of Object.entries(missingAltBySection)) {
    const sysCount = imgs.filter(i => i.isSys).length;
    const manualCount = imgs.length - sysCount;
    const imgList = imgs.map((img, idx) => `${idx + 1}. 📷 ${img.fileName}\n   ${img.imgTag}`).join('\n');
    const suggestion = manualCount > 0 
      ? '請於後台圖片設定中補上 ALT 描述，幫助搜尋引擎理解圖片內容。'
      : '系統生成圖片，建議工程師於模組內加入自動 ALT (如產品名稱)。';
    issues.push({
      type: 'missing-alt', severity: 'medium', section: sec, 
      isSystem: manualCount === 0,
      message: `[${sec}] 共 ${imgs.length} 張圖片缺少 alt 屬性`,
      suggestion,
      tag: 'img', text: '', 
      code: imgList
    });
  }
  return issues;
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
    try { 
      const parsed = new URL(href, baseUrl); if (parsed.origin !== origin) return; 
      const p = parsed.pathname; 
      const segments = p.split('/').filter(Boolean); 
      if (segments.length === 1) { 
        if (!/^(login|logout|cart|search|my|profile|contact|web|quote)/i.test(segments[0])) rootPages.push(parsed.href); 
      } else if (segments.length > 1) { 
        // 排除後台路徑
        if (/^(web|quote|my|slides|survey|livechat|im_livechat)/i.test(segments[0])) return;
        
        // 語系前綴處理：支援 en, zh, fr (2-3碼) 以及 zh_TW, pt_BR, en_US (xx_XX 格式)
        const isLangPrefix = /^[a-z]{2,3}(_[a-z]{2,4})?$/i.test(segments[0]) && segments.length > 1 
          && /^(shop|blog|product|news|article|category|case|page|about|contact|faq)/i.test(segments[1]);
        
        let prefix;
        if (isLangPrefix && segments.length >= 2) {
          prefix = '/' + segments.slice(0, 2).join('/'); // e.g. /en/shop
        } else {
          prefix = '/' + segments[0]; // e.g. /shop
        }
        
        if (!pathGroups[prefix]) pathGroups[prefix] = { count: 0 }; 
        pathGroups[prefix].count++; 
      } 
    } catch (e) {}
  });
  const discoveredModes = []; const uniquePrefixes = new Set();
  treeCandidates.forEach(t => { if (!uniquePrefixes.has(t.prefix)) { uniquePrefixes.add(t.prefix); discoveredModes.push({ key: `tree-${t.prefix}`, prefix: t.prefix, label: `🌳 偵測到架構區 (${t.prefix})`, icon: '🔱', count: t.count }); } });
  const uniqueRootPages = Array.from(new Set(rootPages)); if (uniqueRootPages.length >= 1) { discoveredModes.push({ key: 'root-custom', prefix: 'ROOT', label: `📄 一般/自定義頁面 (${uniqueRootPages.length} 頁)`, icon: '📑', count: uniqueRootPages.length }); }
  for (const [prefix, data] of Object.entries(pathGroups)) {
    if (uniquePrefixes.has(prefix)) continue;
    const isKeywordTarget = /shop|product|blog|news|article|case|success|item/i.test(prefix);
    if (data.count >= 2 || (isKeywordTarget && data.count >= 1)) {
      let label = '內容區'; let icon = '📂';
      // 偵測語系前綴並加到標籤
      const langMatch = prefix.match(/^\/([a-z]{2,3}(?:_[a-z]{2,4})?)\//i);
      const langTag = langMatch ? ` [${langMatch[1].toUpperCase()}]` : '';
      if (/shop|product|item/i.test(prefix)) { label = '產品區'; icon = '📦'; } 
      else if (/blog|news|article/i.test(prefix)) { label = '部落格/文章區'; icon = '📝'; } 
      else if (/case|success/i.test(prefix)) { label = '案例/作品區'; icon = '🏆'; }
      discoveredModes.push({ key: `custom-${prefix}`, prefix, label: `${label}${langTag} (${prefix})`, icon, count: data.count }); uniquePrefixes.add(prefix);
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
    try { const parsed = new URL(href, baseUrl); if (parsed.origin !== origin) return; const p = parsed.pathname; 
    // 排除後台與非公開頁面
    if (/^\/(web|quote|my|slides|survey|livechat|im_livechat|website_forum|helpdesk)/i.test(p)) return;
    const segments = p.split('/').filter(Boolean); if (customPrefix === 'ROOT' && segments.length === 1) { if (!/^(login|logout|cart|search|my|profile|contact|web|quote)/i.test(segments[0])) links.add(parsed.origin + p); } else if (customPrefix && p.startsWith(customPrefix)) links.add(parsed.origin + p); else if (mode === 'product') { if (/^\/shop\/[^\/]+-\d+$/i.test(p) || /^\/shop\/product\//i.test(p) || /^\/product\//i.test(p)) links.add(parsed.origin + p); }  else if (mode === 'blog') { if (/^\/blog\/[^\/]+\/post\//i.test(p) || /^\/news\/post\//i.test(p) || /^\/blog\//i.test(p)) links.add(parsed.href); } else if (mode === 'pages') { if (!/^\/(shop|product|blog|news)/i.test(p)) links.add(parsed.href); } else if (mode === 'all') links.add(parsed.href); } catch (e) {}
  });
  return Array.from(links);
}

module.exports = { analyzeHTML, extractLinks, discoverStructure };

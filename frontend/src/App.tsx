import { useState } from 'react';
import type { ScanResult, CrawlResult, ScanMode, Issue, DiscoveredMode } from './types';

const BASE_MODES: { key: ScanMode; icon: string; label: string; desc: string }[] = [
  { key: 'single', icon: '📄', label: '單一頁面', desc: '掃描網址內容' },
  { key: 'pages', icon: '🌐', label: '全站頁面', desc: '排除產品/部落格' },
  { key: 'all', icon: '♾️', label: '全站掃描', desc: '包含所有連結' },
];

const SEVERITY_MAP: Record<string, string> = { critical: '嚴重', high: '嚴重', medium: '中等', low: '輕微' };

function App() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<ScanMode>('single');
  const [threshold, setThreshold] = useState(18);
  const [maxPages, setMaxPages] = useState(200);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModes, setDiscoveredModes] = useState<DiscoveredMode[]>([]);
  const [singleResult, setSingleResult] = useState<ScanResult | null>(null);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [error, setError] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['seo', 'b2b', 'style', 'fontTag']));
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());
  const [perPage, setPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');

  // 分頁計算
  const totalPages = crawlResult ? Math.ceil(crawlResult.pages.length / perPage) : 0;
  const paginatedPages = crawlResult ? crawlResult.pages.slice(currentPage * perPage, (currentPage + 1) * perPage) : [];

  const handleDiscover = async () => {
    if (!url.trim()) return;
    setDiscovering(true); setError(''); setDiscoveredModes([]);
    try {
      const res = await fetch('/api/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDiscoveredModes(data.discovered || []);
      if (data.discovered?.length > 0) setMode(data.discovered[0].key);
    } catch (err: any) { setError(`偵測失敗: ${err.message}`); }
    finally { setDiscovering(false); }
  };

  const handleScan = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(''); setSingleResult(null); setCrawlResult(null);
    try {
      const isCustomLink = mode.startsWith('custom-') || mode.startsWith('tree-') || mode === 'root-custom';
      const selected = discoveredModes.find(m => m.key === mode);
      
      const ep = (mode === 'single' && !isCustomLink) ? '/api/scan' : '/api/crawl';
      const body = { 
        url: url.trim(), 
        mode: isCustomLink ? 'custom' : mode, 
        customPrefix: isCustomLink ? selected?.prefix : undefined,
        fontSizeThreshold: threshold,
        maxPages
      };
      
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (mode === 'single' && !isCustomLink) setSingleResult(data); else setCrawlResult(data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleDownloadAllImages = async () => {
    if (!crawlResult || downloading) return;
    setDownloading(true);
    setDownloadStatus('準備下載中...');
    try {
      // 從所有頁面中過濾出產品圖片資料
      const productsToDownload = crawlResult.pages
        .filter((p: any) => p.productImages && p.productImages.length > 0)
        .map((p: any) => {
          // 取得網址的最後一段作為唯一識別 (例如 charger-station-151)
          const segments = p.url.split('/').filter(Boolean);
          const urlId = segments[segments.length - 1] || 'product';
          
          // 取得產品名稱，優先使用第一張圖的 alt
          const altName = p.productImages[0]?.alt?.replace(/[\/\\?%*:|"<>]/g, '-').trim();
          
          // 組合名稱：若有 alt 則使用 "Alt_URLID"，否則只用 URLID，確保資料夾不重複
          const uniqueName = (altName && altName !== 'product_image') 
            ? `${altName}_${urlId}` 
            : urlId;
          
          return {
            name: uniqueName,
            urls: p.productImages.map((img: any) => img.highRes || img.standardRes).filter(Boolean)
          };
        })
        .filter(p => p.urls.length > 0);

      if (productsToDownload.length === 0) {
        alert('未偵測到任何含有產品輪播圖的頁面。');
        return;
      }

      setDownloadStatus(`正在下載 ${productsToDownload.length} 個產品...`);
      const res = await fetch('/api/download-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: productsToDownload })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      alert(`✅ 下載完成！\n共處理了 ${data.results.length} 個產品。\n檔案已存放在專案下的 downloads/ 資料夾。`);
    } catch (err: any) {
      alert(`下載失敗: ${err.message}`);
    } finally {
      setDownloading(false);
      setDownloadStatus('');
    }
  };

  const toggleCategory = (key: string) => setCollapsed(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const togglePage = (idx: number) => setExpandedPages(prev => { const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; });
  const getScoreColor = (s: number) => s >= 80 ? 'var(--accent-green)' : s >= 50 ? 'var(--accent-yellow)' : 'var(--accent-red)';
  const getSortedCats = (cats: any) => Object.entries(cats || {}).sort((a:any, b:any) => (a[1].order || 0) - (b[1].order || 0));

  const renderIssuesList = (categories: Record<string, any>, filter: string) => {
    return getSortedCats(categories).map(([key, cat]: any) => {
      const issues = filter === 'all' ? cat.issues : cat.issues.filter((i: Issue) => i.section === filter);
      if (issues.length === 0) return null;
      const isCollapsed = collapsed.has(key);
      return (
        <div key={key} className="issues-section">
          <h3 className="issues-title" onClick={() => toggleCategory(key)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
            <span>{cat.label} ({issues.length})</span>
            <span>{isCollapsed ? '➕' : '➖'}</span>
          </h3>
          {!isCollapsed && (
            <div className="issues-container">
              {cat.description && <p style={{ fontSize: '14px', color: 'var(--text-muted)', marginBottom: '8px' }}>{cat.description}</p>}
              {issues.map((issue: Issue, idx: number) => (
                <div key={idx} className={`issue-card ${issue.isSystem ? 'system-issue' : ''}`}>
                  <div className="issue-header">
                    <span className={`issue-severity ${issue.severity === 'critical' ? 'high' : issue.severity}`}>{SEVERITY_MAP[issue.severity]}</span>
                    <span className="issue-section-tag">{issue.section}</span>
                    {issue.isSystem && <span className="system-badge">⚙️ 系統動態結構</span>}
                  </div>
                  {issue.isSystem && <div className="system-notice">⚠️ 此為系統框架產生。</div>}
                  <p className="issue-message">{issue.message}</p>
                  <div className="issue-suggestion">💡 {issue.suggestion}</div>
                  {issue.type === 'empty-tag' && issue.details && Array.isArray(issue.details) ? (
                    <div className="issue-details-grid" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      {issue.details.map((d: any, i: number) => (
                        <div key={i} style={{ padding: '12px', background: 'var(--bg-body)', borderRadius: '6px', borderLeft: '3px solid var(--accent-yellow)' }}>
                          <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '8px', lineHeight: '1.6' }}>
                            <div style={{ fontWeight: 'bold' }}>尋找線索 (周遭環境)：</div>
                            <div style={{ paddingLeft: '8px' }}>- 父級：{d.parentInfo || '未知'}</div>
                            <div style={{ paddingLeft: '8px' }}>- 前方：{d.prevTag}</div>
                            <div style={{ paddingLeft: '8px' }}>- 後方：{d.nextTag}</div>
                          </div>
                          <div style={{ background: '#2d1518', border: '1px solid var(--accent-red)', padding: '10px', borderRadius: '4px', color: '#ffb3b3' }}>
                            <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '6px', color: 'var(--accent-red)', fontWeight: 'bold' }}>
                              🚨 請在 Odoo 裡找到並刪除這段程式碼：
                            </div>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '15px', color: '#fff' }}>{d.html}</pre>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (issue.code && <pre className="issue-code">{issue.code}</pre>)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  return (
    <div className="app-container">
       <header className="app-header"><div className="app-logo"><div className="app-logo-icon">🔍</div><h1 className="app-title">SEO 與樣式檢查工具 (智能偵測版)</h1></div></header>
      <div className="input-section"><div className="input-group"><input type="url" className="url-input" placeholder="貼上網址..." value={url} onChange={e => setUrl(e.target.value)} /><button className="scan-btn secondary" onClick={handleDiscover} disabled={discovering || loading}>{discovering ? '偵測中...' : '📍 偵測網站區塊'}</button><button className="scan-btn" onClick={handleScan} disabled={loading || discovering}>{loading ? '稍候' : '開始掃描'}</button></div><div className="threshold-row">⚙️ Font-size 門檻：<input type="number" className="threshold-input" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} /> px &nbsp;&nbsp; 📑 最大掃描頁數：<input type="number" className="threshold-input" value={maxPages} onChange={e => setMaxPages(Math.min(500, Math.max(1, parseInt(e.target.value) || 60)))} style={{ width: '70px' }} /> 頁</div></div>
      <div className="mode-selector"><div className="mode-group-label">基本模式:</div><div className="mode-grid">{BASE_MODES.map(m => (<button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)}>{m.icon} {m.label}</button>))}</div>{discoveredModes.length > 0 && (<><div className="mode-group-label" style={{ marginTop: '15px', color: 'var(--accent-blue)' }}>✨ 智能發現區塊 (建議選取):</div><div className="mode-grid">{discoveredModes.map(m => (<button key={m.key} className={`mode-btn discovered ${m.key.startsWith('tree-') ? 'tree-mode' : ''} ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={`前綴: ${m.prefix}`}>{m.icon} {m.label}</button>))}</div></>)}</div>
      {loading && <div className="loading-section"><div className="spinner" /><p>正在抓取分頁進行診斷...</p></div>}
      {error && <div className="error-card">❌ {error}</div>}
      {crawlResult && (
        <div className="crawl-result-container">
          <div className="score-section"><div className="score-header"><h3>批量掃描總結</h3><span>總計問題分佈</span></div><div className="stats-grid">{Object.entries(crawlResult.summary.categoryCounts).map(([k, c]) => { const catLabels: Record<string, string> = { heading: '標題結構', seo: 'SEO 基礎', b2b: 'B2B 加強', style: '排版與多餘標籤', fontTag: '過時標籤' }; const label = catLabels[k] ? `${catLabels[k]}問題` : (BASE_MODES.find(m=>m.key===k as any)?.label || k); return (<div key={k} className="stat-card"><div className="stat-count">{c}</div><div className="stat-label">{label}</div></div>);})}</div></div>

          {/* Header/Footer 共用問題獨立區塊 */}
          {(crawlResult.commonIssues?.headerFooter?.issues?.length ?? 0) > 0 && (
            <div className="common-issues-section" style={{ background: 'var(--bg-card)', border: '1px solid var(--accent-yellow)', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
              <h3 style={{ marginBottom: '16px', color: 'var(--accent-yellow)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer' }} onClick={() => toggleCategory('commonHF')}>
                <span>🔒 Header / Footer 共用問題 ({crawlResult.commonIssues?.headerFooter?.issues?.length ?? 0} 個，僅顯示一次)</span>
                <span>{collapsed.has('commonHF') ? '➕' : '➖'}</span>
              </h3>
              {!collapsed.has('commonHF') && (
                <div className="issues-container">
                  {crawlResult.commonIssues?.headerFooter?.issues?.map((issue: any, idx: number) => (
                    <div key={idx} className={`issue-card ${issue.isSystem ? 'system-issue' : ''}`}>
                      <div className="issue-header">
                        <span className={`issue-severity ${issue.severity === 'critical' ? 'high' : issue.severity}`}>{SEVERITY_MAP[issue.severity]}</span>
                        <span className="issue-section-tag">{issue.section}</span>
                        {issue.category && <span style={{ fontSize: '11px', background: '#30363d', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>{issue.category}</span>}
                        {issue.isSystem && <span className="system-badge">⚙️ 系統動態結構</span>}
                      </div>
                      {issue.isSystem && <div className="system-notice">⚠️ 此為系統框架產生。</div>}
                      <p className="issue-message">{issue.message}</p>
                      <div className="issue-suggestion">💡 {issue.suggestion}</div>
                      {issue.type === 'empty-tag' && issue.details && Array.isArray(issue.details) ? (
                        <div className="issue-details-grid" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                          {issue.details.map((d: any, i: number) => (
                            <div key={i} style={{ padding: '12px', background: 'var(--bg-body)', borderRadius: '6px', borderLeft: '3px solid var(--accent-yellow)' }}>
                              <div style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '8px', lineHeight: '1.6' }}>
                                <div style={{ fontWeight: 'bold' }}>尋找線索 (周遭環境)：</div>
                                <div style={{ paddingLeft: '8px' }}>- 父級：{d.parentInfo || '未知'}</div>
                                <div style={{ paddingLeft: '8px' }}>- 前方：{d.prevTag}</div>
                                <div style={{ paddingLeft: '8px' }}>- 後方：{d.nextTag}</div>
                              </div>
                              <div style={{ background: '#2d1518', border: '1px solid var(--accent-red)', padding: '10px', borderRadius: '4px', color: '#ffb3b3' }}>
                                <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '6px', color: 'var(--accent-red)', fontWeight: 'bold' }}>
                                  🚨 請在 Odoo 裡找到並刪除這段程式碼：
                                </div>
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '15px', color: '#fff' }}>{d.html}</pre>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (issue.code && <pre className="issue-code">{issue.code}</pre>)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 分頁控制 */}
          <div className="pages-list">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 10px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                <h3 style={{ margin: 0 }}>頁面掃描結果 ({crawlResult.pages.length} 頁)</h3>
                <button 
                  className={`scan-btn ${downloading ? 'loading' : ''}`}
                  style={{ padding: '8px 16px', fontSize: '14px', background: 'var(--accent-yellow)', color: '#000' }}
                  onClick={handleDownloadAllImages}
                  disabled={downloading}
                >
                  {downloading ? `📥 ${downloadStatus}` : '📦 一鍵下載所有產品圖片'}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-muted)' }}>
                每頁顯示：<input type="number" className="threshold-input" value={perPage} onChange={e => { setPerPage(Math.max(1, parseInt(e.target.value) || 10)); setCurrentPage(0); }} style={{ width: '80px', fontSize: '16px', padding: '6px 8px' }} /> 筆
              </div>
            </div>
            {/* 分頁按鈕 */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="filter-chip" disabled={currentPage === 0} onClick={() => setCurrentPage(p => p - 1)}>◀ 上一頁</button>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '0 8px' }}>第 {currentPage + 1} / {totalPages} 頁</span>
                <button className="filter-chip" disabled={currentPage >= totalPages - 1} onClick={() => setCurrentPage(p => p + 1)}>下一頁 ▶</button>
              </div>
            )}
            {paginatedPages.map((p: any, localIdx: number) => {
              const globalIdx = currentPage * perPage + localIdx;
              const isCritical = p.hasCritical;
              return (
                <div key={globalIdx} className="page-result-item">
                  <div className="page-result-header" onClick={() => togglePage(globalIdx)} style={{ 
                    cursor: 'pointer', background: isCritical ? '#2d1518' : 'var(--bg-card)', padding: '12px', borderRadius: '8px', marginBottom: '8px', 
                    border: isCritical ? '2px solid var(--accent-red)' : '1px solid var(--border-color)', 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' 
                  }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '75%' }}>
                      <span style={{ color: isCritical ? 'var(--accent-red)' : 'var(--accent-blue)', fontWeight: 'bold', marginRight: '10px' }}>
                        {isCritical ? '🚨 ' : '⚠️ '}{p.totalIssues} 個問題
                      </span>
                      {p.emptyTagCount > 0 && <span style={{ fontSize: '11px', background: 'var(--accent-yellow)', color: '#000', padding: '2px 6px', borderRadius: '4px', marginRight: '8px', fontWeight: 'bold' }}>⚠ {p.emptyTagCount} 個空白</span>}
                      <span style={{ fontSize: '12px', opacity: 0.8 }}>{p.url}</span>
                    </div>
                    <span>{expandedPages.has(globalIdx) ? '收合詳情 ▲' : '查看詳情 ▼'}</span>
                  </div>
                  {expandedPages.has(globalIdx) && (
                    <div className="page-result-detail" style={{ paddingLeft: '20px', marginBottom: '20px', borderLeft: `2px solid ${isCritical ? 'var(--accent-red)' : 'var(--accent-blue)'}` }}>{renderIssuesList(p.categories, 'all')}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {singleResult && (
        <>
          <div className="score-section">
            <div className="stats-grid">{getSortedCats(singleResult.categories).map(([k, cat]: any) => (<div key={k} className="stat-card" style={{ borderLeft: k==='heading' ? '4px solid var(--accent-blue)' : '' }} onClick={() => toggleCategory(k)}><div className="stat-count">{cat.count}</div><div className="stat-label">{cat.label}</div></div>))}</div>
          </div>
          <div className="section-filter">{['all', 'Header', 'Content', 'Footer', 'Head'].map(s => <button key={s} className={`filter-chip ${sectionFilter === s ? 'active' : ''}`} onClick={() => setSectionFilter(s)}>{s}</button>)}</div>
          {renderIssuesList(singleResult.categories, sectionFilter)}
        </>
      )}
    </div>
  );
}
export default App;

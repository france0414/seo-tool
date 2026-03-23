import { useState } from 'react';
import type { ScanResult, CrawlResult, ScanMode, Issue, DiscoveredMode } from './types';

const BASE_MODES: { key: ScanMode; icon: string; label: string; desc: string }[] = [
  { key: 'single', icon: '📄', label: '單一頁面', desc: '掃描網址內容' },
  { key: 'pages', icon: '🌐', label: '全站頁面', desc: '排除產品/部落格' },
  { key: 'all', icon: '♾️', label: '全站掃描', desc: '包含所有連結' },
];

const SEVERITY_MAP: Record<string, string> = { high: '嚴重', medium: '中等', low: '輕微' };

function App() {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<ScanMode>('single');
  const [threshold, setThreshold] = useState(18);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredModes, setDiscoveredModes] = useState<DiscoveredMode[]>([]);
  const [singleResult, setSingleResult] = useState<ScanResult | null>(null);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [error, setError] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['seo', 'b2b', 'style', 'fontTag']));
  const [expandedPages, setExpandedPages] = useState<Set<number>>(new Set());

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
        fontSizeThreshold: threshold 
      };
      
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (mode === 'single' && !isCustomLink) setSingleResult(data); else setCrawlResult(data);
    } catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
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
              {cat.description && <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>{cat.description}</p>}
              {issues.map((issue: Issue, idx: number) => (
                <div key={idx} className={`issue-card ${issue.isSystem ? 'system-issue' : ''}`}>
                  <div className="issue-header">
                    <span className={`issue-severity ${issue.severity}`}>{SEVERITY_MAP[issue.severity]}</span>
                    <span className="issue-section-tag">{issue.section}</span>
                    {issue.isSystem && <span className="system-badge">⚙️ 系統動態結構</span>}
                    <span className="issue-deduction">
                      {issue.isSystem ? '免扣分' : `-${issue.deduction}`}
                    </span>
                  </div>
                  {issue.isSystem && <div className="system-notice">⚠️ 此為系統框架產生，需由系統工程師優化。</div>}
                  <p className="issue-message">{issue.message}</p>
                  <div className="issue-suggestion">💡 {issue.suggestion}</div>
                  {issue.code && <pre className="issue-code">{issue.code}</pre>}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    });
  };

  const currentCircumference = 2 * Math.PI * 56;

  return (
    <div className="app-container">
       <header className="app-header"><div className="app-logo"><div className="app-logo-icon">🔍</div><h1 className="app-title">SEO 與樣式檢查工具 (智能偵測版)</h1></div></header>
      <div className="input-section"><div className="input-group"><input type="url" className="url-input" placeholder="貼上網址..." value={url} onChange={e => setUrl(e.target.value)} /><button className="scan-btn secondary" onClick={handleDiscover} disabled={discovering || loading}>{discovering ? '偵測中...' : '📍 偵測網站區塊'}</button><button className="scan-btn" onClick={handleScan} disabled={loading || discovering}>{loading ? '稍候' : '開始掃描'}</button></div><div className="threshold-row">⚙️ Font-size 門檻：<input type="number" className="threshold-input" value={threshold} onChange={e => setThreshold(parseInt(e.target.value))} /> px</div></div>
      <div className="mode-selector"><div className="mode-group-label">基本模式:</div><div className="mode-grid">{BASE_MODES.map(m => (<button key={m.key} className={`mode-btn ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)}>{m.icon} {m.label}</button>))}</div>{discoveredModes.length > 0 && (<><div className="mode-group-label" style={{ marginTop: '15px', color: 'var(--accent-blue)' }}>✨ 智能發現區塊 (建議選取):</div><div className="mode-grid">{discoveredModes.map(m => (<button key={m.key} className={`mode-btn discovered ${m.key.startsWith('tree-') ? 'tree-mode' : ''} ${mode === m.key ? 'active' : ''}`} onClick={() => setMode(m.key)} title={`前綴: ${m.prefix}`}>{m.icon} {m.label}</button>))}</div></>)}</div>
      {loading && <div className="loading-section"><div className="spinner" /><p>正在抓取分頁進行診斷...</p></div>}
      {error && <div className="error-card">❌ {error}</div>}
      {crawlResult && (
        <div className="crawl-result-container">
          <div className="score-section"><div className="score-header"><h3>批量掃描總結</h3><span>平均分數：<strong style={{ color: getScoreColor(crawlResult.summary.avgScore) }}>{crawlResult.summary.avgScore}</strong></span></div><div className="stats-grid">{Object.entries(crawlResult.summary.categoryCounts).map(([k, c]) => (<div key={k} className="stat-card"><div className="stat-count">{c}</div><div className="stat-label">{(BASE_MODES.find(m=>m.key===k as any) || {label:k}).label} 相關問題</div></div>))}</div></div>
          <div className="pages-list"><h3 style={{ margin: '20px 0 10px' }}>成功掃描清單 ({crawlResult.pages.length} 頁)</h3>{crawlResult.pages.map((p, idx) => (<div key={idx} className="page-result-item"><div className="page-result-header" onClick={() => togglePage(idx)} style={{ cursor: 'pointer', background: 'var(--bg-card)', padding: '12px', borderRadius: '8px', marginBottom: '8px', border: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}><span style={{ color: getScoreColor(p.score), fontWeight: 'bold', marginRight: '10px' }}>{p.score}分</span><span style={{ fontSize: '12px', opacity: 0.8 }}>{p.url}</span></div><span>{expandedPages.has(idx) ? '收合詳情 ▲' : '查看詳情 ▼'}</span></div>{expandedPages.has(idx) && (<div className="page-result-detail" style={{ paddingLeft: '20px', marginBottom: '20px', borderLeft: '2px solid var(--accent-blue)' }}>{renderIssuesList(p.categories, 'all')}</div>)}</div>))}</div>
        </div>
      )}
      {singleResult && (
        <>
          <div className="score-section"><div className="score-card"><div className="score-gauge"><svg width="140" height="140"><circle className="score-gauge-bg" cx="70" cy="70" r="56" /><circle className="score-gauge-fill" cx="70" cy="70" r="56" stroke={getScoreColor(singleResult.score)} strokeDasharray={currentCircumference} strokeDashoffset={currentCircumference - (singleResult.score / 100) * currentCircumference} /></svg><span className="score-value" style={{ color: getScoreColor(singleResult.score) }}>{singleResult.score}</span></div></div>
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

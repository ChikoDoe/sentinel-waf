import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || `ws://${location.host.replace(/:\d+$/, '')}:3001`;
const API_URL = import.meta.env.VITE_API_URL || `http://${location.host.replace(/:\d+$/, '')}:3001`;

const SEV_STYLE = {
  LOW:      { bg: "rgba(34,197,94,0.12)",   border: "#22c55e", text: "#4ade80" },
  MEDIUM:   { bg: "rgba(234,179,8,0.12)",   border: "#eab308", text: "#facc15" },
  HIGH:     { bg: "rgba(249,115,22,0.12)",  border: "#f97316", text: "#fb923c" },
  CRITICAL: { bg: "rgba(239,68,68,0.12)",   border: "#ef4444", text: "#f87171" },
};

const ACTION_COLOR = {
  block: "#f87171", challenge: "#facc15",
  js_challenge: "#fb923c", managed_challenge: "#a78bfa", log: "#60a5fa",
};

function useWS(url) {
  const [data, setData] = useState(null);
  const [connected, setConnected] = useState(false);
  const ws = useRef(null);
  const listeners = useRef({});

  const on = useCallback((type, fn) => { listeners.current[type] = fn; }, []);

  useEffect(() => {
    let retryTimer;
    function connect() {
      ws.current = new WebSocket(url);
      ws.current.onopen = () => setConnected(true);
      ws.current.onclose = () => { setConnected(false); retryTimer = setTimeout(connect, 3000); };
      ws.current.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          setData(msg);
          listeners.current[msg.type]?.(msg.data);
          listeners.current['*']?.(msg);
        } catch {}
      };
    }
    connect();
    return () => { ws.current?.close(); clearTimeout(retryTimer); };
  }, [url]);

  return { connected, lastMsg: data, on };
}

export default function Dashboard() {
  const { connected, on } = useWS(WS_URL);
  const [events, setEvents] = useState([]);
  const [rules, setRules] = useState([]);
  const [stats, setStats] = useState({ total: 0, blocked: 0, breached: 0 });
  const [aiLog, setAiLog] = useState([]);
  const [urls, setUrls] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [tab, setTab] = useState('threats');
  const [breach, setBreach] = useState(null);
  const [cfRules, setCfRules] = useState({ wafRules: [], rateLimitRules: [] });
  const [fwRules, setFwRules] = useState({ managed: [], systemRules: [] });
  const eventsRef = useRef(null);

  // WebSocket handlers
  useEffect(() => {
    on('init', d => {
      setEvents(d.events || []);
      setRules(d.rules || []);
      setStats(d.stats || {});
      setUrls(d.monitoredUrls || []);
    });
    on('event', e => setEvents(p => [e, ...p.slice(0, 499)]));
    on('stats', s => setStats(s));
    on('breach', e => { setBreach(e); setTimeout(() => setBreach(null), 8000); });
    on('rule_added', r => setRules(p => [r, ...p]));
    on('rule_removed', ({ id }) => setRules(p => p.filter(r => r.id !== id)));
    on('url_added', u => setUrls(p => [...p, u]));
    on('url_removed', ({ url }) => setUrls(p => p.filter(u => u.url !== url)));
    on('ai_thinking', ({ eventId }) => setAiLog(p => [{ eventId, status: 'thinking', ts: Date.now() }, ...p.slice(0, 19)]));
    on('ai_done', ({ eventId, rules: r }) => setAiLog(p => p.map(l => l.eventId === eventId ? { ...l, status: 'done', rules: r } : l)));
    on('ai_error', ({ eventId, error }) => setAiLog(p => p.map(l => l.eventId === eventId ? { ...l, status: 'error', error } : l)));
  }, [on]);

  // Load CF + FW rules when tab changes
  useEffect(() => {
    if (tab === 'cloudflare') {
      fetch(`${API_URL}/api/cloudflare/rules`).then(r => r.json()).then(setCfRules).catch(() => {});
    }
    if (tab === 'firewall') {
      fetch(`${API_URL}/api/firewall`).then(r => r.json()).then(setFwRules).catch(() => {});
    }
  }, [tab]);

  async function addUrl() {
    if (!newUrl.trim()) return;
    try {
      const res = await fetch(`${API_URL}/api/urls`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim() }),
      });
      if (res.ok) setNewUrl('');
      else { const d = await res.json(); alert(d.error); }
    } catch (e) { alert(e.message); }
  }

  async function removeUrl(url) {
    await fetch(`${API_URL}/api/urls`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
  }

  async function analyzeEvent(eventId) {
    setAiLog(p => [{ eventId, status: 'thinking', ts: Date.now() }, ...p.slice(0, 19)]);
    const res = await fetch(`${API_URL}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    });
    const d = await res.json();
    if (d.ok) setAiLog(p => p.map(l => l.eventId === eventId ? { ...l, status: 'done', rules: d.rules } : l));
    else setAiLog(p => p.map(l => l.eventId === eventId ? { ...l, status: 'error', error: d.error } : l));
  }

  async function deleteRule(id) {
    await fetch(`${API_URL}/api/rules/${id}`, { method: 'DELETE' });
  }

  const blockRate = stats.total > 0 ? ((stats.blocked / stats.total) * 100).toFixed(1) : '0.0';

  return (
    <div style={{ minHeight: '100vh', background: '#040d18', fontFamily: "'JetBrains Mono', monospace", color: '#e2e8f0', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Orbitron:wght@700;900&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #040d18; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #07111f; }
        ::-webkit-scrollbar-thumb { background: #1a3a5c; border-radius: 2px; }
        .grid-bg { background-image: linear-gradient(rgba(0,180,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.025) 1px, transparent 1px); background-size: 36px 36px; }
        .blink { animation: blink 1.2s step-end infinite; }
        @keyframes blink { 50% { opacity: 0; } }
        .slide-in { animation: slideIn 0.25s ease-out; }
        @keyframes slideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
        .ai-pulse { animation: aiPulse 1.4s ease-in-out infinite; }
        @keyframes aiPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        .breach-flash { animation: breachFlash 0.5s ease-out; }
        @keyframes breachFlash { 0%{background:rgba(239,68,68,0.3)} 100%{background:transparent} }
        tr:hover { background: rgba(0,180,255,0.05) !important; }
        button { cursor: pointer; transition: all 0.15s; font-family: inherit; }
        button:hover { opacity: 0.8; }
        input { font-family: inherit; outline: none; }
        .tab-btn { padding: 10px 18px; border: none; background: transparent; font-size: 10px; letter-spacing: 2px; border-bottom: 2px solid transparent; }
        .tab-active { color: #00c8ff !important; border-bottom-color: #00c8ff !important; background: rgba(0,200,255,0.07) !important; }
      `}</style>

      <div className="grid-bg" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

        {/* ── Header ── */}
        <header style={{ borderBottom: '1px solid rgba(0,200,255,0.12)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(4,13,24,0.95)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 22 }}>🛡️</div>
            <div>
              <div style={{ fontFamily: 'Orbitron', fontSize: 13, fontWeight: 900, letterSpacing: 4, color: '#00c8ff' }}>SENTINEL WAF</div>
              <div style={{ fontSize: 8, color: '#3a6a8a', letterSpacing: 2 }}>AI-POWERED · NGINX · CLOUDFLARE · IPTABLES</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            {[
              { l: 'REQUESTS', v: stats.total?.toLocaleString?.() || 0, c: '#60a5fa' },
              { l: 'BLOCKED',  v: stats.blocked?.toLocaleString?.() || 0, c: '#4ade80' },
              { l: 'BREACHED', v: stats.breached?.toLocaleString?.() || 0, c: '#f87171' },
              { l: 'BLOCK RATE', v: `${blockRate}%`, c: parseFloat(blockRate) > 90 ? '#4ade80' : '#facc15' },
            ].map(s => (
              <div key={s.l} style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'Orbitron', fontSize: 16, fontWeight: 700, color: s.c }}>{s.v}</div>
                <div style={{ fontSize: 7, color: '#3a6a8a', letterSpacing: 1.5 }}>{s.l}</div>
              </div>
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: connected ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${connected ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 4 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? '#4ade80' : '#f87171', boxShadow: `0 0 8px ${connected ? '#4ade80' : '#f87171'}` }} className={connected ? 'blink' : ''} />
              <span style={{ fontSize: 9, color: connected ? '#4ade80' : '#f87171', letterSpacing: 1 }}>{connected ? 'LIVE' : 'OFFLINE'}</span>
            </div>
          </div>
        </header>

        {/* ── Breach Banner ── */}
        {breach && (
          <div className="breach-flash" style={{ padding: '8px 20px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 9, color: '#f87171', letterSpacing: 2, fontWeight: 700 }}>⚠ BREACH</span>
            <span style={{ fontSize: 11, color: '#fca5a5', flex: 1 }}>{breach.type} · {breach.ip} → {breach.path}</span>
            <span className="ai-pulse" style={{ fontSize: 9, color: '#60a5fa' }}>🤖 AI GENERATING RULES...</span>
          </div>
        )}

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* ── Left Panel: AI Log + URL Manager ── */}
          <div style={{ width: 280, borderRight: '1px solid rgba(0,200,255,0.1)', display: 'flex', flexDirection: 'column', background: 'rgba(4,10,20,0.5)' }}>

            {/* URL Manager */}
            <div style={{ padding: 14, borderBottom: '1px solid rgba(0,200,255,0.1)' }}>
              <div style={{ fontSize: 9, color: '#60a5fa', letterSpacing: 2, marginBottom: 10 }}>🎯 MONITORED URLS</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addUrl()}
                  placeholder="https://example.com/api"
                  style={{ flex: 1, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(0,200,255,0.2)', color: '#e2e8f0', padding: '5px 8px', borderRadius: 3, fontSize: 10 }}
                />
                <button onClick={addUrl} style={{ padding: '5px 10px', background: 'rgba(0,200,255,0.15)', border: '1px solid rgba(0,200,255,0.3)', color: '#00c8ff', borderRadius: 3, fontSize: 10 }}>+</button>
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                {urls.length === 0 && <div style={{ fontSize: 9, color: '#2d4a6a', textAlign: 'center', padding: 8 }}>No URLs monitored yet</div>}
                {urls.map(u => (
                  <div key={u.url} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 10, color: '#60a5fa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.host}</div>
                      <div style={{ fontSize: 8, color: '#2d4a6a' }}>{u.path}</div>
                    </div>
                    <button onClick={() => removeUrl(u.url)} style={{ background: 'none', border: 'none', color: '#f87171', fontSize: 12, padding: '0 4px' }}>×</button>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Log */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(0,200,255,0.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 9, color: '#60a5fa', letterSpacing: 2 }}>🤖 AI RULE ENGINE</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {aiLog.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#1a3a5c', fontSize: 10 }}>Waiting for breaches...</div>}
              {aiLog.map((log, i) => (
                <div key={i} className="slide-in" style={{ marginBottom: 10, padding: 10, background: log.status === 'done' ? 'rgba(74,222,128,0.05)' : log.status === 'error' ? 'rgba(239,68,68,0.05)' : 'rgba(96,165,250,0.05)', border: `1px solid ${log.status === 'done' ? 'rgba(74,222,128,0.2)' : log.status === 'error' ? 'rgba(239,68,68,0.2)' : 'rgba(96,165,250,0.15)'}`, borderRadius: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 8, color: '#2d4a6a' }}>{new Date(log.ts).toLocaleTimeString()}</span>
                    <span className={log.status === 'thinking' ? 'ai-pulse' : ''} style={{ fontSize: 8, color: log.status === 'done' ? '#4ade80' : log.status === 'error' ? '#f87171' : '#60a5fa' }}>
                      {log.status === 'thinking' ? '⟳ ANALYZING' : log.status === 'done' ? `✓ ${log.rules?.length || 0} RULES` : '✗ ERROR'}
                    </span>
                  </div>
                  {log.rules?.map((r, j) => (
                    <div key={j} style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 10, color: '#4ade80', fontWeight: 600 }}>{r.ruleName}</div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 3, flexWrap: 'wrap' }}>
                        {r.targets?.map(t => <span key={t} style={{ fontSize: 7, padding: '1px 5px', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', borderRadius: 2, letterSpacing: 1 }}>{t.toUpperCase()}</span>)}
                        <span style={{ fontSize: 7, padding: '1px 5px', background: 'rgba(239,68,68,0.15)', color: '#f87171', borderRadius: 2 }}>{r.cfAction?.toUpperCase()}</span>
                        <span style={{ fontSize: 7, color: '#4ade80' }}>{r.confidence}%</span>
                      </div>
                      {r.reasoning && <div style={{ fontSize: 9, color: '#64748b', marginTop: 3 }}>{r.reasoning}</div>}
                    </div>
                  ))}
                  {log.error && <div style={{ fontSize: 9, color: '#f87171', marginTop: 4 }}>{log.error}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Main Content ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* Tabs */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,200,255,0.1)', background: 'rgba(4,10,20,0.5)' }}>
              {[
                { id: 'threats', label: 'LIVE THREATS' },
                { id: 'rules', label: `ACTIVE RULES (${rules.length})` },
                { id: 'cloudflare', label: 'CLOUDFLARE' },
                { id: 'firewall', label: 'IPTABLES/NFT' },
              ].map(t => (
                <button key={t.id} onClick={() => setTab(t.id)} className={`tab-btn ${tab === t.id ? 'tab-active' : ''}`} style={{ color: tab === t.id ? '#00c8ff' : '#3a6a8a' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {/* ── Threats Tab ── */}
            {tab === 'threats' && (
              <div ref={eventsRef} style={{ flex: 1, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr style={{ position: 'sticky', top: 0, background: 'rgba(4,10,20,0.98)', zIndex: 10 }}>
                      {['TIME', 'IP', 'METHOD', 'PATH', 'REQ/MIN', 'TYPE', 'SEVERITY', 'STATUS', ''].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 8, color: '#3a6a8a', letterSpacing: 1.5, borderBottom: '1px solid rgba(0,200,255,0.08)', fontWeight: 400 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e, i) => (
                      <tr key={e.id} className={i === 0 ? 'slide-in' : ''} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: 'transparent' }}>
                        <td style={{ padding: '7px 10px', color: '#3a6a8a', fontSize: 9 }}>{new Date(e.timestamp).toLocaleTimeString()}</td>
                        <td style={{ padding: '7px 10px', color: '#60a5fa', fontFamily: 'monospace', fontSize: 10 }}>{e.ip}</td>
                        <td style={{ padding: '7px 10px', color: '#94a3b8', fontSize: 10 }}>{e.method}</td>
                        <td style={{ padding: '7px 10px', color: '#94a3b8', fontFamily: 'monospace', fontSize: 9, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.path}</td>
                        <td style={{ padding: '7px 10px', color: e.requestsPerMin > 100 ? '#f87171' : '#64748b', fontSize: 10 }}>{e.requestsPerMin}</td>
                        <td style={{ padding: '7px 10px', color: '#e2e8f0', fontSize: 10 }}>{e.type}</td>
                        <td style={{ padding: '7px 10px' }}>
                          {e.severity && <span style={{ padding: '2px 7px', borderRadius: 3, fontSize: 8, letterSpacing: 1, background: SEV_STYLE[e.severity]?.bg, border: `1px solid ${SEV_STYLE[e.severity]?.border}`, color: SEV_STYLE[e.severity]?.text }}>{e.severity}</span>}
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{ padding: '2px 7px', borderRadius: 3, fontSize: 8, background: e.blocked ? 'rgba(74,222,128,0.1)' : 'rgba(239,68,68,0.1)', border: `1px solid ${e.blocked ? 'rgba(74,222,128,0.3)' : 'rgba(239,68,68,0.3)'}`, color: e.blocked ? '#4ade80' : '#f87171' }}>
                            {e.blocked ? 'BLOCKED' : '⚠ BREACH'}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          <button onClick={() => analyzeEvent(e.id)} style={{ padding: '2px 7px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa', borderRadius: 3, fontSize: 8, letterSpacing: 1 }}>🤖 AI</button>
                        </td>
                      </tr>
                    ))}
                    {events.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: 'center', padding: 60, color: '#1a3a5c', fontSize: 11 }}>Monitoring nginx logs... No threats detected yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Rules Tab ── */}
            {tab === 'rules' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                {rules.length === 0 && <div style={{ textAlign: 'center', padding: 60, color: '#1a3a5c' }}>No rules generated yet.</div>}
                {rules.map(r => (
                  <div key={r.id} className="slide-in" style={{ marginBottom: 10, padding: '12px 14px', background: r.auto ? 'rgba(96,165,250,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${r.auto ? 'rgba(96,165,250,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 5, borderLeft: `3px solid ${r.auto ? '#60a5fa' : '#3a6a8a'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {r.auto && <span style={{ fontSize: 7, padding: '1px 6px', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 2, letterSpacing: 1 }}>🤖 AI</span>}
                        <span style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>{r.ruleName}</span>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {r.targets?.map(t => <span key={t} style={{ fontSize: 7, padding: '1px 5px', background: 'rgba(0,200,255,0.1)', color: '#00c8ff', borderRadius: 2 }}>{t.toUpperCase()}</span>)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {r.applied?.length > 0 && <span style={{ fontSize: 8, color: '#4ade80' }}>✓ {r.applied.join(', ')}</span>}
                        {r.cfAction && <span style={{ fontSize: 8, padding: '2px 8px', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: ACTION_COLOR[r.cfAction] || '#f87171', borderRadius: 3 }}>{r.cfAction.toUpperCase()}</span>}
                        <button onClick={() => deleteRule(r.id)} style={{ padding: '2px 6px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 3, fontSize: 9 }}>✕</button>
                      </div>
                    </div>
                    {r.cfExpression && (
                      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#60a5fa', background: 'rgba(0,0,0,0.3)', padding: '6px 8px', borderRadius: 3, marginBottom: 6, wordBreak: 'break-all' }}>
                        <span style={{ color: '#3a6a8a', fontSize: 8 }}>CF: </span>{r.cfExpression}
                      </div>
                    )}
                    {r.iptablesRules?.map((cmd, i) => (
                      <div key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: '#fb923c', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: 3, marginBottom: 2, wordBreak: 'break-all' }}>
                        <span style={{ color: '#3a6a8a', fontSize: 7 }}>IP: </span>{cmd}
                      </div>
                    ))}
                    {r.reasoning && <div style={{ fontSize: 9, color: '#64748b', marginTop: 4 }}>{r.reasoning}</div>}
                    {r.confidence && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        <div style={{ flex: 1, height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                          <div style={{ width: `${r.confidence}%`, height: '100%', background: r.confidence > 80 ? '#4ade80' : r.confidence > 60 ? '#facc15' : '#f87171', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 8, color: '#3a6a8a' }}>{r.confidence}% confidence</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Cloudflare Tab ── */}
            {tab === 'cloudflare' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                <div style={{ fontSize: 10, color: '#3a6a8a', marginBottom: 14, letterSpacing: 1 }}>WAF RULES ({cfRules.wafRules?.length || 0}) · RATE LIMITS ({cfRules.rateLimitRules?.length || 0})</div>
                {[...cfRules.wafRules, ...cfRules.rateLimitRules].map(r => (
                  <div key={r.id} style={{ marginBottom: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(0,200,255,0.1)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: '#e2e8f0' }}>{r.description || r.id}</span>
                      <span style={{ fontSize: 8, color: r.enabled ? '#4ade80' : '#f87171' }}>{r.enabled ? '● ACTIVE' : '○ DISABLED'}</span>
                    </div>
                    {r.expression && <div style={{ fontFamily: 'monospace', fontSize: 9, color: '#60a5fa', background: 'rgba(0,0,0,0.3)', padding: '5px 8px', borderRadius: 3, wordBreak: 'break-all' }}>{r.expression}</div>}
                    {r.action && <div style={{ fontSize: 8, color: ACTION_COLOR[r.action] || '#94a3b8', marginTop: 4 }}>ACTION: {r.action.toUpperCase()}</div>}
                  </div>
                ))}
                {cfRules.wafRules?.length === 0 && cfRules.rateLimitRules?.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#1a3a5c', fontSize: 11 }}>
                    No Cloudflare rules found. Check CF_API_TOKEN and CF_ZONE_ID in .env
                  </div>
                )}
              </div>
            )}

            {/* ── Firewall/iptables Tab ── */}
            {tab === 'firewall' && (
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                <div style={{ fontSize: 10, color: '#3a6a8a', marginBottom: 14, letterSpacing: 1 }}>
                  MANAGED RULES ({fwRules.managed?.length || 0}) · SYSTEM RULES
                </div>
                {fwRules.managed?.map(r => (
                  <div key={r.id} style={{ marginBottom: 8, padding: '10px 12px', background: 'rgba(251,146,60,0.04)', border: '1px solid rgba(251,146,60,0.15)', borderRadius: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#fb923c' }}>{r.ip}</span>
                      <span style={{ fontSize: 8, color: '#3a6a8a' }}>{new Date(r.appliedAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 8, color: '#64748b' }}>Backend: {r.backend}</div>
                    {r.expiresAt && <div style={{ fontSize: 8, color: '#facc15' }}>Expires: {new Date(r.expiresAt).toLocaleString()}</div>}
                    {r.commands?.map((cmd, i) => (
                      <div key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: '#94a3b8', background: 'rgba(0,0,0,0.2)', padding: '3px 6px', borderRadius: 2, marginTop: 3, wordBreak: 'break-all' }}>{cmd}</div>
                    ))}
                  </div>
                ))}
                {fwRules.systemRules?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: '#3a6a8a', letterSpacing: 1, marginBottom: 8, marginTop: 16 }}>RAW SYSTEM RULES</div>
                    <pre style={{ fontFamily: 'monospace', fontSize: 9, color: '#60a5fa', background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 300 }}>
                      {fwRules.systemRules.map(r => r.raw).join('\n')}
                    </pre>
                  </div>
                )}
                {fwRules.managed?.length === 0 && fwRules.systemRules?.length === 0 && (
                  <div style={{ textAlign: 'center', padding: 40, color: '#1a3a5c', fontSize: 11 }}>No iptables/nftables rules active yet.</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid rgba(0,200,255,0.08)', padding: '5px 20px', display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#1a3a5c', letterSpacing: 1, background: 'rgba(4,10,20,0.8)' }}>
          <span>SENTINEL WAF v1.0 · NGINX + CLOUDFLARE + IPTABLES/NFTABLES · AI: CLAUDE SONNET</span>
          <span className="blink">■</span>
          <span>{new Date().toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

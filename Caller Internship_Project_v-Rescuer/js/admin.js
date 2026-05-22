/**
 * V-Rescuer Admin Dashboard v3
 * ─────────────────────────────
 * Receives live data from the call page via BroadcastChannel.
 *
 * FIXES in v3:
 *  1. Heartbeat detection properly wraps onmessage (was using origOnMsg incorrectly)
 *  2. Sidebar phase/mode values now update from both message types
 *  3. Simulation buttons now confirmed to post on correct channel name from config
 *  4. Quality score message type 'quality' now handled
 *
 * NEW in v3:
 *  - Quality score card with color-coded ring
 *  - Jitter sparkline chart (4th chart)
 *  - Session log export (JSON + CSV)
 *  - ICE candidate type display (host / srflx / relay)
 *  - Session duration tracker
 */

const HISTORY_LEN = VRescuerConfig?.ADMIN_HISTORY_LEN ?? 60;

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  phase:        'idle',
  networkState: 'good',
  connected:    false,
  dcOpen:       false,
  aiState:      'idle',
  bitrate:      new Array(HISTORY_LEN).fill(0),
  pktLoss:      new Array(HISTORY_LEN).fill(0),
  rtt:          new Array(HISTORY_LEN).fill(0),
  jitter:       new Array(HISTORY_LEN).fill(0),
  quality:      new Array(HISTORY_LEN).fill(0),
  lastStats:    null,
  logEntries:   [],
  stateHistory: [],
  qualityScore: 0,
  iceType:      'unknown',
  sessionStart: null,
  sessionMs:    0,
};

// ── BroadcastChannel ──────────────────────────────────────────────────────────
// FIX: Use channel name from config, not hardcoded string
const ADMIN_CHANNEL = (window.VRescuerConfig ?? {}).ADMIN_CHANNEL_NAME ?? 'v-rescuer-admin';
const ch = new BroadcastChannel(ADMIN_CHANNEL);

let lastDataMs = Date.now();

ch.addEventListener('message', ({ data: msg }) => {
  lastDataMs = Date.now();  // FIX: use addEventListener, not onmessage overwrite

  switch (msg.type) {
    case 'stats':
      state.lastStats = msg.data;
      push(state.bitrate, msg.data.bitrateBps / 1000);
      push(state.pktLoss, msg.data.packetLossRatio * 100);
      push(state.rtt,     msg.data.roundTripTime);
      push(state.jitter,  (msg.data.jitter || 0) * 1000);
      if (msg.data.iceType && msg.data.iceType !== 'unknown') {
        state.iceType = msg.data.iceType;
        setText('ice-type-val', msg.data.iceType);
      }
      renderStats(msg.data);
      renderCharts();
      break;

    case 'quality':
      state.qualityScore = msg.data.score;
      push(state.quality, msg.data.score);
      renderQuality(msg.data.score);
      break;

    case 'state-change':
      state.networkState = msg.data.to;
      state.stateHistory.push(msg.data);
      renderNetworkState(msg.data.to);
      renderStateMachine(msg.data.to);
      setText('mode-val', msg.data.to);
      addLog({ message: `[Net] ${msg.data.from} → ${msg.data.to}`, ts: msg.data.ts,
               level: msg.data.to === 'critical' ? 'error' : msg.data.to === 'degraded' ? 'warn' : 'ok' });
      break;

    case 'log':
      addLog({ message: msg.data.message, ts: msg.data.ts, level: classifyLog(msg.data.message) });
      break;

    case 'phase':
      state.phase = msg.data.phase;
      renderPhase(msg.data.phase);
      setText('phase-val', msg.data.phase);
      addLog({ message: `[Phase] → ${msg.data.phase}`, ts: msg.data.ts, level: 'info' });
      if (msg.data.phase === 'connected' && !state.sessionStart) {
        state.sessionStart = Date.now();
      } else if (msg.data.phase === 'idle') {
        if (state.sessionStart) state.sessionMs += Date.now() - state.sessionStart;
        state.sessionStart = null;
      }
      break;

    case 'ai-status':
      renderAIStatus(msg.data);
      break;

    case 'dc-stats':
      state.dcOpen = msg.data.open;
      renderDCStatus(msg.data);
      if (msg.data.open) setText('dc-status', 'Open ✓');
      break;
  }
});

function push(arr, val) {
  arr.push(val);
  if (arr.length > HISTORY_LEN) arr.shift();
}

// ── Stat Cards ────────────────────────────────────────────────────────────────
function renderStats(s) {
  const cfg = window.VRescuerConfig ?? {};
  const bps = s.bitrateBps ?? 0;

  setText('val-bitrate',  `${(bps/1000).toFixed(1)} kbps`);
  setText('val-pktloss',  `${((s.packetLossRatio??0)*100).toFixed(2)}%`);
  setText('val-rtt',      `${Math.round(s.roundTripTime??0)} ms`);
  setText('val-jitter',   `${(((s.jitter??0)*1000)).toFixed(1)} ms`);
  setText('val-bytes',    formatBytes(s.bytesSent ?? 0));
  setText('val-pktsent',  (s.packetsSent ?? 0).toLocaleString());

  const bEl = document.getElementById('val-bitrate');
  if (bEl) {
    bEl.dataset.level =
      bps === 0                                             ? '' :
      bps < (cfg.BITRATE_THRESHOLD_FULL_FALLBACK ?? 15000) ? 'critical' :
      bps < (cfg.BITRATE_THRESHOLD_AUDIO_ONLY    ?? 100000)? 'warn' : 'ok';
  }

  const bar = document.getElementById('bitrate-bar');
  if (bar) {
    const pct = Math.min(100, (bps / 2_000_000) * 100);
    bar.style.width      = `${pct}%`;
    bar.style.background =
      bps < (cfg.BITRATE_THRESHOLD_FULL_FALLBACK ?? 15000) ? '#e53935' :
      bps < (cfg.BITRATE_THRESHOLD_AUDIO_ONLY    ?? 100000)? '#f9a825' : '#43a047';
  }
}

// ── Quality Score ─────────────────────────────────────────────────────────────
function renderQuality(score) {
  const el  = document.getElementById('quality-ring');
  const txt = document.getElementById('quality-val');
  if (!txt) return;
  txt.textContent = score;
  const color =
    score >= 80 ? '#43a047' :
    score >= 50 ? '#f9a825' : '#e53935';
  if (el) {
    const circ = el.querySelector('.qr-progress');
    if (circ) {
      const r   = 22;
      const c   = 2 * Math.PI * r;
      const off = c - (score / 100) * c;
      circ.style.strokeDasharray  = `${c}`;
      circ.style.strokeDashoffset = `${off}`;
      circ.style.stroke           = color;
    }
  }
  if (txt) txt.style.color = color;
}

// ── Charts ────────────────────────────────────────────────────────────────────
function drawSparkline(canvasId, data, color, fillColor, unit = '') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W   = canvas.width  = canvas.offsetWidth  * devicePixelRatio;
  const H   = canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  if (data.every(v => v === 0)) return;
  const max  = Math.max(...data, 1);
  const pts  = data.length;
  const xStep = W / (pts - 1);
  const toY   = v => H - (v / max) * H * 0.85 - H * 0.075;

  ctx.beginPath();
  ctx.moveTo(0, H);
  data.forEach((v, i) => ctx.lineTo(i * xStep, toY(v)));
  ctx.lineTo((pts - 1) * xStep, H);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(0, toY(v)) : ctx.lineTo(i * xStep, toY(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5 * devicePixelRatio;
  ctx.lineJoin    = 'round';
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font      = `bold ${11 * devicePixelRatio}px 'IBM Plex Mono', monospace`;
  ctx.fillText(`${data[data.length - 1].toFixed(1)}${unit}`, 4 * devicePixelRatio, 14 * devicePixelRatio);
}

function renderCharts() {
  drawSparkline('chart-bitrate', state.bitrate, '#43a047', 'rgba(67,160,71,0.12)',   ' k');
  drawSparkline('chart-pktloss', state.pktLoss,  '#e53935', 'rgba(229,57,53,0.12)',   '%');
  drawSparkline('chart-rtt',     state.rtt,      '#1976d2', 'rgba(25,118,210,0.12)',  ' ms');
  drawSparkline('chart-jitter',  state.jitter,   '#9c27b0', 'rgba(156,39,176,0.12)', ' ms');
}

// ── State Machine ─────────────────────────────────────────────────────────────
function renderStateMachine(current) {
  ['good','degraded','low','critical'].forEach(s => {
    document.getElementById(`sm-${s}`)?.classList.toggle('active', s === current);
  });
}

// ── Network Badge ─────────────────────────────────────────────────────────────
function renderNetworkState(mode) {
  const el = document.getElementById('network-state-badge');
  if (!el) return;
  el.setAttribute('data-mode', mode);
  el.textContent = { good: '● Healthy', degraded: '⚠ Reduced Video', low: '⚠ Low Video', critical: '🚨 Critical' }[mode] ?? mode;
}

// ── Phase ─────────────────────────────────────────────────────────────────────
function renderPhase(phase) {
  const el = document.getElementById('call-phase');
  if (el) { el.textContent = phase; el.dataset.phase = phase; }
  state.connected = (phase === 'connected');
  document.getElementById('connection-indicator')?.setAttribute('data-connected', state.connected);
}

// ── AI Status ─────────────────────────────────────────────────────────────────
function renderAIStatus({ state: s, progress, message }) {
  setText('ai-model-state', s);
  setText('ai-model-msg',   message);
  const bar  = document.getElementById('ai-progress-bar');
  if (bar)  bar.style.width = `${progress ?? 0}%`;
  const wrap = document.getElementById('ai-progress-wrap');
  if (wrap) wrap.style.display = (s === 'loading') ? 'block' : 'none';
}

// ── DataChannel ───────────────────────────────────────────────────────────────
function renderDCStatus({ open }) {
  const el = document.getElementById('dc-status');
  if (el) { el.textContent = open ? 'Open ✓' : 'Closed'; el.dataset.open = open; }
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog({ message, ts, level = 'info' }) {
  state.logEntries.push({ message, ts, level });
  if (state.logEntries.length > 500) state.logEntries.shift();
  const panel       = document.getElementById('log-panel');
  if (!panel) return;
  const activeFilter = document.querySelector('.log-filter-btn.active')?.dataset.level ?? 'all';
  if (activeFilter !== 'all' && level !== activeFilter) return;
  appendLogEntry(panel, { message, ts, level });
}

function appendLogEntry(panel, { message, ts, level }) {
  const row  = document.createElement('div');
  row.className = `log-row log-${level}`;
  const time = new Date(ts).toLocaleTimeString('en', { hour12: false });
  row.innerHTML  = `<span class="log-ts">${time}</span><span class="log-msg">${escapeHtml(message)}</span>`;
  panel.appendChild(row);
  panel.scrollTop = panel.scrollHeight;
}

function rebuildLog() {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const f = document.querySelector('.log-filter-btn.active')?.dataset.level ?? 'all';
  panel.innerHTML = '';
  state.logEntries
    .filter(e => f === 'all' || e.level === f)
    .forEach(e => appendLogEntry(panel, e));
}

// ── Session Export ────────────────────────────────────────────────────────────
function exportLog(format) {
  if (!state.logEntries.length) return;
  let content, mime, ext;
  if (format === 'json') {
    content = JSON.stringify({ session: state.logEntries, stats: state.lastStats }, null, 2);
    mime = 'application/json'; ext = 'json';
  } else {
    const header = 'timestamp,level,message\n';
    const rows   = state.logEntries.map(e =>
      `"${new Date(e.ts).toISOString()}","${e.level}","${e.message.replace(/"/g,'""')}"`
    ).join('\n');
    content = header + rows;
    mime = 'text/csv'; ext = 'csv';
  }
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `v-rescuer-session-${Date.now()}.${ext}`,
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Simulation ────────────────────────────────────────────────────────────────
// FIX: Use channel name from config (was hardcoded previously)
const SIM_CHANNEL = (window.VRescuerConfig ?? {}).ADMIN_SIM_CHANNEL_NAME ?? 'v-rescuer-admin-sim';
const simCh = new BroadcastChannel(SIM_CHANNEL);
function simulate(mode) {
  simCh.postMessage({ type: 'simulate', mode });
  addLog({ message: `[Admin] Simulation → ${mode}`, ts: Date.now(), level: 'info' });
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function formatBytes(b) {
  if (b > 1e9) return (b/1e9).toFixed(2)+' GB';
  if (b > 1e6) return (b/1e6).toFixed(2)+' MB';
  if (b > 1e3) return (b/1e3).toFixed(1)+' KB';
  return b+' B';
}
function classifyLog(msg) {
  if (/critical|error|✗|🚨/i.test(msg))      return 'error';
  if (/warn|⚠|degraded/i.test(msg))           return 'warn';
  if (/✓|healthy|recover|connected/i.test(msg)) return 'ok';
  return 'info';
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderNetworkState('good');
  renderStateMachine('good');
  renderPhase('idle');
  renderQuality(0);

  // Log filters
  document.querySelectorAll('.log-filter-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildLog();
    })
  );

  document.getElementById('btn-clear-log')?.addEventListener('click', () => {
    state.logEntries = [];
    document.getElementById('log-panel').innerHTML = '';
  });

  // Export buttons
  document.getElementById('btn-export-json')?.addEventListener('click', () => exportLog('json'));
  document.getElementById('btn-export-csv')?.addEventListener('click',  () => exportLog('csv'));

  // Simulation buttons
  document.getElementById('admin-sim-good')?.addEventListener('click',     () => simulate('good'));
  document.getElementById('admin-sim-degraded')?.addEventListener('click', () => simulate('degraded'));
  document.getElementById('admin-sim-low')?.addEventListener('click',      () => simulate('low'));
  document.getElementById('admin-sim-critical')?.addEventListener('click', () => simulate('critical'));

  // Chart resize observer
  const ro = new ResizeObserver(() => renderCharts());
  ['chart-bitrate','chart-pktloss','chart-rtt','chart-jitter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  });

  // Heartbeat: show banner if no data for 8 seconds
  // FIX: Use setInterval check rather than wrapping onmessage
  setInterval(() => {
    const stale = (Date.now() - lastDataMs) > (VRescuerConfig?.ADMIN_HEARTBEAT_STALE_MS ?? 8000);
    document.getElementById('no-data-banner')?.toggleAttribute('hidden', !stale);
  }, 2000);

  // Session timer display
  setInterval(() => {
    let ms = state.sessionMs;
    if (state.sessionStart) ms += Date.now() - state.sessionStart;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const dur = h > 0
      ? `${h}h ${String(m%60).padStart(2,'0')}m ${String(s%60).padStart(2,'0')}s`
      : `${String(m).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
    setText('session-duration', dur);
  }, 1000);

  addLog({ message: 'Admin dashboard ready. Open call page in another tab.', ts: Date.now(), level: 'info' });
});

/**
 * V-Rescuer Admin Dashboard
 * ──────────────────────────
 * Receives live data from the call page via BroadcastChannel
 * and renders real-time charts, state machine, and full log.
 */

const ADMIN_CHANNEL = 'v-rescuer-admin';
const HISTORY_LEN   = 60; // 60 data points per sparkline

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  phase:       'idle',
  networkState:'good',
  connected:   false,
  dcOpen:      false,
  aiState:     'idle',
  bitrate:  new Array(HISTORY_LEN).fill(0),
  pktLoss:  new Array(HISTORY_LEN).fill(0),
  rtt:      new Array(HISTORY_LEN).fill(0),
  lastStats: null,
  logEntries: [],
  stateHistory: [],
  dcMsgCount: 0,
  simState: null,
};

// ── BroadcastChannel Listener ─────────────────────────────────────────────────
const ch = new BroadcastChannel(ADMIN_CHANNEL);
ch.onmessage = ({ data: msg }) => {
  switch (msg.type) {
    case 'stats':
      state.lastStats = msg.data;
      state.bitrate.push(msg.data.bitrateBps / 1000);
      state.pktLoss.push(msg.data.packetLossRatio * 100);
      state.rtt.push(msg.data.roundTripTime);
      if (state.bitrate.length > HISTORY_LEN) state.bitrate.shift();
      if (state.pktLoss.length > HISTORY_LEN) state.pktLoss.shift();
      if (state.rtt.length > HISTORY_LEN)     state.rtt.shift();
      renderStats(msg.data);
      renderCharts();
      break;
    case 'state-change':
      state.networkState = msg.data.to;
      state.stateHistory.push(msg.data);
      renderNetworkState(msg.data.to);
      renderStateMachine(msg.data.to);
      addLog({ message: `[Net] ${msg.data.from} → ${msg.data.to}`, ts: msg.data.ts, level: msg.data.to === 'critical' ? 'error' : msg.data.to === 'degraded' ? 'warn' : 'ok' });
      break;
    case 'log':
      addLog({ message: msg.data.message, ts: msg.data.ts, level: classifyLog(msg.data.message) });
      break;
    case 'phase':
      state.phase = msg.data.phase;
      renderPhase(msg.data.phase);
      addLog({ message: `[Phase] → ${msg.data.phase}`, ts: msg.data.ts, level: 'info' });
      break;
    case 'ai-status':
      renderAIStatus(msg.data);
      break;
    case 'dc-stats':
      state.dcOpen = msg.data.open;
      renderDCStatus(msg.data);
      if (msg.data.open) state.dcMsgCount = 0;
      break;
  }
};

// ── Render: Stats Cards ───────────────────────────────────────────────────────
function renderStats(s) {
  const { bitrateBps: bps, packetLossRatio: plr, roundTripTime: rtt } = s;
  const cfg = window.VRescuerConfig ?? {};

  setText('val-bitrate',   `${(bps/1000).toFixed(1)} kbps`);
  setText('val-pktloss',   `${(plr*100).toFixed(2)}%`);
  setText('val-rtt',       `${Math.round(rtt)} ms`);
  setText('val-jitter',    `${((s.jitter||0)*1000).toFixed(1)} ms`);
  setText('val-bytes',     formatBytes(s.bytesSent || 0));
  setText('val-pktsent',   (s.packetsSent || 0).toLocaleString());

  // Color coding
  const bEl = document.getElementById('val-bitrate');
  if (bEl) {
    bEl.dataset.level =
      bps === 0                                         ? '' :
      bps < (cfg.BITRATE_THRESHOLD_FULL_FALLBACK||15000) ? 'critical' :
      bps < (cfg.BITRATE_THRESHOLD_AUDIO_ONLY||100000)   ? 'warn' : 'ok';
  }

  // Bitrate bar
  const bar = document.getElementById('bitrate-bar');
  if (bar) {
    const pct = Math.min(100, (bps / 2_000_000) * 100);
    bar.style.width = `${pct}%`;
    bar.style.background =
      bps < (cfg.BITRATE_THRESHOLD_FULL_FALLBACK||15000) ? '#e53935' :
      bps < (cfg.BITRATE_THRESHOLD_AUDIO_ONLY||100000)   ? '#f9a825' : '#43a047';
  }
}

// ── Render: Charts (Canvas sparklines) ───────────────────────────────────────
function drawSparkline(canvasId, data, color, fillColor, unit='') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth * devicePixelRatio;
  const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);

  if (data.every(v => v === 0)) return;
  const max = Math.max(...data, 1);
  const min = 0;
  const pts = data.length;
  const stepX = W / (pts - 1);

  const toY = v => H - ((v - min) / (max - min)) * H * 0.85 - H * 0.075;

  // Fill
  ctx.beginPath();
  ctx.moveTo(0, H);
  data.forEach((v, i) => ctx.lineTo(i * stepX, toY(v)));
  ctx.lineTo((pts - 1) * stepX, H);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();

  // Line
  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(0, toY(v)) : ctx.lineTo(i * stepX, toY(v)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * devicePixelRatio;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Current value label
  const last = data[data.length - 1];
  ctx.fillStyle = color;
  ctx.font = `bold ${11 * devicePixelRatio}px Inter, sans-serif`;
  ctx.fillText(`${last.toFixed(1)}${unit}`, 4 * devicePixelRatio, 14 * devicePixelRatio);
}

function renderCharts() {
  drawSparkline('chart-bitrate', state.bitrate, '#43a047', 'rgba(67,160,71,0.12)', ' kbps');
  drawSparkline('chart-pktloss', state.pktLoss,  '#e53935', 'rgba(229,57,53,0.12)', '%');
  drawSparkline('chart-rtt',     state.rtt,      '#1976d2', 'rgba(25,118,210,0.12)', ' ms');
}

// ── Render: State Machine ─────────────────────────────────────────────────────
function renderStateMachine(current) {
  ['good','degraded','critical'].forEach(s => {
    const el = document.getElementById(`sm-${s}`);
    if (el) el.classList.toggle('active', s === current);
  });
}

// ── Render: Network State Badge ───────────────────────────────────────────────
function renderNetworkState(mode) {
  const el = document.getElementById('network-state-badge');
  if (!el) return;
  el.setAttribute('data-mode', mode);
  el.textContent = { good:'● Healthy', degraded:'⚠ Audio Only', critical:'🚨 Critical' }[mode] ?? mode;
}

// ── Render: Phase ─────────────────────────────────────────────────────────────
function renderPhase(phase) {
  const el = document.getElementById('call-phase');
  if (el) { el.textContent = phase; el.dataset.phase = phase; }
  state.connected = (phase === 'connected');
  document.getElementById('connection-indicator')?.setAttribute('data-connected', state.connected);
}

// ── Render: AI Status ─────────────────────────────────────────────────────────
function renderAIStatus(detail) {
  const { state: s, progress, message } = detail;
  setText('ai-model-state',    s);
  setText('ai-model-msg',      message);
  const bar = document.getElementById('ai-progress-bar');
  if (bar) bar.style.width = `${progress ?? 0}%`;
  const wrap = document.getElementById('ai-progress-wrap');
  if (wrap) wrap.style.display = (s === 'loading') ? 'block' : 'none';
}

// ── Render: DataChannel ───────────────────────────────────────────────────────
function renderDCStatus({ open }) {
  const el = document.getElementById('dc-status');
  if (el) { el.textContent = open ? 'Open ✓' : 'Closed'; el.dataset.open = open; }
}

// ── Log ───────────────────────────────────────────────────────────────────────
function addLog({ message, ts, level = 'info' }) {
  state.logEntries.push({ message, ts, level });
  if (state.logEntries.length > 500) state.logEntries.shift();

  const panel = document.getElementById('log-panel');
  if (!panel) return;

  const activeFilter = document.querySelector('.log-filter-btn.active')?.dataset.level ?? 'all';
  if (activeFilter !== 'all' && level !== activeFilter) return;

  appendLogEntry(panel, { message, ts, level });
}

function appendLogEntry(panel, { message, ts, level }) {
  const row = document.createElement('div');
  row.className = `log-row log-${level}`;
  const time = new Date(ts).toLocaleTimeString('en', { hour12: false });
  row.innerHTML = `<span class="log-ts">${time}</span><span class="log-msg">${escapeHtml(message)}</span>`;
  panel.appendChild(row);
  panel.scrollTop = panel.scrollHeight;
}

function rebuildLog() {
  const panel = document.getElementById('log-panel');
  if (!panel) return;
  const activeFilter = document.querySelector('.log-filter-btn.active')?.dataset.level ?? 'all';
  panel.innerHTML = '';
  state.logEntries
    .filter(e => activeFilter === 'all' || e.level === activeFilter)
    .forEach(e => appendLogEntry(panel, e));
}

// ── Simulation controls ───────────────────────────────────────────────────────
// Admin can also trigger state changes by posting to the call page's
// dedicated simulation channel
const simCh = new BroadcastChannel('v-rescuer-admin-sim');
function simulate(mode) {
  simCh.postMessage({ type: 'simulate', mode });
  addLog({ message: `[Admin] Triggered simulation: ${mode}`, ts: Date.now(), level: 'info' });
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
  if (/critical|error|✗|🚨/i.test(msg)) return 'error';
  if (/warn|⚠|degraded/i.test(msg))    return 'warn';
  if (/✓|healthy|recover|connected/i.test(msg)) return 'ok';
  return 'info';
}
function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Initial renders
  renderNetworkState('good');
  renderStateMachine('good');
  renderPhase('idle');

  // Log filter buttons
  document.querySelectorAll('.log-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      rebuildLog();
    });
  });

  // Clear log
  document.getElementById('btn-clear-log')?.addEventListener('click', () => {
    state.logEntries = [];
    const panel = document.getElementById('log-panel');
    if (panel) panel.innerHTML = '';
  });

  // Simulation buttons
  document.getElementById('admin-sim-good')?.addEventListener('click',     () => simulate('good'));
  document.getElementById('admin-sim-degraded')?.addEventListener('click', () => simulate('degraded'));
  document.getElementById('admin-sim-critical')?.addEventListener('click', () => simulate('critical'));

  // Resize observer for chart redraws
  const ro = new ResizeObserver(() => renderCharts());
  ['chart-bitrate','chart-pktloss','chart-rtt'].forEach(id => {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  });

  // Heartbeat — show "No call page open" if no data in 8s
  let lastDataMs = Date.now();
  const origOnMsg = ch.onmessage;
  ch.onmessage = (e) => { lastDataMs = Date.now(); origOnMsg(e); };
  setInterval(() => {
    const stale = (Date.now() - lastDataMs) > 8000;
    document.getElementById('no-data-banner')?.toggleAttribute('hidden', !stale);
  }, 2000);

  addLog({ message: 'Admin dashboard ready. Open call page in another tab.', ts: Date.now(), level: 'info' });
});

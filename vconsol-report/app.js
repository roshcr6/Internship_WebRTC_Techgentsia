/* ─────────────────────────────────────────────────────
   vConsol Deep Research Report — app.js
   ───────────────────────────────────────────────────── */

/* ── 1. NAVBAR SCROLL ─────────────────────────────── */
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
  navbar.classList.toggle('scrolled', window.scrollY > 30);
}, { passive: true });

/* ── 2. FADE-IN OBSERVER ──────────────────────────── */
const fadeObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
}, { threshold: 0.12 });

document.querySelectorAll('.stat-card, .info-card, .feature-group, .product-card, .timeline-item, .gap-card, .codec-card, .proto-item, .ai-phase, .rm-phase, .gtm-card, .toc-card, .glossary-item')
  .forEach(el => { el.classList.add('fade-in'); fadeObserver.observe(el); });

/* ── 3. COUNTER ANIMATION ─────────────────────────── */
function animateCounter(el, target, duration = 1800) {
  const isLarge = target >= 100;
  const step = Math.max(1, Math.ceil(target / (duration / 16)));
  let current = 0;
  const tick = () => {
    current = Math.min(current + step, target);
    el.textContent = current.toLocaleString();
    if (current < target) requestAnimationFrame(tick);
  };
  tick();
}

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      const target = parseInt(e.target.dataset.target, 10);
      animateCounter(e.target, target);
      counterObserver.unobserve(e.target);
    }
  });
}, { threshold: 0.5 });
document.querySelectorAll('.stat-num[data-target]').forEach(el => counterObserver.observe(el));

/* ── 4. PROTOCOL TABS ─────────────────────────────── */
document.querySelectorAll('.proto-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.proto-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.proto-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ── 5. BENCHMARK DATA ────────────────────────────── */
const benchData = [
  ['Max participants', '100–80', '1,000 (paid)', '1,000 (paid)', '1,000 (enterprise)'],
  ['Free plan', '✓ (govt)', '40-min limit', '60-min limit', '60-min limit'],
  ['Video codec', 'H.264', 'H.264/VP9/AV1', 'VP9/AV1', 'H.264/VP9'],
  ['Architecture', 'MCU + SFU', 'SFU (proprietary)', 'SFU (WebRTC)', 'SFU (proprietary)'],
  ['AI meeting summaries', '✗', '✓ (AI Companion)', '✓ (Gemini)', '✓ (Copilot)'],
  ['AI noise cancellation', '✗', '✓ (professional)', 'Basic', '✓ (good)'],
  ['Real-time translation', 'Indian (Bhashini)', '40+ languages', '65+ languages', '50+ languages'],
  ['Transcription', '✗', '✓ (live)', '✓ (live)', '✓ (live, 30+ langs)'],
  ['Whiteboard', '✓ (basic)', '✓ (Zoom WB)', 'Third-party only', '✓ (built-in)'],
  ['Screen sharing', '✓', '✓', '✓', '✓'],
  ['Breakout rooms', 'Partial', '✓', '✓', '✓'],
  ['H.323/SIP support', '✓ (gateway)', '✓ (add-on)', '✗', '✓ (add-on)'],
  ['End-to-end encryption', 'Partial (MCU)', 'Optional', '✗ (in transit)', '✗ (in transit)'],
  ['On-premises deploy', '✓', '✓ (paid)', '✗', '✓ (govt/enterprise)'],
  ['Data sovereignty', '✓ (India)', 'US servers', 'US servers', 'Regional options'],
  ['Linux client', '✓', '✓', 'Browser only', '✓ (preview)'],
  ['3rd-party integrations', 'Limited', '1,000+ apps', 'Google Workspace', '700+ (M365 deep)'],
  ['AI action items', '✗', '✓', '✓', '✓'],
  ['Virtual backgrounds', '✗', '✓', '✓', '✓'],
  ['Recording', '✓', '✓ (cloud/local)', '✓ (cloud)', '✓ (cloud)'],
  ['Webinar / live stream', '✗', '✓ (Webinars)', '✓ (live stream)', '✓ (Live Events)'],
  ['Price (entry paid)', 'Custom', '$15/user/mo', '$6/user/mo', '$4/user/mo'],
];

function cellClass(val, colIdx) {
  if (colIdx === 1) return 'cell-vconsol'; // vConsol column
  if (val === '✓' || val.startsWith('✓')) return 'bm-yes';
  if (val === '✗') return 'bm-no';
  if (val === 'Partial' || val.startsWith('Partial') || val === 'Basic') return 'bm-partial';
  return '';
}

const tbody = document.getElementById('benchTableBody');
benchData.forEach(row => {
  const tr = document.createElement('tr');
  row.forEach((cell, i) => {
    const td = document.createElement('td');
    td.textContent = cell;
    const cls = cellClass(cell, i);
    if (cls) td.classList.add(cls);
    if (i === 1) td.classList.add('vconsol-col');
    tr.appendChild(td);
  });
  tbody.appendChild(tr);
});

/* ── 6. RADAR CHART (Canvas) ──────────────────────── */
(function drawRadar() {
  const canvas = document.getElementById('radarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 55;

  const axes = [
    'Participants', 'AI Features', 'Codecs', 'Security',
    'Integrations', 'Data Sovereignty', 'Language Support', 'Reliability'
  ];

  // Scores 0-10
  const datasets = [
    { label: 'vConsol', color: '#4f8ef7', bg: 'rgba(79,142,247,0.15)', scores: [2, 2, 3, 9, 1, 10, 9, 8] },
    { label: 'Zoom', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', scores: [10, 9, 9, 6, 10, 2, 6, 9] },
    { label: 'Google Meet', color: '#06d6a0', bg: 'rgba(6,214,160,0.12)', scores: [10, 8, 9, 5, 8, 2, 8, 9] },
    { label: 'MS Teams', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', scores: [10, 9, 7, 5, 9, 4, 7, 9] },
  ];

  const N = axes.length;
  const angle = i => (Math.PI * 2 * i / N) - Math.PI / 2;

  function point(val, idx) {
    const r = (val / 10) * R;
    return { x: cx + r * Math.cos(angle(idx)), y: cy + r * Math.sin(angle(idx)) };
  }

  // Draw grid
  [2, 4, 6, 8, 10].forEach(level => {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = point(level, i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  // Draw spokes
  for (let i = 0; i < N; i++) {
    const p = point(10, i);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1; ctx.stroke();
  }

  // Draw axis labels
  ctx.font = '600 11px Inter, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < N; i++) {
    const a = angle(i);
    const lx = cx + (R + 30) * Math.cos(a);
    const ly = cy + (R + 30) * Math.sin(a);
    ctx.fillStyle = 'rgba(180,200,240,0.7)';
    ctx.fillText(axes[i], lx, ly);
  }

  // Draw datasets (back to front)
  [...datasets].reverse().forEach(ds => {
    ctx.beginPath();
    ds.scores.forEach((s, i) => {
      const p = point(s, i);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = ds.bg; ctx.fill();
    ctx.strokeStyle = ds.color; ctx.lineWidth = 2; ctx.stroke();

    // Dots
    ds.scores.forEach((s, i) => {
      const p = point(s, i);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = ds.color; ctx.fill();
    });
  });

  // Legend
  const legendEl = document.getElementById('chartLegend');
  datasets.forEach(ds => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-dot" style="background:${ds.color}"></div><span>${ds.label}</span>`;
    legendEl.appendChild(item);
  });
})();

/* ── 7. GLOSSARY DATA ─────────────────────────────── */
const glossary = [
  ['AEC', 'Acoustic Echo Cancellation — removes echo in audio feeds'],
  ['AV1', 'Alliance for Open Media Video 1 — open-source next-gen codec, 30-50% better compression than VP9'],
  ['AV2', 'Successor to AV1, in early standardisation by Alliance for Open Media'],
  ['Bhashini', 'Indian government AI initiative for Indian language NLP APIs'],
  ['Cascaded SFU', 'Multiple SFU nodes chained to scale meetings beyond a single server\'s capacity'],
  ['DTLS', 'Datagram Transport Layer Security — encrypts WebRTC signalling'],
  ['E2EE', 'End-to-End Encryption — content decrypted only at endpoints, not servers'],
  ['H.264 (AVC)', 'Current vConsol video codec — mature, widely supported, requires royalties'],
  ['H.265 (HEVC)', '50% bandwidth improvement over H.264; limited WebRTC adoption'],
  ['Lyra v2', 'Google neural audio codec for ultra-low bitrate (3-9 kbps)'],
  ['MCU', 'Multipoint Control Unit — server mixes all streams into one outgoing stream'],
  ['MOQ', 'Media over QUIC — emerging IETF protocol for low-latency media'],
  ['RNNoise', 'Mozilla neural network noise suppression library'],
  ['SFU', 'Selective Forwarding Unit — server routes streams without re-encoding'],
  ['Simulcast', 'Client sends multiple resolution streams; SFU picks per-subscriber'],
  ['SRTP', 'Secure Real-Time Transport Protocol — encrypts WebRTC media streams'],
  ['SVC', 'Scalable Video Coding — single layered stream, drop layers for low bandwidth'],
  ['VP9', 'Google royalty-free codec, used by YouTube/Meet; better than H.264'],
  ['WebCodecs', 'W3C API for low-level audio/video encoding in browsers'],
  ['WebRTC', 'Web Real-Time Communication — open standard for browser-based A/V'],
  ['WebTransport', 'W3C API using QUIC for low-latency browser data transfer'],
];

const gg = document.getElementById('glossaryGrid');
glossary.forEach(([term, def]) => {
  const div = document.createElement('div');
  div.className = 'glossary-item fade-in';
  div.innerHTML = `<div class="glossary-term">${term}</div><div class="glossary-def">${def}</div>`;
  gg.appendChild(div);
  fadeObserver.observe(div);
});

/* ── 8. COPY PROMPT ───────────────────────────────── */
function copyPrompt() {
  const text = document.getElementById('masterPrompt').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copyBtn');
    btn.textContent = '✓ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '📋 Copy Prompt'; btn.classList.remove('copied'); }, 2200);
  });
}

/* ── 9. ACTIVE NAV LINK ───────────────────────────── */
const sections = document.querySelectorAll('section[id], header[id]');
const navLinks = document.querySelectorAll('.nav-link');

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      navLinks.forEach(l => l.classList.remove('active-nav'));
      const active = document.querySelector(`.nav-link[href="#${e.target.id}"]`);
      if (active) active.classList.add('active-nav');
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(s => sectionObserver.observe(s));

/* Add active nav style dynamically */
const style = document.createElement('style');
style.textContent = `.nav-link.active-nav { color: var(--primary) !important; background: var(--primary-glow) !important; }`;
document.head.appendChild(style);

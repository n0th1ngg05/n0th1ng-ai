/* ===================== NAV (identical to forge.js) ===================== */
const navWrap = document.getElementById('navWrap');
window.addEventListener('scroll', () => {
  navWrap.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

const dd = document.getElementById('ddFeatures');
dd.addEventListener('mouseenter', () => dd.classList.add('open'));
dd.addEventListener('mouseleave', () => dd.classList.remove('open'));

const drawer = document.getElementById('drawer');
document.getElementById('burger').addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== AMBIENT BACKGROUND (identical to forge.js) ===================== */
(function liquidField() {
  const canvas = document.getElementById('liquidField');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  resize();
  window.addEventListener('resize', resize);
  const colors = ['rgba(212,175,55,0.55)', 'rgba(245,215,122,0.45)', 'rgba(138,106,31,0.5)', 'rgba(255,255,255,0.06)'];
  const blobs = Array.from({ length: 5 }, (_, i) => ({
    x: Math.random() * canvas.width, y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.15 * dpr, vy: (Math.random() - 0.5) * 0.15 * dpr,
    r: (Math.random() * 220 + 180) * dpr, color: colors[i % colors.length], phase: Math.random() * Math.PI * 2,
  }));
  let t = 0;
  function tick() {
    t += 0.004;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of blobs) {
      b.x += b.vx + Math.sin(t + b.phase) * 0.15 * dpr;
      b.y += b.vy + Math.cos(t + b.phase) * 0.15 * dpr;
      if (b.x < -b.r) b.x = canvas.width + b.r;
      if (b.x > canvas.width + b.r) b.x = -b.r;
      if (b.y < -b.r) b.y = canvas.height + b.r;
      if (b.y > canvas.height + b.r) b.y = -b.r;
      const pulseR = b.r * (1 + Math.sin(t * 1.3 + b.phase) * 0.08);
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, pulseR);
      grad.addColorStop(0, b.color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(b.x, b.y, pulseR, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    requestAnimationFrame(tick);
  }
  tick();
})();
(function particles() {
  const canvas = document.getElementById('particles');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  function resize() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  resize();
  window.addEventListener('resize', resize);
  const N = 55;
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.25 * dpr, vy: (Math.random() - 0.5) * 0.25 * dpr,
    r: (Math.random() * 1.2 + 0.3) * dpr,
  }));
  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245,215,122,0.6)';
      ctx.fill();
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

/* ===================== FORGEX API CLIENT ===================== */
const FORGEX_API = {
  base: '/api/trpc',
  stream: (sessionId) => `/api/forgex/${sessionId}/stream`,

  async query(proc, input) {
    const url = `${this.base}/forgex.${proc}` +
      (input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[FORGEX][API] ${proc} failed: ${res.status}`);
    const data = await res.json();
    return data?.result?.data?.json;
  },

  async mutate(proc, input) {
    const res = await fetch(`${this.base}/forgex.${proc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input ?? {} }),
    });
    if (!res.ok) throw new Error(`[FORGEX][API] ${proc} failed: ${res.status}`);
    const data = await res.json();
    return data?.result?.data?.json;
  },

  list: () => FORGEX_API.query('list'),
  listModels: () => FORGEX_API.query('listModels'),
  create: (goal, modelId) => FORGEX_API.mutate('create', { goal, modelId }),
  sendInput: (sessionId, text) => FORGEX_API.mutate('sendInput', { sessionId, text }),
  stop: (id) => FORGEX_API.mutate('stop', { id }),
};

/* ===================== STATE ===================== */
let activeSessionId = null;
let activeEventSource = null;
let sessions = [];

/* ===================== SESSION LIST ===================== */
async function refreshSessionList() {
  try {
    sessions = await FORGEX_API.list();
  } catch (err) {
    console.error('[FORGEX][UI] Failed to load session list:', err);
    return;
  }
  const listEl = document.getElementById('sessionList');
  const emptyEl = document.getElementById('railEmpty');
  if (!sessions || sessions.length === 0) {
    emptyEl.style.display = 'block';
    listEl.querySelectorAll('.session-item').forEach(el => el.remove());
    return;
  }
  emptyEl.style.display = 'none';
  listEl.querySelectorAll('.session-item').forEach(el => el.remove());
  for (const s of sessions) {
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeSessionId ? ' active' : '');
    item.innerHTML = `
      <div class="si-top">
        <span class="status-dot ${statusDotClass(s.status)}"></span>
        <span class="si-goal">${escapeHtml(s.goal)}</span>
      </div>
      <span class="si-meta">${s.status}</span>
    `;
    item.addEventListener('click', () => selectSession(s.id));
    listEl.appendChild(item);
  }
}

function statusDotClass(status) {
  if (status === 'running') return 'healthy';
  if (status === 'idle') return 'healthy';
  if (status === 'failed') return 'blocked';
  if (status === 'starting') return 'warning';
  return 'inactive'; // exited
}

/* ===================== SESSION SELECTION ===================== */
async function selectSession(sessionId) {
  activeSessionId = sessionId;
  document.getElementById('sessionEmptyState').style.display = 'none';
  document.getElementById('sessionContent').style.display = 'flex';

  await refreshSessionList();
  connectLiveTerminal(sessionId);

  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    document.getElementById('svGoalText').textContent = session.goal;
    document.getElementById('engineModelText').textContent = session.modelId;
    updateEngineStatus(session.status);
    updateFollowupBar(session.status);
  }
}

function updateEngineStatus(status) {
  const dot = document.getElementById('engineStatusDot');
  const text = document.getElementById('engineStatusText');
  dot.className = 'status-dot ' + statusDotClass(status);
  text.textContent = status.toUpperCase();
}

// Headless mode: each turn is its own `claude -p --resume` invocation, not a
// stdin write to a live process. 'running' means a turn is actively being
// processed right now (no live stdin to write into — disable input).
//
// 'idle' AND 'exited' both enable the follow-up bar. This matters: stopping
// a session (see stopBtn below) only kills that turn's OS process — it does
// NOT clear claudeSessionId from the DB, so Claude Code's own conversation
// state is still fully intact and --resume still works on it. sendInput's
// only real guard is whether claudeSessionId exists at all, not the
// session's status — so an 'exited' session with a completed first turn is
// genuinely resumable, this was just never exposed in the UI before. A
// session that failed before ever completing a first turn has no
// claudeSessionId yet, and sendInput will correctly reject that case with a
// clear error rather than the UI silently pretending it's resumable.
function updateFollowupBar(status) {
  const input = document.getElementById('followupInput');
  const btn = document.getElementById('followupSendBtn');
  const usable = status === 'idle' || status === 'exited';
  input.disabled = !usable;
  btn.disabled = !usable;
  input.placeholder = status === 'running'
    ? 'Claude Code is working on this turn…'
    : status === 'exited'
      ? 'Session stopped — send a message to resume it…'
      : 'Send a follow-up to continue the conversation…';
}

document.getElementById('stopBtn').addEventListener('click', async () => {
  if (!activeSessionId) return;
  try {
    await FORGEX_API.stop(activeSessionId);
    await refreshSessionList();
  } catch (err) {
    console.error('[FORGEX][UI] Failed to stop session:', err);
  }
});

/* ===================== LIVE TERMINAL (SSE) ===================== */
function connectLiveTerminal(sessionId) {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  document.getElementById('forgexTerminal').innerHTML = '';

  const es = new EventSource(FORGEX_API.stream(sessionId));
  activeEventSource = es;

  const liveIndicator = document.getElementById('liveIndicator');
  es.onopen = () => { liveIndicator.style.opacity = '1'; };
  es.onerror = () => { liveIndicator.style.opacity = '0.3'; };

  es.addEventListener('output', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    appendTerminalLine(payload.stream, payload.text);
  });

  es.addEventListener('status', (event) => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
      updateEngineStatus(payload.status);
      updateFollowupBar(payload.status);
    }
  });
}

function appendTerminalLine(stream, text) {
  const terminal = document.getElementById('forgexTerminal');
  const line = document.createElement('div');
  line.className = 'log-line';
  const cls = stream === 'stderr' ? 'l-phase evaluate' : stream === 'system' ? 'l-phase think' : '';
  line.innerHTML = stream === 'system'
    ? `<span class="l-phase think">[SYSTEM]</span><span class="l-reasoning">${escapeHtml(text)}</span>`
    : `<span class="l-reasoning" style="white-space:pre-wrap;">${escapeHtml(text)}</span>`;
  terminal.appendChild(line);
  terminal.scrollTop = terminal.scrollHeight;
}

/* ===================== NEW SESSION MODAL ===================== */
const modal = document.getElementById('newSessionModal');
document.getElementById('newSessionBtn').addEventListener('click', async () => {
  modal.classList.add('open');
  const select = document.getElementById('modelSelect');
  try {
    const models = await FORGEX_API.listModels();
    if (!models.length) {
      select.innerHTML = `<option value="" disabled selected>No models pulled — run "ollama pull &lt;model&gt;"</option>`;
      return;
    }
    const openRouterModels = models.filter(m => m.id.startsWith("openrouter:"));
    const ollamaModels = models.filter(m => !m.id.startsWith("openrouter:"));
    
    let html = '';
    if (openRouterModels.length) {
      html += '<optgroup label="Open Router Models">';
      html += openRouterModels.map(m => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
      html += '</optgroup>';
    }
    if (ollamaModels.length) {
      html += '<optgroup label="Ollama Models">';
      html += ollamaModels.map(m => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
      html += '</optgroup>';
    }
    select.innerHTML = html;
  } catch (err) {
    console.error('[FORGEX][UI] Failed to load model list:', err);
    select.innerHTML = `<option value="" disabled selected>Failed to load models</option>`;
  }
});
document.getElementById('closeModalBtn').addEventListener('click', () => modal.classList.remove('open'));
document.getElementById('cancelSessionBtn').addEventListener('click', () => modal.classList.remove('open'));

document.getElementById('createSessionBtn').addEventListener('click', async () => {
  const goal = document.getElementById('goalInput').value.trim();
  const modelId = document.getElementById('modelSelect').value;
  if (!goal || !modelId) return;

  try {
    const session = await FORGEX_API.create(goal, modelId);
    modal.classList.remove('open');
    document.getElementById('goalInput').value = '';
    await refreshSessionList();
    await selectSession(session.id);
  } catch (err) {
    console.error('[FORGEX][UI] Failed to create session:', err);
    alert(err?.message || 'Failed to launch Claude Code — check the console for details.');
  }
});

/* ===================== FOLLOW-UP (stdin to live process) ===================== */
async function sendFollowUp() {
  if (!activeSessionId) return;
  const input = document.getElementById('followupInput');
  const message = input.value.trim();
  if (!message) return;

  try {
    await FORGEX_API.sendInput(activeSessionId, message);
    input.value = '';
  } catch (err) {
    console.error('[FORGEX][UI] Failed to send input:', err);
    alert(err?.message || 'Failed to send — check the console for details.');
  }
}
document.getElementById('followupSendBtn').addEventListener('click', sendFollowUp);
document.getElementById('followupInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendFollowUp();
});

/* ===================== UTIL ===================== */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/* ===================== INIT ===================== */
refreshSessionList();
setInterval(refreshSessionList, 5000);
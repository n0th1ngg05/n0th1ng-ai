/* ===================== NAV (same behavior as monitor/chatspace pages) ===================== */
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

/* ===================== LIQUID METABALL FIELD ===================== */
/* Slow-moving molten gold blobs, rendered via radial gradients on canvas
   and blended into "liquid" shapes using a coarse alpha threshold on an
   offscreen pass. This is the signature ambient visual for Forge — reads
   as "something is working underneath," distinct from the sharper particle
   constellation used on the home page. */
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

  const BLOB_COUNT = 5;
  const colors = [
    'rgba(212,175,55,0.55)',   // gold
    'rgba(245,215,122,0.45)',  // gold-bright
    'rgba(138,106,31,0.5)',    // deep gold
    'rgba(255,255,255,0.06)',  // faint white for depth
  ];

  const blobs = Array.from({ length: BLOB_COUNT }, (_, i) => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.15 * dpr,
    vy: (Math.random() - 0.5) * 0.15 * dpr,
    r: (Math.random() * 220 + 180) * dpr,
    color: colors[i % colors.length],
    phase: Math.random() * Math.PI * 2,
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

/* ===================== GOLD PARTICLE CONSTELLATION ===================== */
/* Same approach as home/script.js's hero particles, reused here at lower
   density/opacity since it now sits above the liquid field rather than
   being the only ambient layer. */
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
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.25 * dpr,
    vy: (Math.random() - 0.5) * 0.25 * dpr,
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
    const max = 130 * dpr;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = parts[i], b = parts[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < max * max) {
          const alpha = 1 - Math.sqrt(d2) / max;
          ctx.strokeStyle = `rgba(212,175,55,${alpha * 0.18})`;
          ctx.lineWidth = 0.5 * dpr;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(tick);
  }
  tick();
})();

// ===================== RAW MODEL ACTIVITY PANEL =====================
// True token-by-token streaming of whatever Ollama is generating, live, no
// demarcation between calls or phases — just the raw stream as it comes.
// <think>...</think> content renders dim/muted; everything else (the actual
// final answer) renders bright white. This is a genuinely different
// mechanism from the old per-iteration summary: tokens arrive continuously
// via the "token" SSE event (modelClient.ts's live emitter), not once a call
// finishes and gets logged as an iteration.

// Per-call streaming state. Tags can arrive split across separate token
// chunks (e.g. one chunk ends in "<th" and the next starts with "ink>"), so
// we buffer a small tail of raw text and only decide think/final placement
// once we've seen enough characters to know for sure — rather than naively
// checking each incoming chunk in isolation, which would miss a split tag.
let rawStreamState = {
  insideThink: false,
  tagBuffer: '', // holds a short trailing fragment that might be part of a split tag
  thinkSpan: null,
  finalSpan: null,
};

const TAG_BUFFER_MAX = 10; // longer than "</think>" (8 chars), safe margin

function resetRawActivityPanel() {
  const body = document.getElementById('rawActivityBody');
  body.innerHTML = '<span class="raw-activity-placeholder">No model activity yet.</span>';
  setRawStatusDot(false, 'Idle');
  rawStreamState = { insideThink: false, tagBuffer: '', thinkSpan: null, finalSpan: null };
}

function setRawStatusDot(active, text) {
  const dot = document.getElementById('rawStatusDot');
  const label = document.getElementById('rawStatusText');
  dot.className = 'raw-status-dot ' + (active ? 'active' : 'idle');
  label.textContent = text;
}

function updateRawActivityStatus(payload) {
  if (payload.active) {
    const elapsed = payload.startedAt
      ? Math.round((Date.now() - new Date(payload.startedAt).getTime()) / 1000)
      : 0;
    setRawStatusDot(true, `Generating (${payload.modelId || 'model'}, ${elapsed}s)`);
  } else {
    setRawStatusDot(false, 'Idle');
  }
}

// Called once per new session/call (backfill: true events, or the first
// token of a fresh call) to start a clean run of spans, so a NEW call's
// tokens don't visually run into the previous call's leftover text.
function startNewRawStreamRun() {
  const body = document.getElementById('rawActivityBody');
  const placeholder = body.querySelector('.raw-activity-placeholder');
  if (placeholder) placeholder.remove();

  const rule = document.createElement('div');
  rule.className = 'raw-activity-rule';
  body.appendChild(rule);

  rawStreamState = { insideThink: false, tagBuffer: '', thinkSpan: null, finalSpan: null };
}

// Feeds raw text into the panel character-stream-style, splitting on
// <think>/</think> as they're encountered and routing text into the dim
// "thinking" span or the bright "final" span accordingly. No labels, no
// phase tags, no timestamps in the visible text — exactly the raw stream,
// just re-colored live as it's understood.
function streamRawText(text) {
  const body = document.getElementById('rawActivityBody');
  let combined = rawStreamState.tagBuffer + text;
  rawStreamState.tagBuffer = '';

  while (combined.length > 0) {
    if (!rawStreamState.insideThink) {
      const openIdx = combined.indexOf('<think>');
      if (openIdx === -1) {
        // No open tag found yet — but the tail COULD be the start of one
        // arriving split across chunks. Hold back a short tail just in case.
        const safeLen = Math.max(0, combined.length - TAG_BUFFER_MAX);
        const emitNow = combined.slice(0, safeLen);
        rawStreamState.tagBuffer = combined.slice(safeLen);
        if (emitNow) appendFinalText(body, emitNow);
        combined = '';
      } else {
        const before = combined.slice(0, openIdx);
        if (before) appendFinalText(body, before);
        rawStreamState.insideThink = true;
        combined = combined.slice(openIdx + '<think>'.length);
      }
    } else {
      const closeIdx = combined.indexOf('</think>');
      if (closeIdx === -1) {
        const safeLen = Math.max(0, combined.length - TAG_BUFFER_MAX);
        const emitNow = combined.slice(0, safeLen);
        rawStreamState.tagBuffer = combined.slice(safeLen);
        if (emitNow) appendThinkText(body, emitNow);
        combined = '';
      } else {
        const before = combined.slice(0, closeIdx);
        if (before) appendThinkText(body, before);
        rawStreamState.insideThink = false;
        combined = combined.slice(closeIdx + '</think>'.length);
      }
    }
  }

  body.scrollTop = body.scrollHeight;
}

function appendThinkText(body, text) {
  if (!rawStreamState.thinkSpan || !body.contains(rawStreamState.thinkSpan)) {
    rawStreamState.thinkSpan = document.createElement('span');
    rawStreamState.thinkSpan.className = 'raw-think-text';
    body.appendChild(rawStreamState.thinkSpan);
    rawStreamState.finalSpan = null; // force a new final span next time we leave thinking
  }
  rawStreamState.thinkSpan.textContent += text;
}

function appendFinalText(body, text) {
  if (!rawStreamState.finalSpan || !body.contains(rawStreamState.finalSpan)) {
    rawStreamState.finalSpan = document.createElement('span');
    rawStreamState.finalSpan.className = 'raw-final-text';
    body.appendChild(rawStreamState.finalSpan);
    rawStreamState.thinkSpan = null; // force a new think span next time we enter thinking
  }
  rawStreamState.finalSpan.textContent += text;
}

/* ===================== FORGE API CLIENT ===================== */
/* Thin wrapper around the tRPC procedures defined in forge/router.ts.
   Uses plain fetch against /api/trpc rather than a generated client, since
   this is a static HTML/JS page with no build step. Matches how the rest
   of this frontend calls the backend (see chatspace/chat.js for the same
   fetch-based pattern against /api/trpc and /api/chat). */
const FORGE_API = {
  base: '/api/trpc',
  stream: (sessionId) => `/api/forge/${sessionId}/stream`,

  async query(proc, input) {
    // superjson expects GET query input wrapped as {"json": {...}}, not the
    // bare object — confirmed against chat.js's loadConversation, which sends
    // JSON.stringify({ json: { id } }) rather than JSON.stringify({ id }).
    const url = `${this.base}/forge.${proc}` +
      (input ? `?input=${encodeURIComponent(JSON.stringify({ json: input }))}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[FORGE][API] ${proc} failed: ${res.status}`);
    const data = await res.json();
    // Response is wrapped the same way one level deeper under .json.
    return data?.result?.data?.json;
  },

  async mutate(proc, input) {
    const res = await fetch(`${this.base}/forge.${proc}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: input ?? {} }),
    });
    if (!res.ok) throw new Error(`[FORGE][API] ${proc} failed: ${res.status}`);
    const data = await res.json();
    return data?.result?.data?.json;
  },

  list: () => FORGE_API.query('list'),
  listModels: () => FORGE_API.query('listModels'),
  getTaskTree: (sessionId) => FORGE_API.query('getTaskTree', { sessionId }),
  getTaskLog: (taskId) => FORGE_API.query('getTaskLog', { taskId }),
  create: (goal, stackProfileId, modelId, customStack) => FORGE_API.mutate('create', { goal, stackProfileId, modelId, customStack }),
  pause: (id) => FORGE_API.mutate('pause', { id }),
  resume: (id) => FORGE_API.mutate('resume', { id }),
  followUp: (sessionId, message) => FORGE_API.mutate('followUp', { sessionId, message }),
};

/* ===================== STATE ===================== */
let activeSessionId = null;
let activeEventSource = null;
let sessions = [];

/* ===================== SESSION LIST ===================== */
async function refreshSessionList() {
  try {
    sessions = await FORGE_API.list();
  } catch (err) {
    console.error('[FORGE][UI] Failed to load session list:', err);
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
  if (status === 'running' || status === 'done') return 'healthy';
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'planning') return 'warning';
  return 'inactive'; // paused
}

/* ===================== SESSION SELECTION ===================== */
async function selectSession(sessionId) {
  activeSessionId = sessionId;

  document.getElementById('sessionEmptyState').style.display = 'none';
  document.getElementById('sessionContent').style.display = 'flex';

  await refreshSessionList(); // re-render to highlight active item
  await loadTaskTree(sessionId);
  connectLiveLog(sessionId);

  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    document.getElementById('svGoalText').textContent = session.goal;
    document.getElementById('svStackPill').textContent = session.stackProfileId;
    document.getElementById('engineModelText').textContent = session.modelId;
    updatePauseResumeButton(session.status);
    updateEngineStatus(session.status);
  }
}

function updatePauseResumeButton(status) {
  const btn = document.getElementById('pauseResumeBtn');
  if (status === 'paused') {
    btn.textContent = '▶ Resume';
    btn.onclick = () => togglePauseResume('resume');
  } else {
    btn.textContent = '⏸ Pause';
    btn.onclick = () => togglePauseResume('pause');
  }
  const isTerminal = status === 'done' || status === 'failed';
  btn.disabled = isTerminal;
  btn.style.opacity = isTerminal ? '0.4' : '1';

  updateFollowupBar(status);
}

// Follow-ups are only accepted server-side when the session is done, blocked,
// or paused (see forge/orchestrator.ts's addFollowUp) — a message landing
// mid-run would race the active iteration. Mirror that exact gate here so
// the input is disabled rather than letting the user send something that
// will just be rejected with an error.
function updateFollowupBar(status) {
  const input = document.getElementById('followupInput');
  const btn = document.getElementById('followupSendBtn');
  const usable = status === 'done' || status === 'blocked' || status === 'paused';
  input.disabled = !usable;
  btn.disabled = !usable;
  input.placeholder = usable
    ? 'Ask for a change…'
    : 'Ask for a change once the build finishes or pauses…';
}

async function togglePauseResume(action) {
  if (!activeSessionId) return;
  try {
    if (action === 'pause') await FORGE_API.pause(activeSessionId);
    else await FORGE_API.resume(activeSessionId);
    await refreshSessionList();
    const session = sessions.find(s => s.id === activeSessionId);
    if (session) {
      updatePauseResumeButton(session.status);
      updateEngineStatus(session.status);
    }
  } catch (err) {
    console.error('[FORGE][UI] pause/resume failed:', err);
  }
}

function updateEngineStatus(status) {
  const dot = document.getElementById('engineStatusDot');
  const text = document.getElementById('engineStatusText');
  dot.className = 'status-dot ' + statusDotClass(status);
  text.textContent = `ENGINE ${status.toUpperCase()}`;
}

/* ===================== TASK TREE ===================== */
async function loadTaskTree(sessionId) {
  let tasks = [];
  try {
    tasks = await FORGE_API.getTaskTree(sessionId);
  } catch (err) {
    console.error('[FORGE][UI] Failed to load task tree:', err);
    return;
  }
  renderTaskTree(tasks);
}

function renderTaskTree(tasks) {
  const treeEl = document.getElementById('taskTree');
  treeEl.innerHTML = '';

  const done = tasks.filter(t => t.status === 'done').length;
  document.getElementById('taskProgress').textContent = `${done} / ${tasks.length}`;

  // Build depth map from parentId chain for indentation
  const depthOf = (task, tasksById, seen = new Set()) => {
    if (!task.parentId || seen.has(task.id)) return 0;
    seen.add(task.id);
    const parent = tasksById.get(task.parentId);
    return parent ? 1 + depthOf(parent, tasksById, seen) : 0;
  };
  const byId = new Map(tasks.map(t => [t.id, t]));

  for (const task of tasks) {
    const depth = Math.min(depthOf(task, byId), 2);
    const node = document.createElement('div');
    node.className = `task-node depth-${depth}` + (task.isIntegrationCheck ? ' integration-check' : '');
    node.dataset.taskId = task.id;

    const icon = {
      done: '✓', in_progress: '◐', pending: '○', blocked: '⨯', failed: '✗',
    }[task.status] || '○';

    node.innerHTML = `
      <span class="tn-icon ${task.status}">${icon}</span>
      <div class="tn-body">
        <span class="tn-desc">${escapeHtml(task.description)}</span>
        ${task.lastError ? `<span class="tn-error">${escapeHtml(task.lastError)}</span>` : ''}
      </div>
    `;
    node.addEventListener('click', () => focusTask(task.id));
    treeEl.appendChild(node);
  }
}

async function focusTask(taskId) {
  document.querySelectorAll('.task-node').forEach(el =>
    el.classList.toggle('focused', el.dataset.taskId === taskId)
  );
  let history = [];
  try {
    history = await FORGE_API.getTaskLog(taskId);
  } catch (err) {
    console.error('[FORGE][UI] Failed to load task log:', err);
    return;
  }
  renderLogGroup(taskId, history, { replace: true, expanded: true });
}

/* ===================== LIVE LOG (SSE) ===================== */
function connectLiveLog(sessionId) {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  document.getElementById('forgeTerminal').innerHTML = '';
  resetRawActivityPanel();

  const es = new EventSource(FORGE_API.stream(sessionId));
  activeEventSource = es;

  const liveIndicator = document.getElementById('liveIndicator');
  es.onopen = () => { liveIndicator.style.opacity = '1'; };
  es.onerror = () => { liveIndicator.style.opacity = '0.3'; };

  // The backend (forge/routes.ts) sends NAMED SSE events — "iteration",
  // "status", "error" — not the unnamed default "message" event. A plain
  // es.onmessage handler would silently receive nothing from this stream;
  // each named event needs its own addEventListener.

  es.addEventListener('iteration', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    // routes.ts's payload shape: { id, taskId, phase, reasoning, output, timestamp }
    // "output" is the full raw model/exec output (JSON string); "reasoning"
    // is already extracted server-side. We show reasoning as the primary
    // line and stash a trimmed version of output as the expandable detail.
    // (The Raw Model Activity panel no longer gets its content from here —
    // it now streams live token-by-token via the "token" event below, so it
    // shows text as it's generated rather than all at once when the call
    // finishes and gets logged.)
    appendLogEvent({
      taskId: payload.taskId,
      phase: payload.phase,
      reasoning: payload.reasoning,
      detail: summarizeOutput(payload.output),
    });
  });

  // True token-by-token stream from modelClient.ts's live emitter — arrives
  // continuously as Ollama generates, independent of the 1s poll used for
  // "iteration"/"status" events. "backfill: true" means this is catch-up text
  // from a call already in progress when this tab connected (start a fresh
  // run so it doesn't visually run into whatever was here before); otherwise
  // it's a live incremental chunk to append to the current run.
  es.addEventListener('token', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.backfill) startNewRawStreamRun();
    streamRawText(payload.text || '');
  });

  es.addEventListener('status', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    // Status rides along on every poll tick even with no new iterations —
    // cheap to just re-fetch the task tree and reflect engine/pause state
    // rather than trying to diff it client-side.
    const session = sessions.find(s => s.id === activeSessionId);
    if (session && session.status !== payload.status) {
      session.status = payload.status;
      updatePauseResumeButton(payload.status);
      updateEngineStatus(payload.status);
      loadTaskTree(activeSessionId);
      refreshSessionList();
    }
    if (payload.status === 'done' || payload.status === 'failed' || payload.status === 'blocked') {
      liveIndicator.style.opacity = '0.3';
    }
  });

  // Tracks whether a call was active on the PREVIOUS raw_activity tick, so we
  // can detect the false->true transition — i.e. "a new call just started" —
  // and begin a fresh visual run for it. Without this, tokens from a new
  // THINK call would just run on straight after the previous EVALUATE call's
  // text with nothing to separate them.
  let wasActive = false;

  es.addEventListener('raw_activity', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (payload.active && !wasActive) {
      startNewRawStreamRun();
    }
    wasActive = payload.active;
    updateRawActivityStatus(payload);
  });

  es.addEventListener('error', (event) => {
    // Server-sent application-level error payload (distinct from the
    // browser-native es.onerror connection-level handler above).
    if (!event.data) return; // native connection errors fire here too with no data
    try {
      const payload = JSON.parse(event.data);
      console.error('[FORGE][UI] stream reported error:', payload.error);
    } catch {
      // ignore malformed error payloads
    }
  });
}

// output is a JSON string (the raw model action / eval result, or exec
// command output for ACT phases). Keep the detail row short and readable
// rather than dumping the whole raw JSON blob into the DOM.
function summarizeOutput(output) {
  if (!output) return '';
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === 'object' && parsed !== null) {
      const { reasoning, ...rest } = parsed;
      const str = JSON.stringify(rest);
      return str.length > 400 ? str.slice(0, 400) + '…' : str;
    }
  } catch {
    // not JSON — fall through to raw truncation
  }
  return output.length > 400 ? output.slice(0, 400) + '…' : output;
}

/* Groups consecutive events by taskId, matching the frontend plan's design:
   default-expanded for in_progress task, collapsed for done tasks, full
   history always available via click-through from the task tree. */
function appendLogEvent(evt) {
  renderLogGroup(evt.taskId, [evt], { replace: false, expanded: true });
}

function renderLogGroup(taskId, events, { replace, expanded }) {
  const terminal = document.getElementById('forgeTerminal');
  let group = terminal.querySelector(`.log-group[data-task-id="${taskId}"]`);

  if (replace && group) {
    group.remove();
    group = null;
  }

  if (!group) {
    group = document.createElement('div');
    group.className = 'log-group' + (expanded ? '' : ' collapsed');
    group.dataset.taskId = taskId;
    group.innerHTML = `
      <div class="log-group-head">
        <span class="lg-task">Task ${taskId.slice(0, 8)}</span>
        <span class="lg-toggle">▾</span>
      </div>
      <div class="log-group-body"></div>
    `;
    group.querySelector('.log-group-head').addEventListener('click', () => {
      group.classList.toggle('collapsed');
    });
    terminal.appendChild(group);
  }

  const body = group.querySelector('.log-group-body');
  for (const evt of events) {
    const line = document.createElement('div');
    line.className = 'log-line';
    line.innerHTML = `
      <span class="l-phase ${evt.phase}">[${evt.phase.toUpperCase()}]</span>
      <span class="l-reasoning">${escapeHtml(evt.reasoning || '')}</span>
      ${evt.detail ? `<span class="l-detail">${escapeHtml(evt.detail)}</span>` : ''}
    `;
    body.appendChild(line);
  }

  terminal.scrollTop = terminal.scrollHeight;
}

/* ===================== NEW SESSION MODAL ===================== */
const modal = document.getElementById('newSessionModal');
let selectedStack = 'node-express';

document.getElementById('newSessionBtn').addEventListener('click', () => {
  modal.classList.add('open');
});
document.getElementById('closeModalBtn').addEventListener('click', () => modal.classList.remove('open'));
document.getElementById('cancelSessionBtn').addEventListener('click', () => modal.classList.remove('open'));

document.querySelectorAll('.stack-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stack-opt').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedStack = btn.dataset.stack;
    document.getElementById('customStackWrap').style.display =
      selectedStack === 'general' ? 'block' : 'none';
  });
});
document.querySelector(`.stack-opt[data-stack="${selectedStack}"]`)?.classList.add('selected');

// Populate the model dropdown from forge.listModels — a live query against
// Ollama's /api/tags, so it always matches what's actually pulled locally.
// Falls back to a disabled placeholder if the call fails so the modal still
// opens usably rather than showing an empty select.
(async function populateModelSelect() {
  const select = document.getElementById('modelSelect');
  try {
    const models = await FORGE_API.listModels();
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
    console.error('[FORGE][UI] Failed to load model list:', err);
    select.innerHTML = `<option value="" disabled selected>Failed to load models</option>`;
  }
})();

document.getElementById('createSessionBtn').addEventListener('click', async () => {
  const goal = document.getElementById('goalInput').value.trim();
  if (!goal) return;
  const modelId = document.getElementById('modelSelect').value;
  const customStack = selectedStack === 'general'
    ? document.getElementById('customStackInput').value.trim()
    : undefined;

  try {
    const session = await FORGE_API.create(goal, selectedStack, modelId, customStack);
    modal.classList.remove('open');
    document.getElementById('goalInput').value = '';
    await refreshSessionList();
    await selectSession(session.id);
  } catch (err) {
    console.error('[FORGE][UI] Failed to create session:', err);
    alert(err?.message || 'Failed to create session — check the console for details.');
  }
});

/* ===================== FOLLOW-UP CHAT ===================== */
async function sendFollowUp() {
  if (!activeSessionId) return;
  const input = document.getElementById('followupInput');
  const message = input.value.trim();
  if (!message) return;

  const btn = document.getElementById('followupSendBtn');
  input.disabled = true;
  btn.disabled = true;

  try {
    await FORGE_API.followUp(activeSessionId, message);
    input.value = '';
    // Session just reopened to 'running' server-side — re-select to refresh
    // the task tree (new follow-up task should appear) and reconnect the
    // live tail, same as if the user had just created a new session.
    await refreshSessionList();
    await selectSession(activeSessionId);
  } catch (err) {
    console.error('[FORGE][UI] Follow-up failed:', err);
    alert(err?.message || 'Failed to send follow-up — check the console for details.');
    // Re-enable so the user isn't stuck if it failed (e.g. session was
    // actually still running and the backend rejected it).
    updateFollowupBar((sessions.find(s => s.id === activeSessionId) || {}).status || 'done');
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
// Poll session list every 5s for status changes (per frontend plan §2) —
// the active session's own detail is kept live via SSE instead.
setInterval(refreshSessionList, 5000);
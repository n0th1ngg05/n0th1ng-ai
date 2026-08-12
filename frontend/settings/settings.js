/* ===================== NAV & DRAWER ===================== */
const drawer = document.getElementById('drawer');
document.getElementById('burger').addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg').addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== SIDEBAR TOGGLE ===================== */
const leftSidebar = document.getElementById('leftSidebar');

document.getElementById('openLeftSidebar')?.addEventListener('click', () => {
  leftSidebar.classList.add('open');
});
document.getElementById('closeLeftSidebar')?.addEventListener('click', () => {
  leftSidebar.classList.remove('open');
});

/* ===================== TRPC CLIENT (no bundler — plain fetch) ===================== */
const TRPC_BASE = '/api/trpc';

async function trpcQuery(path, input) {
  const url = new URL(TRPC_BASE + '/' + path, window.location.origin);
  if (input !== undefined) {
    url.searchParams.set('input', JSON.stringify({ json: input }));
  }
  const res = await fetch(url.toString(), { method: 'GET' });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'tRPC query failed');
  return data.result.data.json;
}

async function trpcMutation(path, input) {
  const res = await fetch(TRPC_BASE + '/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ json: input ?? {} }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'tRPC mutation failed');
  return data.result.data.json;
}

/* ===================== QUICK ACTIONS ===================== */
window.triggerAction = function(btn) {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Executing...';
  btn.style.opacity = '0.7';
  setTimeout(() => {
    btn.innerHTML = '✔ Done';
    btn.style.color = '#4ade80';
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.color = '';
      btn.style.opacity = '1';
    }, 1500);
  }, 600);
};

// Same visual feedback pattern, but actually awaits a real async call
// instead of a setTimeout, and shows an error state if the call fails.
async function runAction(btn, fn) {
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Working…';
  btn.style.opacity = '0.7';
  try {
    await fn();
    btn.innerHTML = '✔ Done';
    btn.style.color = '#4ade80';
  } catch (err) {
    console.error(err);
    btn.innerHTML = '✕ Failed';
    btn.style.color = '#f87171';
  } finally {
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.style.color = '';
      btn.style.opacity = '1';
      btn.disabled = false;
    }, 1500);
  }
}

function fmtBytes(bytes) {
  if (!bytes && bytes !== 0) return 'Unknown';
  const gb = bytes / 1024 / 1024 / 1024;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/* ===================== CATEGORY SWITCHING ===================== */
const navItems = document.querySelectorAll('#settingsNav li');
const sections = document.querySelectorAll('.settings-section');
const categoryTitle = document.getElementById('currentCategoryTitle');

// Sections whose data is fetched lazily, only the first time the tab is opened.
const sectionLoaders = {
  'sec-models': loadModels,
  'sec-python': loadPython,
  'sec-speech': loadSpeech,
  'sec-cluster': loadCluster,
};
const loadedSections = new Set();

navItems.forEach(item => {
  item.addEventListener('click', () => {
    // 1. Update Navigation State
    navItems.forEach(nav => nav.classList.remove('active'));
    item.classList.add('active');

    // 2. Close mobile sidebar if open
    if(window.innerWidth <= 1024) {
      leftSidebar.classList.remove('open');
    }

    // 3. Update Title
    // Get text node ignoring SVG
    const titleText = Array.from(item.childNodes)
      .find(node => node.nodeType === Node.TEXT_NODE)
      .textContent.trim();
    categoryTitle.textContent = titleText + ' Settings';

    // 4. Switch Content Panels
    const targetId = item.getAttribute('data-target');

    sections.forEach(sec => {
      if (sec.id === targetId) {
        sec.classList.remove('hidden');
        // Re-trigger animation
        sec.classList.remove('fade-up');
        void sec.offsetWidth; // trigger reflow
        sec.classList.add('fade-up');
      } else {
        sec.classList.add('hidden');
      }
    });

    // 5. Lazy-load real data the first time this tab is opened
    if (sectionLoaders[targetId] && !loadedSections.has(targetId)) {
      loadedSections.add(targetId);
      sectionLoaders[targetId]();
    }
  });
});

/* ===================== SEARCH SIMULATION ===================== */
const searchInput = document.getElementById('settingsSearch');

searchInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();

  navItems.forEach(item => {
    const text = item.textContent.toLowerCase();
    if (text.includes(term)) {
      item.style.display = 'flex';
    } else {
      item.style.display = 'none';
    }
  });
});

/* ===================== AI MODELS (real Ollama data) ===================== */
const keepAliveToggle = document.getElementById('keepAliveToggle');

async function loadModels() {
  const activeEl = document.getElementById('activeModelsList');
  const installedEl = document.getElementById('installedModelsList');

  try {
    const models = await trpcQuery('model.list');
    const active = models.filter(m => m.status === 'active');
    const idle = models.filter(m => m.status !== 'active');

    activeEl.innerHTML = active.length
      ? active.map(renderActiveModelCard).join('')
      : '<p class="text-muted mono" style="font-size:.8rem;">No models currently loaded.</p>';

    installedEl.innerHTML = idle.length
      ? idle.map(renderInstalledModelRow).join('')
      : '<li><span class="ml-desc mono text-muted">No idle models on disk.</span></li>';

    wireModelButtons();
  } catch (err) {
    console.error(err);
    activeEl.innerHTML = '<p class="text-danger mono" style="font-size:.8rem;">Failed to reach Ollama.</p>';
    installedEl.innerHTML = '<li><span class="ml-desc mono text-danger">Failed to reach Ollama.</span></li>';
  }
}

function renderActiveModelCard(m) {
  const controls = m.source === 'openrouter'
    ? '<span class="mono text-muted" style="font-size:.75rem;">API model</span>'
    : `<button class="action-btn unload-btn" data-id="${m.id}">Unload</button>`;
  return `
    <div class="model-card glass-strong mt-12" data-model-id="${m.id}">
      <div class="mc-head">
        <div class="mc-title">
          <span class="status-dot healthy"></span> <h4>${m.displayName}</h4>
        </div>
        ${controls}
      </div>
      <div class="mc-stats mono text-muted">
        <span>Size: ${fmtBytes(m.size)}</span> • <span>Context: ${m.contextLength}</span> • <span>Quant: ${m.quantization}</span>
      </div>
    </div>`;
}

function renderInstalledModelRow(m) {
  const controls = m.source === 'openrouter'
    ? '<span class="mono text-muted" style="font-size:.75rem;">Available via API</span>'
    : `<button class="action-btn load-btn" data-id="${m.id}">Load</button>`;
  return `
    <li data-model-id="${m.id}">
      <div class="ml-info">
        <span class="ml-name">${m.name}</span>
        <span class="ml-desc mono">Size: ${fmtBytes(m.size)}</span>
      </div>
      <div class="ml-actions">${controls}</div>
    </li>`;
}

function wireModelButtons() {
  document.querySelectorAll('.load-btn').forEach(btn => {
    btn.addEventListener('click', () => runAction(btn, async () => {
      const keepAlive = keepAliveToggle?.checked ? -1 : undefined;
      await trpcMutation('model.load', { id: btn.dataset.id, keepAlive });
      await loadModels();
    }));
  });
  document.querySelectorAll('.unload-btn').forEach(btn => {
    btn.addEventListener('click', () => runAction(btn, async () => {
      await trpcMutation('model.unload', { id: btn.dataset.id });
      await loadModels();
    }));
  });
}

/* ===================== PYTHON TOOLS (real runtime control) ===================== */
async function loadPython() {
  await refreshPythonStatus();

  document.getElementById('pythonStartBtn').addEventListener('click', (e) =>
    runAction(e.target, async () => {
      await trpcMutation('runtime.python.start');
      await refreshPythonStatus();
    }));

  document.getElementById('pythonStopBtn').addEventListener('click', (e) =>
    runAction(e.target, async () => {
      await trpcMutation('runtime.python.stop');
      await refreshPythonStatus();
    }));
}

async function refreshPythonStatus() {
  const dot = document.getElementById('pythonStatusDot');
  const text = document.getElementById('pythonStatusText');
  try {
    const status = await trpcQuery('runtime.python.status');
    const running = !!status.python;
    dot.classList.toggle('healthy', running);
    dot.style.background = running ? '' : 'var(--fg-dim)';
    text.textContent = running ? 'Running' : 'Stopped';
  } catch (err) {
    console.error(err);
    text.textContent = 'Unknown';
  }
}

/* ===================== SPEECH TOOLS (real runtime + providers) ===================== */
async function loadSpeech() {
  await refreshSpeechStatus();
  await loadSpeechProviders();

  document.getElementById('speechStartBtn').addEventListener('click', (e) =>
    runAction(e.target, async () => {
      await trpcMutation('speech.runtime.start', { providerId: 'kokoro' });
      await refreshSpeechStatus();
    }));

  document.getElementById('speechStopBtn').addEventListener('click', (e) =>
    runAction(e.target, async () => {
      await trpcMutation('speech.runtime.stop');
      await refreshSpeechStatus();
    }));
}

async function refreshSpeechStatus() {
  const dot = document.getElementById('speechStatusDot');
  const text = document.getElementById('speechStatusText');
  const meta = document.getElementById('speechRuntimeMeta');
  try {
    const runtimes = await trpcQuery('speech.runtime.status');
    const running = runtimes.length > 0;
    dot.classList.toggle('healthy', running);
    dot.style.background = running ? '' : 'var(--fg-dim)';
    text.textContent = running ? 'Running' : 'Stopped (lazy-boots on first request)';
    meta.textContent = running
      ? `Port ${runtimes[0].port} · status: ${runtimes[0].status}`
      : 'Port 9000';
  } catch (err) {
    console.error(err);
    text.textContent = 'Unknown';
  }
}

async function loadSpeechProviders() {
  const el = document.getElementById('speechProvidersList');
  try {
    const providers = await trpcQuery('speech.providers.list');
    el.innerHTML = providers.length
      ? providers.map(p => `
          <li>
            <div class="ml-info">
              <span class="ml-name">${p.id ?? p.name}</span>
              <span class="ml-desc mono">${p.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </li>`).join('')
      : '<li><span class="ml-desc mono text-muted">No providers configured.</span></li>';
  } catch (err) {
    console.error(err);
    el.innerHTML = '<li><span class="ml-desc mono text-danger">Failed to load providers.</span></li>';
  }
}

/* ===================== CLUSTER SYSTEM (real worker heartbeats) ===================== */
async function loadCluster() {
  const el = document.getElementById('clusterWorkersList');
  try {
    const workers = await trpcQuery('cluster.workers');
    el.innerHTML = workers.length
      ? workers.map(renderWorkerCard).join('')
      : '<p class="text-muted mono" style="font-size:.8rem;">No workers currently registered.</p>';
    wireWorkerCardClicks();
  } catch (err) {
    console.error(err);
    el.innerHTML = '<p class="text-danger mono" style="font-size:.8rem;">Failed to load cluster state.</p>';
  }
}

function renderWorkerCard(w) {
  return `
    <div class="model-card glass-strong mt-12 worker-clickable" data-worker-id="${w.id}">
      <div class="mc-head">
        <div class="mc-title">
          <span class="status-dot ${w.online ? 'healthy' : ''}" style="${w.online ? '' : 'background:var(--color-danger);'}"></span>
          <h4>${w.hostname}</h4>
        </div>
        <span class="mono text-muted" style="font-size:.75rem;">${w.currentJobs} job(s)</span>
      </div>
      <div class="mc-stats mono text-muted">
        <span>${w.ip}:${w.port}</span> • <span>CPU ${w.health?.cpu ?? '—'}%</span> • <span>RAM ${w.health?.ram ?? '—'}%</span> • <span>GPU ${w.health?.gpu ?? '—'}%</span>
      </div>
      <div class="mc-stats mono text-muted">
        <span>Python: ${w.runtimes?.python ? 'online' : 'offline'}</span> • <span>Speech: ${w.runtimes?.speech ? 'online' : 'offline'}</span> • <span>Tools: ${w.tools?.length ?? 0}</span>
      </div>
    </div>`;
}

function wireWorkerCardClicks() {
  document.querySelectorAll('[data-worker-id]').forEach(card => {
    card.addEventListener('click', () => openWorkerModal(card.dataset.workerId));
  });
}

/* ===================== WORKER DETAIL MODAL ===================== */
const workerModalOverlay = document.getElementById('workerModalOverlay');
const wmCloseBtn = document.getElementById('wmCloseBtn');

let wmCurrentWorkerId = null;
let wmPollTimer = null;
let wmEventSource = null;
let wmActiveLogSource = 'worker'; // 'worker' (python+speech) | 'kokoro'
const WM_POLL_INTERVAL_MS = 4000;

function fmtRate(bytesPerSec) {
  if (!bytesPerSec) return '0 KB/s';
  const kb = bytesPerSec / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(2)} MB/s` : `${kb.toFixed(0)} KB/s`;
}

function closeWorkerModal() {
  workerModalOverlay.classList.remove('open');
  wmCurrentWorkerId = null;
  if (wmPollTimer) { clearInterval(wmPollTimer); wmPollTimer = null; }
  if (wmEventSource) { wmEventSource.close(); wmEventSource = null; }
}

wmCloseBtn.addEventListener('click', closeWorkerModal);
workerModalOverlay.addEventListener('click', (e) => {
  if (e.target === workerModalOverlay) closeWorkerModal();
});

document.querySelectorAll('.wm-log-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.wm-log-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    wmActiveLogSource = tab.dataset.logSource;
    startLogStream();
  });
});

async function openWorkerModal(workerId) {
  wmCurrentWorkerId = workerId;
  wmActiveLogSource = 'worker';
  document.querySelectorAll('.wm-log-tab').forEach(t => t.classList.toggle('active', t.dataset.logSource === 'worker'));
  document.getElementById('wmLogPane').innerHTML = '';

  try {
    const worker = await trpcQuery('cluster.worker', { id: workerId });
    if (!worker) {
      document.getElementById('wmHostname').textContent = 'Worker not found';
      workerModalOverlay.classList.add('open');
      return;
    }
    document.getElementById('wmHostname').textContent = worker.hostname;
    const dot = document.getElementById('wmStatusDot');
    dot.classList.toggle('healthy', worker.online);
    dot.style.background = worker.online ? '' : 'var(--color-danger)';
  } catch (err) {
    console.error(err);
  }

  workerModalOverlay.classList.add('open');

  await refreshWorkerMetrics();
  wmPollTimer = setInterval(refreshWorkerMetrics, WM_POLL_INTERVAL_MS);

  startLogStream();
}

async function refreshWorkerMetrics() {
  if (!wmCurrentWorkerId) return;
  try {
    const points = await trpcQuery('cluster.metricHistory', { id: wmCurrentWorkerId });
    renderMetricSeries(points);
  } catch (err) {
    console.error(err);
  }
}

function renderMetricSeries(points) {
  const latest = points[points.length - 1];

  document.getElementById('wmCpuValue').textContent = latest ? `${latest.cpu}%` : '—';
  document.getElementById('wmRamValue').textContent = latest ? `${latest.ram} GB` : '—';
  document.getElementById('wmGpuValue').textContent = latest ? `${latest.gpu}%` : '—';
  document.getElementById('wmCpuTempValue').textContent = latest?.cpuTemp != null ? `${latest.cpuTemp}°C` : 'N/A';
  document.getElementById('wmGpuTempValue').textContent = latest?.gpuTemp != null ? `${latest.gpuTemp}°C` : 'N/A';
  document.getElementById('wmRxValue').textContent = latest ? fmtRate(latest.rxBytesPerSec) : '—';
  document.getElementById('wmTxValue').textContent = latest ? fmtRate(latest.txBytesPerSec) : '—';

  drawSparkline('wmCpuChart', points.map(p => p.cpu), 0, 100);
  drawSparkline('wmRamChart', points.map(p => p.ram), 0, null);
  drawSparkline('wmGpuChart', points.map(p => p.gpu), 0, 100);
  drawSparkline('wmCpuTempChart', points.map(p => p.cpuTemp ?? 0), 0, null);
  drawSparkline('wmGpuTempChart', points.map(p => p.gpuTemp ?? 0), 0, null);
  drawSparkline('wmRxChart', points.map(p => p.rxBytesPerSec), 0, null);
  drawSparkline('wmTxChart', points.map(p => p.txBytesPerSec), 0, null);
}

// Minimal dependency-free sparkline renderer — this is a static-file
// frontend with no bundler, so pulling in a charting library for five
// small trend lines isn't worth it. Canvas 2D is plenty for this.
function drawSparkline(canvasId, values, min, max) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 200;
  const height = rect.height || 44;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  if (!values.length) return;

  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values, lo + 1);
  const range = hi - lo || 1;

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - ((v - lo) / range) * height;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });

  ctx.strokeStyle = 'rgba(212,175,55,0.9)';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Fill under the line for a subtle area effect
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(212,175,55,0.08)';
  ctx.fill();
}

/* ===================== LIVE LOG STREAM (SSE) ===================== */
function startLogStream() {
  if (wmEventSource) { wmEventSource.close(); wmEventSource = null; }
  if (!wmCurrentWorkerId) return;

  const pane = document.getElementById('wmLogPane');
  pane.innerHTML = '';

  // "worker" tab shows both python + speech (all worker-side activity,
  // no filter); "kokoro" tab hits the worker's own Kokoro-line filter,
  // since Speech Runtime is one process for all 7 TTS/STT providers and
  // there's no separate Kokoro process to isolate at the source.
  const sourceParam = wmActiveLogSource === 'kokoro' ? 'kokoro' : '';

  // Snapshot first so the pane isn't empty while the stream connects.
  trpcQuery('cluster.logs', {
    id: wmCurrentWorkerId,
    ...(sourceParam ? { source: sourceParam } : {}),
  }).then(res => {
    (res?.lines ?? []).forEach(appendLogLine);
    pane.scrollTop = pane.scrollHeight;
  }).catch(err => console.error(err));

  const url = new URL(`/api/cluster/${wmCurrentWorkerId}/logs/stream`, window.location.origin);
  if (sourceParam) url.searchParams.set('source', sourceParam);

  wmEventSource = new EventSource(url.toString());
  wmEventSource.onmessage = (event) => {
    try {
      appendLogLine(JSON.parse(event.data));
      const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
      if (atBottom) pane.scrollTop = pane.scrollHeight;
    } catch (err) {
      console.error('Bad log event', err);
    }
  };
  wmEventSource.onerror = () => {
    // EventSource auto-reconnects on its own; nothing to do here beyond
    // not crashing. If the worker stays unreachable it'll just keep
    // retrying quietly in the background per the browser's default policy.
  };
}

function appendLogLine(entry) {
  const pane = document.getElementById('wmLogPane');
  if (!pane) return;
  const div = document.createElement('div');
  div.className = `wm-log-line ${entry.stream === 'stderr' ? 'stderr' : ''}`;
  const ts = new Date(entry.timestamp || Date.now()).toLocaleTimeString();
  div.innerHTML = `<span class="wm-log-ts">${ts}</span>${escapeHtml(entry.line ?? '')}`;
  pane.appendChild(div);

  // Cap DOM nodes so a chatty worker doesn't slowly bloat the page while
  // the modal sits open for a long session.
  while (pane.children.length > 500) {
    pane.removeChild(pane.firstChild);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===================== INITIAL LOAD ===================== */
// The active tab on page load is General, which needs no live data — but
// if a future default changes, or the user reloads mid-tab via deep link,
// make sure whichever section is already visible on load gets populated.
document.addEventListener('DOMContentLoaded', () => {
  const activeItem = document.querySelector('#settingsNav li.active');
  const targetId = activeItem?.getAttribute('data-target');
  if (targetId && sectionLoaders[targetId] && !loadedSections.has(targetId)) {
    loadedSections.add(targetId);
    sectionLoaders[targetId]();
  }
});
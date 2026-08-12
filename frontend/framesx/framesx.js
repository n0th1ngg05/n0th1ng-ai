// ─── FramesX frontend — wired to the real backend ───────────────────────
// POST   /api/video/generate        kick off a job
// GET    /api/video/stream/:jobId   SSE — live LLM tokens, ComfyUI node/step
// GET    /api/video/status/:jobId   poll fallback (job.progress is 0-100)
// GET    /api/video/result/:jobId   poll fallback for final payload
// GET    /api/video/list            gallery (full DB rows)
// DELETE /api/video/:id             delete a gallery item
// GET    /api/models/list           real installed Ollama models
// GET    /api/trpc/providers.list   registered video providers (id+label+executor)

const SINGLE_SCENE_MAX = 6;

let config = {
  prompt: '',
  negative: '',
  aspect: '16:9',
  format: 'mp4',
  duration: 8,
  planMode: 'auto',
  sceneCount: 3,
  fps: 24,
  steps: 30,
  cfg: 3,
  seed: null,
  planningModel: null,
  // Wired to the Video Provider dropdown — sent as `providerId` in the
  // POST /api/video/generate body. Defaults to null (backend picks the
  // first registered video provider).
  providerId: null,
};

// Stores the full provider object for the currently selected provider so
// we can check executor type (ltx-3-stage vs single-stage) in the UI.
let selectedProvider = null;

let currentJobId = null;
let currentEventSource = null;
let currentStatusPollTimer = null;

// ── Navbar / Drawer ───────────────────────────────────────────────────
const burgerBtn = document.getElementById('burger');
const closeDrawerBtn = document.getElementById('closeDrawer');
const drawerWrap = document.getElementById('drawer');

burgerBtn.addEventListener('click', () => drawerWrap.classList.add('open'));
closeDrawerBtn.addEventListener('click', () => drawerWrap.classList.remove('open'));
drawerWrap.addEventListener('click', (e) => {
  if (e.target === drawerWrap || e.target.classList.contains('drawer-bg')) {
    drawerWrap.classList.remove('open');
  }
});

// ── Inspector / Gallery panels ────────────────────────────────────────
const inspectorPanel = document.getElementById('inspectorPanel');
const toggleInspector = document.getElementById('toggleInspector');
const closeInspector = document.getElementById('closeInspector');

const galleryPanel = document.getElementById('galleryPanel');
const toggleGallery = document.getElementById('toggleGallery');
const closeGallery = document.getElementById('closeGallery');

toggleInspector.addEventListener('click', () => {
  inspectorPanel.classList.toggle('open');
  if (inspectorPanel.classList.contains('open')) galleryPanel.classList.remove('open');
});
closeInspector.addEventListener('click', () => inspectorPanel.classList.remove('open'));

toggleGallery.addEventListener('click', () => {
  galleryPanel.classList.toggle('open');
  if (galleryPanel.classList.contains('open')) {
    inspectorPanel.classList.remove('open');
    loadGallery();
  }
});
closeGallery.addEventListener('click', () => galleryPanel.classList.remove('open'));

document.addEventListener('click', (e) => {
  const isClickInsideInspector = inspectorPanel.contains(e.target) || toggleInspector.contains(e.target);
  const isClickInsideGallery = galleryPanel.contains(e.target) || toggleGallery.contains(e.target);

  if (!isClickInsideInspector && inspectorPanel.classList.contains('open')) {
    inspectorPanel.classList.remove('open');
  }
  if (!isClickInsideGallery && galleryPanel.classList.contains('open')) {
    galleryPanel.classList.remove('open');
  }
});

// ── Composer ──────────────────────────────────────────────────────────
const composerIsland = document.getElementById('composerIsland');
const promptInput = document.getElementById('promptInput');
const negPromptInput = document.getElementById('negPromptInput');
const btnToggleNeg = document.getElementById('btnToggleNeg');
const negPromptWrap = document.getElementById('negPromptWrap');

btnToggleNeg.addEventListener('click', () => {
  negPromptWrap.classList.toggle('hidden');
  if (!negPromptWrap.classList.contains('hidden')) negPromptInput.focus();
});

window.setPrompt = (text) => {
  promptInput.value = text;
  promptInput.focus();
};

// ── View refs ─────────────────────────────────────────────────────────
const emptyView = document.getElementById('emptyView');
const genView = document.getElementById('genView');
const loaderOverlay = document.getElementById('loaderOverlay');
const resultVideo = document.getElementById('resultVideo');
const sceneTracker = document.getElementById('sceneTracker');
const resultActions = document.getElementById('resultActions');
const progressBar = document.getElementById('progressBar');

const loaderPhase = document.getElementById('loaderPhase');
const loaderProgress = document.getElementById('loaderProgress');

const liveLogBody = document.getElementById('liveLogBody');
const liveLogDot = document.getElementById('liveLogDot');

// ── Inspector control binders ────────────────────────────────────────
document.getElementById('sliderDuration').addEventListener('input', (e) => {
  config.duration = parseInt(e.target.value, 10);
  document.getElementById('valDuration').innerText = config.duration + 's';
  checkSceneLogic();
});

document.getElementById('sliderScenes').addEventListener('input', (e) => {
  config.sceneCount = parseInt(e.target.value, 10);
  document.getElementById('valScenes').innerText = config.sceneCount;
});

document.getElementById('sliderSteps').addEventListener('input', (e) => {
  config.steps = parseInt(e.target.value, 10);
  document.getElementById('valSteps').innerText = config.steps;
});

document.getElementById('sliderCfg').addEventListener('input', (e) => {
  config.cfg = parseFloat(e.target.value);
  document.getElementById('valCfg').innerText = config.cfg.toFixed(1);
});

document.getElementById('seedInput').addEventListener('input', (e) => {
  config.seed = e.target.value ? parseInt(e.target.value, 10) : null;
});

document.getElementById('btnRandomSeed').addEventListener('click', () => {
  const seed = Math.floor(Math.random() * 999999999999999);
  document.getElementById('seedInput').value = seed;
  config.seed = seed;
});

document.getElementById('fpsSelect').addEventListener('change', (e) => {
  config.fps = parseInt(e.target.value, 10);
});

document.getElementById('planModeSelect').addEventListener('change', (e) => {
  config.planMode = e.target.value;
  const autoBlock = document.getElementById('autoSceneConfig');
  const manualBlock = document.getElementById('manualSceneConfig');
  if (config.planMode === 'manual') {
    manualBlock.classList.remove('hidden');
    autoBlock.classList.add('hidden');
  } else {
    manualBlock.classList.add('hidden');
    autoBlock.classList.remove('hidden');
  }
});

document.getElementById('planningModel').addEventListener('change', (e) => {
  config.planningModel = e.target.value;
});

const formatBtns = document.querySelectorAll('#formatControl .segment-btn');
formatBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    formatBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    config.format = btn.getAttribute('data-val');
  });
});

document.getElementById('aspectSelect').addEventListener('change', (e) => {
  config.aspect = e.target.value;
  const customBlock = document.getElementById('customResBlock');
  if (config.aspect === 'custom') {
    customBlock.classList.remove('hidden');
    // Seed with sane defaults the first time Custom is picked.
    const widthInput = document.getElementById('customWidth');
    const heightInput = document.getElementById('customHeight');
    if (!widthInput.value) widthInput.value = config.customWidth || 768;
    if (!heightInput.value) heightInput.value = config.customHeight || 512;
    config.customWidth = parseInt(widthInput.value, 10);
    config.customHeight = parseInt(heightInput.value, 10);
  } else {
    customBlock.classList.add('hidden');
  }
});

// Snaps to the nearest multiple of 32 — LTX-Video (and most diffusion
// video models) expect latent-friendly dimensions. Applied on change/blur
// rather than on every keystroke so the person can still type freely.
function snapTo32(value, min, max) {
  const n = parseInt(value, 10);
  if (!n || Number.isNaN(n)) return min;
  const snapped = Math.round(n / 32) * 32;
  return Math.min(max, Math.max(min, snapped));
}

const customWidthInput = document.getElementById('customWidth');
const customHeightInput = document.getElementById('customHeight');

customWidthInput.addEventListener('change', (e) => {
  const snapped = snapTo32(e.target.value, 256, 1920);
  e.target.value = snapped;
  config.customWidth = snapped;
});
customHeightInput.addEventListener('change', (e) => {
  const snapped = snapTo32(e.target.value, 256, 1920);
  e.target.value = snapped;
  config.customHeight = snapped;
});

function checkSceneLogic() {
  const sceneBlock = document.getElementById('sceneBlock');
  if (config.duration > SINGLE_SCENE_MAX) {
    sceneBlock.classList.remove('disabled');
  } else {
    sceneBlock.classList.add('disabled');
  }
}
checkSceneLogic();

// ── Aspect ratio -> width/height (matches LTX workflow defaults) ──────
function aspectToDimensions(aspect) {
  switch (aspect) {
    case '9:16': return { width: 512, height: 768 };
    case '1:1': return { width: 576, height: 576 };
    case 'custom':
      return {
        width: snapTo32(config.customWidth || 768, 256, 1920),
        height: snapTo32(config.customHeight || 512, 256, 1920),
      };
    case '16:9':
    default: return { width: 768, height: 512 };
  }
}

// ── Load real installed models into the planning-model select ────────
async function loadPlanningModels() {
  const select = document.getElementById('planningModel');
  try {
    const res = await fetch('/api/models/list');
    const data = await res.json();

    if (!data.success || !data.models || data.models.length === 0) {
      select.innerHTML = '<option value="" disabled selected>No models found</option>';
      return;
    }

    select.innerHTML = '';
    const openRouterModels = data.models.filter(m => m.source === "openrouter");
    const ollamaModels = data.models.filter(m => m.source === "ollama");

    const renderGroup = (title, groupModels) => {
      if (!groupModels.length) return;
      const optgroup = document.createElement("optgroup");
      optgroup.label = title;
      groupModels.forEach((model, i) => {
        const opt = document.createElement('option');
        opt.value = model.id;
        opt.textContent = model.status === 'active' ? `${model.name} (loaded)` : model.name;
        // set first option as selected
        if (i === 0 && !select.options.length) opt.selected = true;
        optgroup.appendChild(opt);
      });
      select.appendChild(optgroup);
    };

    renderGroup("Open Router", openRouterModels);
    renderGroup("Ollama", ollamaModels);

    config.planningModel = data.models[0].id;
  } catch (err) {
    select.innerHTML = '<option value="" disabled selected>Ollama unreachable</option>';
    console.error('Failed to load models:', err);
  }
}
loadPlanningModels();

// ── Load registered video providers from the backend registry ──────────
// Calls GET /api/trpc/providers.list (video providers only). Selecting a
// provider: sets config.providerId, updates steps/cfg to provider defaults,
// and shows the LTX 3-stage badge when executor === "ltx-3-stage".
async function loadVideoProviders() {
  const select = document.getElementById('providerSelect');
  const ltxBadge = document.getElementById('ltxBadge');

  try {
    const url = `/api/trpc/providers.list?input=${encodeURIComponent(JSON.stringify({ json: { mediaType: 'video' } }))}`;
    const res = await fetch(url);
    const data = await res.json();
    const providers = data?.result?.data?.json;

    if (!providers || providers.length === 0) {
      select.innerHTML = '<option value="" disabled selected>No video providers found</option>';
      return;
    }

    select.innerHTML = '';
    providers.forEach((p, i) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      opt.dataset.executor = p.executor;
      if (i === 0) opt.selected = true;
      select.appendChild(opt);
    });

    // Apply the first provider immediately.
    applyProvider(providers[0]);

    select.addEventListener('change', () => {
      const chosen = providers.find(p => p.id === select.value);
      if (chosen) applyProvider(chosen);
    });

    function applyProvider(p) {
      selectedProvider = p;
      config.providerId = p.id;

      // Show/hide the LTX 3-stage pipeline info badge.
      if (p.executor === 'ltx-3-stage') {
        ltxBadge.classList.remove('hidden');
      } else {
        ltxBadge.classList.add('hidden');
      }
    }
  } catch (err) {
    select.innerHTML = '<option value="" disabled selected>Could not load providers</option>';
    console.error('Failed to load video providers:', err);
  }
}
loadVideoProviders();

// ── Generate ──────────────────────────────────────────────────────────
document.getElementById('btnGenerate').addEventListener('click', () => {
  config.prompt = promptInput.value.trim();
  config.negative = negPromptInput.value.trim();

  if (!config.prompt) {
    promptInput.focus();
    return;
  }

  const isMulti = config.duration > SINGLE_SCENE_MAX;
  if (isMulti && config.planMode === 'auto' && !config.planningModel) {
    alert('Select a planning model, or wait for models to finish loading.');
    return;
  }

  startGeneration();
});

async function startGeneration() {
  emptyView.style.display = 'none';
  genView.style.display = 'flex';

  loaderOverlay.style.display = 'flex';
  resultVideo.style.display = 'none';
  resultActions.classList.add('hidden');
  sceneTracker.classList.add('hidden');
  progressBar.style.width = '0%';
  liveLogBody.innerHTML = '';
  liveLogDot.style.display = 'block';

  composerIsland.style.transform = 'translateX(-50%) translateY(150%)';
  composerIsland.style.opacity = '0';
  inspectorPanel.classList.remove('open');

  const playerContainer = document.querySelector('.player-container');
  const { width, height } = aspectToDimensions(config.aspect);
  playerContainer.style.aspectRatio = `${width}/${height}`;

  const isMulti = config.duration > SINGLE_SCENE_MAX;

  const body = {
    prompt: config.prompt,
    negativePrompt: config.negative || undefined,
    width,
    height,
    fps: config.fps,
    steps: config.steps,
    cfg: config.cfg,
    seed: config.seed || undefined,
    format: config.format,
    // Send the selected provider id so the backend routes to the correct
    // workflow + executor (single-stage or ltx-3-stage). Omit when null
    // so the backend falls back to its first registered video provider.
    providerId: config.providerId || undefined,
  };

  if (isMulti) {
    body.targetDurationSeconds = config.duration;
    if (config.planMode === 'manual') {
      body.sceneCountOverride = config.sceneCount;
    } else {
      body.planningModel = config.planningModel;
    }
  }

  logLine('Submitting job to FramesX...', 'tag-scene');
  loaderPhase.innerText = 'Queueing...';
  loaderProgress.innerText = '0% · QUEUED';

  try {
    const res = await fetch('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!data.success) {
      logLine(`Error: ${data.error || 'Failed to start generation.'}`, 'tag-error');
      loaderPhase.innerText = 'Failed to start';
      return;
    }

    currentJobId = data.jobId;

    const expectedScenes = isMulti ? (config.planMode === 'manual' ? config.sceneCount : null) : 1;
    setupSceneTracker(expectedScenes);

    connectLiveStream(currentJobId);
    startStatusPolling(currentJobId); // fallback in case the SSE stream drops
  } catch (err) {
    logLine(`Error: ${err.message}`, 'tag-error');
    loaderPhase.innerText = 'Connection failed';
    console.error(err);
  }
}

function setupSceneTracker(sceneCount) {
  if (!sceneCount || sceneCount <= 1) {
    sceneTracker.classList.add('hidden');
    return;
  }
  sceneTracker.classList.remove('hidden');
  sceneTracker.innerHTML = '';
  for (let i = 0; i < sceneCount; i++) {
    const dot = document.createElement('div');
    dot.className = 'scene-dot';
    dot.id = `sdot_${i}`;
    sceneTracker.appendChild(dot);
  }
}

function updateSceneDots(currentIndex, total, allDone) {
  if (sceneTracker.children.length !== total) {
    setupSceneTracker(total);
  }
  for (let i = 0; i < total; i++) {
    const dot = document.getElementById(`sdot_${i}`);
    if (!dot) continue;
    if (allDone || i < currentIndex) dot.className = 'scene-dot done';
    else if (i === currentIndex) dot.className = 'scene-dot active';
    else dot.className = 'scene-dot';
  }
}

// ── Live log helper ───────────────────────────────────────────────────
function logLine(text, tagClass) {
  const line = document.createElement('div');
  line.className = 'live-log-line' + (tagClass ? ' ' + tagClass : '');
  line.textContent = text;
  liveLogBody.appendChild(line);
  liveLogBody.scrollTop = liveLogBody.scrollHeight;

  while (liveLogBody.children.length > 200) {
    liveLogBody.removeChild(liveLogBody.firstChild);
  }
}

let planningTokenLine = null;
function logToken(token) {
  if (!planningTokenLine) {
    planningTokenLine = document.createElement('div');
    planningTokenLine.className = 'live-log-line live-log-token';
    liveLogBody.appendChild(planningTokenLine);
  }
  planningTokenLine.textContent += token;
  liveLogBody.scrollTop = liveLogBody.scrollHeight;
}
function resetTokenLine() {
  planningTokenLine = null;
}

// ── SSE: live event stream ───────────────────────────────────────────
function connectLiveStream(jobId) {
  if (currentEventSource) {
    currentEventSource.close();
  }

  const es = new EventSource(`/api/video/stream/${jobId}`);
  currentEventSource = es;

  es.addEventListener('planning_start', (e) => {
    const data = JSON.parse(e.data);
    loaderPhase.innerText = 'Planning scenes...';
    logLine(`Planning with ${data.model} — target ${data.targetDurationSeconds}s`, 'tag-plan');
  });

  es.addEventListener('planning_token', (e) => {
    const data = JSON.parse(e.data);
    logToken(data.token);
  });

  es.addEventListener('planning_done', (e) => {
    const data = JSON.parse(e.data);
    resetTokenLine();
    logLine(`Planned ${data.scenes.length} scene(s):`, 'tag-plan');
    data.scenes.forEach((s, i) => logLine(`  ${i + 1}. ${s.prompt.slice(0, 70)}${s.prompt.length > 70 ? '...' : ''} (${s.durationSeconds}s)`, 'tag-scene'));
    setupSceneTracker(data.scenes.length);
  });

  es.addEventListener('scene_start', (e) => {
    const data = JSON.parse(e.data);
    loaderPhase.innerText = data.total > 1 ? `Rendering scene ${data.index + 1}/${data.total}` : 'Rendering video...';
    logLine(`Scene ${data.index + 1}/${data.total} started`, 'tag-scene');
    updateSceneDots(data.index, data.total, false);
  });

  es.addEventListener('comfy_queued', (e) => {
    const data = JSON.parse(e.data);
    logLine(`Queued on ComfyUI (prompt ${data.promptId.slice(0, 8)}...)`, 'tag-node');
  });

  es.addEventListener('comfy_node', (e) => {
    const data = JSON.parse(e.data);
    if (data.node) logLine(`Executing node ${data.node}`, 'tag-node');
  });

  es.addEventListener('comfy_progress', (e) => {
    const data = JSON.parse(e.data);
    loaderProgress.innerText = `Step ${data.value}/${data.max}`;
  });

  es.addEventListener('comfy_cached', (e) => {
    const data = JSON.parse(e.data);
    if (data.nodes && data.nodes.length) logLine(`Cached: ${data.nodes.join(', ')}`, 'tag-node');
  });

  es.addEventListener('scene_done', (e) => {
    const data = JSON.parse(e.data);
    logLine(`Scene ${data.index + 1} complete — ${data.filename}`, 'tag-scene');
  });

  es.addEventListener('scene_error', (e) => {
    const data = JSON.parse(e.data);
    logLine(`Scene ${data.index + 1} failed: ${data.error}`, 'tag-error');
  });

  es.addEventListener('merging_start', (e) => {
    const data = JSON.parse(e.data);
    loaderPhase.innerText = 'Compiling final cut...';
    logLine(`Merging ${data.sceneCount} scene(s)...`, 'tag-plan');
    updateSceneDots(data.sceneCount, data.sceneCount, true);
  });

  es.addEventListener('merging_done', () => {
    logLine('Merge complete.', 'tag-plan');
  });

  es.addEventListener('done', (e) => {
    const data = JSON.parse(e.data);
    logLine('Generation complete.', 'tag-plan');
    liveLogDot.style.display = 'none';
    stopStatusPolling();
    es.close();
    currentEventSource = null;
    showResult(data.result);
  });

  es.addEventListener('error', (e) => {
    let message = 'Connection to live stream lost.';
    try {
      const data = JSON.parse(e.data);
      if (data && data.error) message = data.error;
    } catch {
      // Transport-level error, no payload — status polling (already
      // running) will pick up completion/failure independently.
    }
    logLine(`Error: ${message}`, 'tag-error');
    loaderPhase.innerText = 'Generation failed';
    liveLogDot.style.display = 'none';
  });
}

// ── Poll fallback (status/result), in case SSE drops ──────────────────
function startStatusPolling(jobId) {
  stopStatusPolling();
  currentStatusPollTimer = setInterval(async () => {
    try {
      const res = await fetch(`/api/video/status/${jobId}`);
      const job = await res.json();
      if (!job || job.status === 'unknown') return;

      // job.progress is 0-100 already — do NOT multiply by 100 again.
      const pct = Math.max(0, Math.min(100, Math.round(job.progress)));
      progressBar.style.width = `${pct}%`;
      loaderProgress.innerText = `${pct}% · ${(job.status || '').toUpperCase()}`;

      if (job.status === 'completed') {
        stopStatusPolling();
        if (!currentEventSource) {
          const resultRes = await fetch(`/api/video/result/${jobId}`);
          const result = await resultRes.json();
          showResult(result);
        }
      } else if (job.status === 'failed') {
        stopStatusPolling();
        logLine(`Error: ${job.error || 'Generation failed.'}`, 'tag-error');
        loaderPhase.innerText = 'Generation failed';
      }
    } catch (err) {
      console.error('Status poll failed:', err);
    }
  }, 1500);
}

function stopStatusPolling() {
  if (currentStatusPollTimer) {
    clearInterval(currentStatusPollTimer);
    currentStatusPollTimer = null;
  }
}

// ── Result ────────────────────────────────────────────────────────────
function showResult(result) {
  progressBar.style.width = '100%';
  loaderOverlay.style.display = 'none';
  resultVideo.style.display = 'block';
  resultVideo.src = result.videoUrl;
  resultVideo.muted = false;
  resultVideo.play().catch((e) => console.log('Autoplay blocked:', e));

  resultActions.classList.remove('hidden');
  sceneTracker.classList.add('hidden');

  const downloadBtn = document.getElementById('btnDownload');
  downloadBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = result.videoUrl;
    a.download = result.videoUrl.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
}

window.resetView = () => {
  genView.style.display = 'none';
  emptyView.style.display = 'block';
  resultVideo.pause();

  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  stopStatusPolling();
  currentJobId = null;

  composerIsland.style.transform = 'translateX(-50%) translateY(0)';
  composerIsland.style.opacity = '1';
  promptInput.value = '';
  promptInput.focus();
};

document.getElementById('btnReuse').addEventListener('click', () => {
  const savedPrompt = config.prompt;
  resetView();
  promptInput.value = savedPrompt;
});

// ── Gallery: real data from the DB ───────────────────────────────────
async function loadGallery() {
  const grid = document.getElementById('galleryGrid');
  grid.innerHTML = '<div class="gallery-empty">Loading...</div>';

  try {
    const res = await fetch('/api/video/list');
    const data = await res.json();

    if (!data.success || !data.videos || data.videos.length === 0) {
      grid.innerHTML = '<div class="gallery-empty">No videos yet. Generate your first one!</div>';
      return;
    }

    grid.innerHTML = '';
    const inspireGrid = document.querySelector('.inspire-grid');
      if (inspireGrid) inspireGrid.innerHTML = '';
      
      data.videos.forEach((video, index) => {
        grid.appendChild(buildGalleryItem(video));
        
        if (inspireGrid && index < 4) {
          const inspireItem = document.createElement('div');
          inspireItem.className = 'inspire-card';
          inspireItem.style.animationDelay = `${index * 0.1}s`;
          
          const inspireVid = document.createElement('video');
          const fps = video.fps || 24;
          const tenthFrameTime = (10 / fps).toFixed(3);
          inspireVid.src = `${video.videoUrl}#t=${tenthFrameTime}`;
          inspireVid.muted = true;
          inspireVid.loop = true;
          inspireVid.playsInline = true;
          inspireVid.preload = 'metadata';
          
          inspireItem.addEventListener('mouseenter', () => {
            inspireVid.currentTime = 0;
            inspireVid.play().catch(() => {});
          });
          inspireItem.addEventListener('mouseleave', () => {
            inspireVid.pause();
            inspireVid.currentTime = tenthFrameTime;
          });
          
          const title = document.createElement('span');
          title.className = 'inspire-badge';
          title.style.zIndex = '1';
          title.textContent = video.prompt ? (video.prompt.split(' ').slice(0, 3).join(' ') + '...') : 'Generated Video';
          
          inspireItem.appendChild(inspireVid);
          inspireItem.appendChild(title);
          
          inspireItem.addEventListener('click', () => openVideoModal(video));
          
          inspireGrid.appendChild(inspireItem);
        }
      });
  } catch (err) {
    grid.innerHTML = '<div class="gallery-empty">Failed to load gallery.</div>';
    console.error('Gallery load failed:', err);
  }
}

function buildGalleryItem(video) {
  const item = document.createElement('div');
  item.className = 'g-item';
  item.dataset.id = video.id;

  const videoEl = document.createElement('video');
    
    // Use media fragment to set the 10th frame as the static thumbnail
    const fps = video.fps || 24;
    const tenthFrameTime = (10 / fps).toFixed(3);
    videoEl.src = `${video.videoUrl}#t=${tenthFrameTime}`;
    
    videoEl.muted = true;
    videoEl.loop = true;
    videoEl.playsInline = true;
    videoEl.preload = 'metadata';
    
    videoEl.addEventListener('mouseenter', () => {
      videoEl.currentTime = 0; // start playing from the beginning on hover
      videoEl.play().catch(() => {});
    });
    videoEl.addEventListener('mouseleave', () => {
      videoEl.pause();
      videoEl.currentTime = tenthFrameTime; // snap back to 10th frame thumbnail
    });

  const meta = document.createElement('div');
  meta.className = 'g-meta';
  const duration = video.durationSeconds ? `${Math.round(video.durationSeconds)}s` : '';
  meta.textContent = `${duration} · ${(video.format || 'mp4').toUpperCase()}`;

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'g-delete';
  deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>';
  deleteBtn.title = 'Delete';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('Delete this video? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/video/${video.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        item.remove();
        if (document.getElementById('galleryGrid').children.length === 0) {
          document.getElementById('galleryGrid').innerHTML = '<div class="gallery-empty">No videos yet. Generate your first one!</div>';
        }
      } else {
        alert(data.error || 'Delete failed.');
      }
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  });

  item.addEventListener('click', () => openVideoModal(video));

  item.appendChild(videoEl);
  item.appendChild(meta);
  item.appendChild(deleteBtn);
  return item;
}

// Clicking a gallery item restores every stored setting — not just the
// prompt — since the whole point of storing full rows was so nothing is
// lost on reload/reuse.
function reuseVideoSettings(video) {
  galleryPanel.classList.remove('open');
  resetView();

  promptInput.value = video.prompt || '';
  negPromptInput.value = video.negativePrompt || '';
  config.prompt = video.prompt || '';
  config.negative = video.negativePrompt || '';

  if (video.resolution) {
    const [w, h] = video.resolution.split('x').map(Number);
    const customBlock = document.getElementById('customResBlock');

    if (w === 768 && h === 512) config.aspect = '16:9';
    else if (w === 512 && h === 768) config.aspect = '9:16';
    else if (w === 576 && h === 576) config.aspect = '1:1';
    else {
      // Doesn't match any preset exactly — it was a custom resolution.
      config.aspect = 'custom';
      config.customWidth = w;
      config.customHeight = h;
      document.getElementById('customWidth').value = w;
      document.getElementById('customHeight').value = h;
      customBlock.classList.remove('hidden');
    }

    if (config.aspect !== 'custom') customBlock.classList.add('hidden');
    document.getElementById('aspectSelect').value = config.aspect;
  }

  if (video.durationSeconds) {
    config.duration = Math.round(video.durationSeconds);
    document.getElementById('sliderDuration').value = config.duration;
    document.getElementById('valDuration').innerText = config.duration + 's';
    checkSceneLogic();
  }

  if (video.fps) {
    config.fps = video.fps;
    document.getElementById('fpsSelect').value = String(video.fps);
  }

  if (video.steps) {
    config.steps = video.steps;
    document.getElementById('sliderSteps').value = video.steps;
    document.getElementById('valSteps').innerText = video.steps;
  }

  if (video.cfg) {
    config.cfg = video.cfg;
    document.getElementById('sliderCfg').value = video.cfg;
    document.getElementById('valCfg').innerText = Number(video.cfg).toFixed(1);
  }

  if (video.seed) {
    config.seed = video.seed;
    document.getElementById('seedInput').value = video.seed;
  }

  if (video.format) {
    config.format = video.format;
    formatBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-val') === video.format));
  }

  if (video.sceneCount && video.sceneCount > 1) {
    config.planMode = 'manual';
    config.sceneCount = video.sceneCount;
    document.getElementById('planModeSelect').value = 'manual';
    document.getElementById('sliderScenes').value = video.sceneCount;
    document.getElementById('valScenes').innerText = video.sceneCount;
    document.getElementById('manualSceneConfig').classList.remove('hidden');
    document.getElementById('autoSceneConfig').classList.add('hidden');
  }

  promptInput.focus();
}

loadGallery();

/* ==========================================================================
   VIDEO DETAILS MODAL
   ========================================================================== */
const videoModalOverlay = document.getElementById('videoModalOverlay');
const videoModalPlayer = document.getElementById('videoModalPlayer');
const videoModalDownload = document.getElementById('videoModalDownload');
const videoModalClose = document.getElementById('videoModalClose');
const videoModalReuseBtn = document.getElementById('videoModalReuseBtn');

function openVideoModal(video) {
  videoModalPlayer.src = video.videoUrl;
  videoModalDownload.href = video.videoUrl;
  
  document.getElementById('vModalPrompt').textContent = video.prompt || 'No prompt specified';
  document.getElementById('vModalNegative').textContent = video.negativePrompt || 'None';
  document.getElementById('vModalModel').textContent = video.modelUsed || 'N/A';
  document.getElementById('vModalRes').textContent = video.resolution || 'N/A';
  document.getElementById('vModalSteps').textContent = video.steps || 'N/A';
  document.getElementById('vModalCFG').textContent = video.cfg || 'N/A';
  document.getElementById('vModalSeed').textContent = video.seed != null ? video.seed : 'Random';
  
  const dur = video.durationSeconds ? Math.round(video.durationSeconds) + 's' : 'N/A';
  document.getElementById('vModalDuration').textContent = dur;
  
  document.getElementById('vModalFPS').textContent = video.fps ? video.fps + ' fps' : 'N/A';
  document.getElementById('vModalFormat').textContent = video.format ? video.format.toUpperCase() : 'MP4';
  
  const genTime = video.generationTime ? Math.round(video.generationTime) + 's' : 'N/A';
  document.getElementById('vModalGenTime').textContent = genTime;
  
  videoModalReuseBtn.onclick = () => {
    reuseVideoSettings(video);
    closeVideoModal();
  };
  
  videoModalOverlay.classList.remove('hidden');
  videoModalPlayer.play().catch(e => console.warn('Autoplay prevented:', e));
}

function closeVideoModal() {
  videoModalOverlay.classList.add('hidden');
  videoModalPlayer.pause();
  videoModalPlayer.src = '';
}

videoModalClose?.addEventListener('click', closeVideoModal);
videoModalOverlay?.addEventListener('click', (e) => {
  if (e.target === videoModalOverlay) closeVideoModal();
});

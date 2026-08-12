/* ===================== TRPC CLIENT ===================== */
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

/* ===================== DOM ELEMENTS ===================== */
const serverStateContainer = document.getElementById('serverStateContainer');
const topStatusBadge = document.getElementById('topStatusBadge');
const personaListEl = document.getElementById('personaList');
const personaVoiceSelect = document.getElementById('personaVoice');
const personaPrompt = document.getElementById('personaPrompt');
const promptCounter = document.getElementById('promptCounter');
const createPersonaForm = document.getElementById('createPersonaForm');
const btnCreatePersona = document.getElementById('btnCreatePersona');

/* ===================== STATE & POLLING ===================== */
let availableVoices = [];
let personas = [];
let setupStatus = null;
let serverStatus = null;
let pollingInterval = null;

async function init() {
  try {
    const [voices, pList, setup, server] = await Promise.all([
      trpcQuery('personaplex.voices'),
      trpcQuery('personaplex.personas.list'),
      trpcQuery('personaplex.setup.status'),
      trpcQuery('personaplex.server.status')
    ]);
    
    availableVoices = voices;
    personas = pList;
    setupStatus = setup;
    serverStatus = server;

    populateVoices();
    renderPersonas();
    renderServerState();
    startPollingIfNeeded();
  } catch (err) {
    console.error("Initialization failed:", err);
    serverStateContainer.innerHTML = `<div class="text-danger">Failed to connect to backend: ${err.message}</div>`;
  }
}

function startPollingIfNeeded() {
  if (pollingInterval) clearInterval(pollingInterval);
  
  const needsPolling = 
    (setupStatus && !setupStatus.installed && setupStatus.state !== 'not_started' && setupStatus.state !== 'error') ||
    (serverStatus && serverStatus.status === 'starting');
    
  if (needsPolling) {
    pollingInterval = setInterval(pollState, 2000);
  }
}

async function pollState() {
  try {
    if (!setupStatus.installed) {
      setupStatus = await trpcQuery('personaplex.setup.status');
    } else {
      serverStatus = await trpcQuery('personaplex.server.status');
    }
    renderServerState();
    if (
      (setupStatus.installed && (serverStatus.status === 'stopped' || serverStatus.status === 'running' || serverStatus.status === 'error')) ||
      (setupStatus.state === 'error' || setupStatus.state === 'ready')
    ) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  } catch (err) {
    console.error("Polling error:", err);
  }
}

/* ===================== UI RENDERERS ===================== */
function updateBadge(text, className) {
  topStatusBadge.textContent = text;
  topStatusBadge.className = `status-badge ${className}`;
}

function renderServerState() {
  if (!setupStatus) return;

  let html = '';

  // STATE: NOT INSTALLED
  if (!setupStatus.installed) {
    if (setupStatus.state === 'not_started') {
      updateBadge('Not Installed', 'badge-offline');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <p class="text-muted">PersonaPlex is a full-duplex speech model, not yet installed. Installation requires downloading model weights and setting up a Python environment.</p>
          <button class="action-btn primary" onclick="startSetup()" style="align-self: flex-start;">Install PersonaPlex</button>
        </div>
      `;
    } 
    else if (setupStatus.state === 'cloning' || setupStatus.state === 'installing') {
      updateBadge('Installing', 'badge-installing');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="status-dot" style="color: var(--color-warning); animation: pulse 1.5s infinite;"></div>
            <span class="text-muted">Installation in progress...</span>
          </div>
          ${renderLogConsole(setupStatus.log)}
        </div>
      `;
    }
    else if (setupStatus.state === 'error') {
      updateBadge('Setup Error', 'badge-error');
      const lastLines = setupStatus.log.slice(-10).join('\\n');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <p class="text-danger">Installation failed.</p>
          <div class="log-console" style="color: var(--color-danger); height: auto; max-height: 200px;">${escapeHtml(lastLines)}</div>
          <button class="action-btn" onclick="startSetup()" style="align-self: flex-start;">Retry Setup</button>
        </div>
      `;
    }
  } 
  // STATE: INSTALLED
  else {
    if (serverStatus.status === 'stopped') {
      updateBadge('Offline', 'badge-offline');
      html = `
        <div class="form-row" style="margin-bottom: 16px;">
          <label>Hugging Face Token</label>
          <input type="password" id="hfToken" class="form-input" placeholder="hf_...">
          <p class="text-muted" style="font-size: 0.8rem; margin-top: 4px;">Required for model download, only needed the first time.</p>
        </div>
        
        <div class="toggle-row">
          <div class="tr-info">
            <span class="tr-title">CPU Offload</span>
            <span class="tr-desc">Trades speed for lower VRAM usage. Leave off unless you hit an out-of-memory error.</span>
          </div>
          <label class="switch">
            <input type="checkbox" id="cpuOffload">
            <span class="slider"></span>
          </label>
        </div>
        
        <button class="action-btn primary" onclick="startServer()" style="margin-top: 16px;">Start PersonaPlex</button>
      `;
    }
    else if (serverStatus.status === 'starting') {
      updateBadge('Starting', 'badge-installing');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="status-dot" style="color: var(--color-warning); animation: pulse 1.5s infinite;"></div>
            <span class="text-muted">Starting model server (may download ~15GB of weights on first run)...</span>
          </div>
          ${renderLogConsole(serverStatus.log)}
          <button class="action-btn danger" onclick="stopServer()" style="align-self: flex-start;">Stop</button>
        </div>
      `;
    }
    else if (serverStatus.status === 'running') {
      updateBadge('Online', 'badge-running');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="status-dot" style="color: var(--nvidia-green);"></div>
            <span style="color: var(--nvidia-green);">PersonaPlex is running</span>
          </div>
          
          <div style="display: flex; gap: 12px; margin-top: 8px;">
            <a href="${serverStatus.url}" target="_blank" class="action-btn primary" style="text-decoration: none;">Open PersonaPlex WebUI ↗</a>
            <button class="action-btn danger" onclick="stopServer()">Stop Server</button>
          </div>
        </div>
      `;
    }
    else if (serverStatus.status === 'error') {
      updateBadge('Error', 'badge-error');
      html = `
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <p class="text-danger">Server encountered an error:</p>
          <div class="log-console" style="color: var(--color-danger); height: auto; max-height: 200px;">${escapeHtml(serverStatus.error || "Unknown error")}</div>
          <button class="action-btn" onclick="stopServer()" style="align-self: flex-start;">Reset State</button>
        </div>
      `;
    }
  }

  serverStateContainer.innerHTML = html;
  scrollToBottomOfLogs();
}

function renderLogConsole(logArray) {
  if (!logArray || logArray.length === 0) return '';
  const lines = logArray.slice(-100).map(line => `<div class="log-line">${escapeHtml(line)}</div>`).join('');
  return `<div class="log-console mono" id="activeLogConsole">${lines}</div>`;
}

function scrollToBottomOfLogs() {
  const consoleEl = document.getElementById('activeLogConsole');
  if (consoleEl) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}

/* ===================== ACTIONS ===================== */
window.startSetup = async function() {
  try {
    await trpcMutation('personaplex.setup.start');
    setupStatus.state = 'cloning';
    renderServerState();
    startPollingIfNeeded();
  } catch (err) {
    console.error("Failed to start setup:", err);
    alert("Error starting setup: " + err.message);
  }
};

window.startServer = async function() {
  const tokenInput = document.getElementById('hfToken');
  const cpuOffload = document.getElementById('cpuOffload')?.checked || false;
  const hfToken = tokenInput?.value?.trim() || undefined;

  try {
    await trpcMutation('personaplex.server.start', { cpuOffload, hfToken });
    serverStatus.status = 'starting';
    serverStatus.log = [];
    renderServerState();
    startPollingIfNeeded();
  } catch (err) {
    console.error("Failed to start server:", err);
    alert("Error starting server: " + err.message);
  }
};

window.stopServer = async function() {
  try {
    await trpcMutation('personaplex.server.stop');
    serverStatus.status = 'stopped';
    renderServerState();
    startPollingIfNeeded();
  } catch (err) {
    console.error("Failed to stop server:", err);
    alert("Error stopping server: " + err.message);
  }
};

/* ===================== PERSONA MANAGEMENT ===================== */
function populateVoices() {
  personaVoiceSelect.innerHTML = '<option value="" disabled selected>Select a voice...</option>';
  availableVoices.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    personaVoiceSelect.appendChild(opt);
  });
}

function renderPersonas() {
  if (personas.length === 0) {
    personaListEl.innerHTML = '<div class="text-muted" style="text-align: center; padding: 20px;">No personas created yet.</div>';
    return;
  }

  personaListEl.innerHTML = personas.map(p => {
    const voiceLabel = availableVoices.find(v => v.id === p.voiceId)?.label || p.voiceId;
    return `
      <div class="persona-card">
        <div class="pc-head">
          <div class="pc-title">
            <span class="pc-name">${escapeHtml(p.name)}</span>
            <span class="pc-voice">Voice: ${escapeHtml(voiceLabel)}</span>
          </div>
          <button class="btn-icon danger" onclick="deletePersona('${p.id}')" title="Delete Persona">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
        <div class="pc-prompt">${escapeHtml(p.systemPrompt)}</div>
      </div>
    `;
  }).join('');
}

window.deletePersona = async function(id) {
  if (!confirm("Are you sure you want to delete this persona?")) return;
  try {
    await trpcMutation('personaplex.personas.delete', { id });
    personas = personas.filter(p => p.id !== id);
    renderPersonas();
  } catch (err) {
    console.error("Failed to delete persona:", err);
    alert("Error deleting persona: " + err.message);
  }
};

createPersonaForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('personaName').value.trim();
  const voiceId = document.getElementById('personaVoice').value;
  const systemPrompt = document.getElementById('personaPrompt').value.trim();

  if (!name || !voiceId || !systemPrompt) return;

  btnCreatePersona.disabled = true;
  btnCreatePersona.textContent = 'Saving...';

  try {
    const newPersona = await trpcMutation('personaplex.personas.create', { name, voiceId, systemPrompt });
    personas.push(newPersona);
    renderPersonas();
    createPersonaForm.reset();
    promptCounter.textContent = '0';
  } catch (err) {
    console.error("Failed to create persona:", err);
    alert("Error creating persona: " + err.message);
  } finally {
    btnCreatePersona.disabled = false;
    btnCreatePersona.textContent = 'Save Persona';
  }
});

personaPrompt.addEventListener('input', () => {
  promptCounter.textContent = personaPrompt.value.length;
});

/* ===================== UTILS ===================== */
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Add simple CSS animation for pulse
const style = document.createElement('style');
style.innerHTML = `
  @keyframes pulse {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.9); }
    100% { opacity: 1; transform: scale(1); }
  }
`;
document.head.appendChild(style);

/* ===================== INIT ===================== */
init();

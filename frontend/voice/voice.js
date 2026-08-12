/**
 * Voice Studio Engine - n0th1ng AI
 * Modular Object-Oriented Architecture
 */

/* ===================== NAV & DRAWER ===================== */
const _drawer = document.getElementById('drawer');
if (_drawer) {
  const _burger = document.getElementById('burger');
  if (_burger) _burger.addEventListener('click', () => _drawer.classList.add('open'));
  const _drawerBg = _drawer.querySelector('.drawer-bg');
  if (_drawerBg) _drawerBg.addEventListener('click', () => _drawer.classList.remove('open'));
  _drawer.querySelectorAll('[data-close]').forEach(el =>
    el.addEventListener('click', () => _drawer.classList.remove('open'))
  );
}

let currentVoiceConversationId = null;

const THEMES = {
  IDLE:       [0, 212, 255],
  LISTENING:  [255, 51, 102],
  PROCESSING: [168, 85, 247],
  THINKING:   [168, 85, 247],
  GENERATING: [255, 140, 0],
  SPEAKING:   [80, 230, 140],
  ERROR:      [255, 140, 0]
};

/* Visual "stage" each engine state maps onto for the particle field.
   SCATTERED -> particles roam free across the frame (idle / recording)
   SPHERE    -> condensed sphere, sub-driven by THINKING vs GENERATING
   WAVE      -> sphere unrolls into the speaking waveform               */
const STAGE_BY_STATE = {
  IDLE:       "SCATTERED",
  LISTENING:  "SCATTERED",
  PROCESSING: "SPHERE",
  THINKING:   "SPHERE",
  GENERATING: "SPHERE",
  SPEAKING:   "WAVE",
  ERROR:      "SCATTERED",
};

/* ==========================================
   1. API BRIDGE
========================================== */
class VoiceApi {
  constructor() { this.base = "/api/speech"; }

  async request(endpoint, options = {}) {
    const response = await fetch(`${this.base}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async health()                      { return this.request("/health"); }
  async getProviders()                { return this.request("/providers"); }
  async getModels(provider)           { return this.request(`/models?provider=${provider}`); }
  async getVoices(provider, model)    { return this.request(`/voices?provider=${provider}&model=${model}`); }
  async getProfiles()                 { return this.request("/profiles"); }

  async saveProfile(profile) {
    return fetch(`${this.base}/profiles`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }).then(r => r.json());
  }

  async createConversation(data) {
    const res = await fetch("/api/voice/conversation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.json();
  }

  async loadConversation(id) {
      const response =
          await fetch(
              `/api/voice/conversation/${id}`
          );
      if (!response.ok) throw new Error("Failed to load conversation.");
      return response.json();
  }

  async renameConversation(id, title) {
      const res = await fetch(
          "/api/voice/conversation/rename",
          {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: id, title }),
          }
      );
      return res.json();
  }

  async synthesize(request) {
    const res = await fetch(`${this.base}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!res.ok) throw await res.json();
    return res.json();
  }

  async transcribe(formData) {
    const response = await fetch(`${this.base}/stt`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }

  async chatStream(payload, voiceConversation) {
    return fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async getLLMModels() {
    const response = await fetch("/api/trpc/model.list");
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    return {models: data?.result?.data?.json || []};
  }

  async saveMessage(data) {
      const res = await fetch(
          "/api/voice/message",
          {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body:JSON.stringify(data)
          }
      );
      return res.json();
  }

  async deleteConversation(id) {
      const res = await fetch(`/api/voice/conversation/${id}`, { method:"DELETE" });
      return res.json();
  }
}

/* ==========================================
   2. SETTINGS MANAGER
========================================== */
class SettingsManager {
  constructor(api) {
    this.api = api;
    this.settings = {
      mode: "tts", provider: "", model: "", voice: "", emotion: "neutral",
      speed: 1.0, pitch: 0.0, temperature: 0.7, volume: 100,
      noiseSuppression: true, echoCancellation: true, realtime: false, vad: true, stream: true,
    };
  }
  update(key, value) { this.settings[key] = value; }
  get(key)           { return this.settings[key]; }
  getAll()           { return this.settings; }
}

/* ==========================================
   3. DEVICE MANAGER
========================================== */
class DeviceManager {
  constructor(settings) {
    this.settings  = settings;
    this.micSelect     = document.getElementById("micSelect");
    this.speakerSelect = document.getElementById("speakerSelect");
    this.init();
  }

  async init() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.micSelect.innerHTML     = "";
      this.speakerSelect.innerHTML = "";
      let micCount = 0, spkCount = 0;
      devices.forEach(d => {
        if (d.kind === "audioinput")
          this.micSelect.appendChild(new Option(d.label || `Microphone ${++micCount}`, d.deviceId));
        else if (d.kind === "audiooutput")
          this.speakerSelect.appendChild(new Option(d.label || `Speaker ${++spkCount}`, d.deviceId));
      });
    } catch (e) {
      console.warn("Device enumeration restricted.", e);
    }
  }
}

/* ==========================================
   4. AUDIO ENGINE
========================================== */
class AudioEngine {
  constructor() {
    this.audio = null; this.audioContext = null; this.analyser = null; this.source = null;
    this.micSource   = null;
    this.onProgress  = null; this.onComplete = null; this.onStateChange = null;
    this.isPlaying   = false;
  }

  initAudioGraph() {
    if (this.audioContext) return;
    this.audioContext = new AudioContext();
    this.analyser     = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
  }

  connectMicrophone(stream) {
    this.initAudioGraph();
    if (this.micSource) { this.micSource.disconnect(); this.micSource = null; }
    this.micSource = this.audioContext.createMediaStreamSource(stream);
    if (!this.analyser) {
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
    }
    this.micSource.connect(this.analyser);
  }

  disconnectMicrophone() {
    if (this.micSource) { this.micSource.disconnect(); this.micSource = null; }
  }

  async playAudio(audioSource) {
    this.initAudioGraph();
    if (this.audioContext.state === "suspended") await this.audioContext.resume();

    // Each playAudio() call gets its own generation id so stale events
    // from a previous clip can never fire onComplete/onended for a newer
    // one.
    const playToken = ++this._playToken;

    // audioSource is either:
    //  - a base64 WAV string (single-shot TTS, and each realtime streamed
    //    sentence via AudioQueue) — turned into a Blob object URL below, same
    //    as before, or
    //  - a server-hosted URL like "/api/voice/audio/<id>" (a saved,
    //    concatenated full-response recording used for replay) — the
    //    <audio> element can just point straight at it, no fetch or
    //    base64 round-trip needed since it's same-origin.
    // Detected by shape rather than a separate flag so every existing call
    // site (which only ever passes base64) keeps working unchanged.
    const isServerUrl = typeof audioSource === "string" &&
      (audioSource.startsWith("/") || audioSource.startsWith("http://") || audioSource.startsWith("https://"));

    let url;
    let isBlobUrl = false;

    if (isServerUrl) {
      url = audioSource;
    } else {
      const binary = atob(audioSource);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const blob = new Blob([bytes], { type: "audio/wav" });
      url = URL.createObjectURL(blob);
      isBlobUrl = true;
    }

    const previousUrl      = this._currentUrl;
    const previousWasBlob  = this._currentUrlIsBlob;


    // Reuse a single <audio> element + MediaElementSource across segments
    // instead of creating a new one per call. Repeatedly creating a new
    // Audio()/createMediaElementSource() pair for every segment (several
    // per second in streaming voice mode) causes the browser to abort
    // in-flight play() calls with "AbortError: media was removed from the
    // document" as soon as the next element is created — which meant
    // _playNext()'s catch() treated every segment as instantly "failed"
    // and cascaded straight to the next one, cutting each sentence off
    // almost immediately after it started.
    if (!this.audio) {
      this.audio  = new Audio();
      this.source = this.audioContext.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    } else {
      this.audio.pause();
    }

    this._currentUrl       = url;
    this._currentUrlIsBlob = isBlobUrl;
    this.audio.src = url;

    this.isPlaying             = true;
    this.audio.ontimeupdate    = () => {
      if (playToken !== this._playToken) return;
      if (this.onProgress && this.audio.duration)
        this.onProgress(this.audio.currentTime / this.audio.duration);
    };
    this.audio.onplay   = () => { if (playToken !== this._playToken) return; this.isPlaying = true;  this.onStateChange?.("playing"); };
    this.audio.onpause  = () => { if (playToken !== this._playToken) return; this.isPlaying = false; this.onStateChange?.("paused"); };
    this.audio.onended  = () => {
      if (playToken !== this._playToken) return; // stale event from a superseded clip
      this.isPlaying = false;
      this.onComplete?.();
    };

    if (previousUrl && previousWasBlob) URL.revokeObjectURL(previousUrl);

    await this.audio.play();
  }

  stopAudio() {
    this._playToken = (this._playToken || 0) + 1;
    if (!this.audio) return;
    this.audio.pause(); this.audio.currentTime = 0;
    this.isPlaying = false;
  }

  getFrequencyData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }
}

/* ==========================================
   4b. AUDIO QUEUE (streaming speech pipeline)
   Plays speech segments in strict sequence order as they arrive,
   regardless of which synthesis task completes first.
   Each segment carries a `sequence` number assigned by the backend;
   the queue buffers out-of-order arrivals in `_pending` and only plays
   a segment when every earlier sequence has already been played.
========================================== */
class AudioQueue {
  constructor(audioEngine, onFirstPlay, onDrained) {
    this._engine      = audioEngine;
    this._onFirstPlay = onFirstPlay; // called once when the first segment starts
    this._onDrained   = onDrained;   // called when queue is empty AND stream has ended
    this._pending     = {};          // { sequence → base64Audio } for out-of-order arrivals
    this._nextSeq     = 0;           // the sequence number we expect to play next
    this._chain       = [];          // ordered list of base64 strings ready to play
    this._playing     = false;
    this._streamEnded = false;       // set to true when the NDJSON stream closes
    this._firstPlayed = false;
  }

  /** Enqueue a segment. May be called in any order. */
  push(sequence, base64Audio) {
    this._pending[sequence] = base64Audio;
    this._tryFlush();
  }

  /**
   * Signal that the NDJSON stream has ended and no more segments will arrive.
   * If the queue is already empty this immediately fires onDrained.
   */
  end() {
    this._streamEnded = true;
    this._tryDrain();
  }

  /** Drain contiguous ready segments from _pending into _chain, then play. */
  _tryFlush() {
    while (this._pending[this._nextSeq] !== undefined) {
      this._chain.push(this._pending[this._nextSeq]);
      delete this._pending[this._nextSeq];
      this._nextSeq++;
    }
    if (!this._playing && this._chain.length > 0) {
      this._playNext();
    }
  }

  _playNext() {
    if (this._chain.length === 0) {
      this._playing = false;
      this._tryDrain();
      return;
    }
    this._playing = true;
    const audio = this._chain.shift();

    if (!this._firstPlayed) {
      this._firstPlayed = true;
      this._onFirstPlay?.();
    }

    this._engine.onComplete = () => {
      this._playNext();
    };

    this._engine.playAudio(audio).catch(err => {
      console.error("[AudioQueue] playAudio failed:", err);
      // Skip this segment and continue with the rest.
      this._playNext();
    });
  }

  _tryDrain() {
    if (
      this._streamEnded &&
      !this._playing &&
      this._chain.length === 0 &&
      Object.keys(this._pending).length === 0
    ) {
      this._onDrained?.();
    }
  }
}

/* ==========================================
   5. HISTORY MANAGER
========================================== */
class HistoryManager {
  constructor(audioEngine) {
    this.container   = document.getElementById("historyList");
    this.audioEngine = audioEngine;
  }

  setActive(id) {
    document.querySelectorAll(".history-card").forEach(card => {
      card.classList.toggle("active", card.dataset.id === id);
    });
  }

  addCard(data) {
    const { mode, text, response, durationSecs, provider, model } = data;
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const card    = document.createElement("div");
    card.className  = "history-card glass-liquid";
    card.dataset.mode = mode;

    const responseHtml = response
      ? `<div class="ai-response"><b>AI:</b> ${marked.parse(response)}</div>`
      : "";

    card.innerHTML = `
      <div class="hc-header">
         <span class="hc-meta">${mode.toUpperCase()} • ${provider || "--"} • ${model || "--"}</span>
         <span class="hc-time">${timeStr} • 0:${Math.round(durationSecs || 0).toString().padStart(2, "0")}s</span>
      </div>
      <div class="hc-transcript">"${text}"</div>
      ${responseHtml}
      <div class="history-waveform-wrap"><canvas class="hw-canvas"></canvas></div>
      <div class="hc-actions">
         <button class="icon-text-btn play-btn">▶ Play</button>
         <button class="icon-text-btn">↓ Save</button>
         <button class="icon-text-btn del-btn" style="color:var(--fg-dim); margin-left:auto;">✕</button>
      </div>
    `;

    if (this.container) this.container.insertBefore(card, this.container.firstChild);

    const canvas = card.querySelector(".hw-canvas");
    const ctx    = canvas.getContext("2d");
    this.initWaveform(canvas, ctx);

    const playBtn = card.querySelector(".play-btn");
    playBtn.addEventListener("click", () => {
      if (this.audioEngine.isPlaying) {
        this.audioEngine.stopAudio();
        playBtn.innerHTML = "▶ Play";
      } else if (data.audioBuffer) {
        // Guard: don't hijack a live AudioQueue's onComplete callback if a
        // voice response is still streaming/speaking elsewhere — this
        // engine instance is shared, and overwriting onComplete here would
        // silently stall the live queue after this clip finishes.
        if (window.VoiceStudio?.generating) return;
        this.audioEngine.onComplete = () => (playBtn.innerHTML = "▶ Play");
        this.audioEngine.playAudio(data.audioBuffer);
        playBtn.innerHTML = "⏸ Pause";
      }
    });

    card.querySelector(".del-btn").addEventListener("click", () => card.remove());
  }

  initWaveform(canvas, ctx) {
    const dpr  = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = rect.width  * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    canvas.dataset.bars = JSON.stringify(Array.from({ length: 60 }, () => Math.random() * 0.8 + 0.2));
    this.drawWaveform(canvas, ctx, 0);
  }

  drawWaveform(canvas, ctx, progress) {
    const dpr  = window.devicePixelRatio || 1;
    const w    = canvas.width  / dpr;
    const h    = canvas.height / dpr;
    const bars = JSON.parse(canvas.dataset.bars);
    ctx.clearRect(0, 0, w, h);
    const barWidth = w / bars.length;
    bars.forEach((val, i) => {
      const barH    = val * h * 0.8;
      const x       = i * barWidth;
      const y       = (h - barH) / 2;
      const isPlayed = (x / w) <= progress;
      ctx.fillStyle = isPlayed ? "rgba(0,212,255, 0.8)" : "rgba(255,255,255,0.15)";
      ctx.beginPath();
      ctx.roundRect(x + 1, y, barWidth - 2, barH, 2);
      ctx.fill();
    });
  }
}

/* ==========================================
   6. 3D VISUALIZER (JARVIS UPGRADE)
========================================== */
class Visualizer {
  constructor(stateManager, audioEngine) {
    this.audioEngine = audioEngine;
    this.canvas      = document.getElementById("voiceCanvas");
    this.ctx         = this.canvas.getContext("2d", { alpha: true });
    this.stateMgr    = stateManager;

    this.cw = 0; this.ch = 0; this.cx = 0; this.cy = 0;
    this.dpr           = window.devicePixelRatio || 1;
    this.time          = 0;
    this.particles     = [];
    this.numParticles  = 500;
    this.waveLines     = 5;
    this.smoothedRadius = 100;
    this.morphFactor   = 0;
    this.formFactor    = 0; // 0 = fully scattered, 1 = fully formed sphere
    this.currentTheme  = [...THEMES.IDLE];

    this.init();
  }

  init() {
    this.resizeCanvas();
    window.addEventListener("resize", () => this.resizeCanvas());

    for (let i = 0; i < this.numParticles; i++) {
      const u = Math.random(), v = Math.random();
      // ~16% of particles never fully commit to the sphere — they stay
      // adrift in the frame even while "formed", per the brief.
      const isStraggler = Math.random() < 0.16;
      this.particles.push({
        // sphere-space placement
        phi: Math.acos(2 * v - 1), theta: 2 * Math.PI * u,
        // free-roam scatter placement (normalized -1..1 of frame, plus depth)
        scatterNX: (Math.random() - 0.5) * 2,
        scatterNY: (Math.random() - 0.5) * 2,
        scatterZ:  (Math.random() - 0.5) * 360,
        driftPhase: Math.random() * Math.PI * 2,
        driftSpeed: 0.15 + Math.random() * 0.35,
        driftRadius: 18 + Math.random() * 46,
        isStraggler,
        waveLine: i % this.waveLines,
        waveX:    (Math.random() - 0.5) * 800,
        size:     Math.random() * 2.0 + 0.5,
        offset:   Math.random() * Math.PI * 2,
        velocity: Math.random() * 0.02 + 0.01,
      });
    }
    this.draw();
  }

  resizeCanvas() {
    const p = this.canvas.parentElement;
    if (!p) return;
    const r  = p.getBoundingClientRect();
    this.cw  = r.width; this.ch = r.height;
    this.canvas.width  = this.cw * this.dpr;
    this.canvas.height = this.ch * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
    this.canvas.style.width  = `${this.cw}px`;
    this.canvas.style.height = `${this.ch}px`;
    this.cx = this.cw / 2;
    this.cy = this.ch / 2 - 40;
  }

  draw() {
    this.ctx.clearRect(0, 0, this.cw, this.ch);
    const state = this.stateMgr.currentState;
    const stage = STAGE_BY_STATE[state] || "SCATTERED";

    // Per-state energy: THINKING beats hard & slow, GENERATING spins fast.
    let speedMult = 1.0;
    if (state === "THINKING" || state === "PROCESSING") speedMult = 0.55;
    if (state === "GENERATING")                         speedMult = 3.4;
    this.time += 0.015 * speedMult;

    let waveAmp = 0;
    const fft = this.audioEngine.getFrequencyData();
    if (fft) {
      let sum = 0;
      for (let i = 0; i < fft.length; i++) sum += fft[i];
      waveAmp = (sum / fft.length) * 0.6;
    }

    let targetR = 100, targetMorph = 0, targetForm = 0;
    let sRotX   = this.time * 0.25, sRotY = this.time * 0.5;
    let targetColor = THEMES.IDLE;

    if (state === "LISTENING") {
      // Still scattered across the frame, just turned red & agitated.
      targetForm = 0; targetColor = THEMES.LISTENING;
    } else if (state === "THINKING" || state === "PROCESSING") {
      // Sphere formed, beating hard like a pulse.
      targetForm = 1; targetColor = THEMES.THINKING;
      targetR = 80 + Math.pow(Math.sin(this.time * 4), 2) * 40;
      sRotY = this.time * 0.5;
    } else if (state === "GENERATING") {
      // Sphere formed, spinning rapidly.
      targetForm = 1; targetColor = THEMES.GENERATING;
      targetR = 105 + Math.sin(this.time * 6) * 8;
      sRotY = this.time * 2.4; sRotX = this.time * 0.9;
    } else if (state === "SPEAKING") {
      // Sphere unrolls into the wave, green, driven by playback amplitude.
      targetForm = 1; targetMorph = 1; targetR = 150;
      targetColor = THEMES.SPEAKING;
    } else if (state === "ERROR") {
      targetForm = 0; targetColor = THEMES.ERROR;
    } else {
      // IDLE — fully scattered, gentle cyan drift.
      targetForm = 0; targetColor = THEMES.IDLE;
    }

    this.smoothedRadius += (targetR     - this.smoothedRadius) * 0.06;
    this.morphFactor    += (targetMorph - this.morphFactor)    * 0.08;
    this.formFactor      += (targetForm  - this.formFactor)     * 0.06;
    for (let i = 0; i < 3; i++)
      this.currentTheme[i] += (targetColor[i] - this.currentTheme[i]) * 0.05;

    document.documentElement.style.setProperty(
      "--theme-color-rgb",
      `${Math.round(this.currentTheme[0])}, ${Math.round(this.currentTheme[1])}, ${Math.round(this.currentTheme[2])}`
    );

    const rgbaTheme = `rgba(${this.currentTheme[0]}, ${this.currentTheme[1]}, ${this.currentTheme[2]}, `;
    this.ctx.globalCompositeOperation = "screen";

    // Core glow only really reads once the field has condensed some.
    const glowStrength = Math.max(this.formFactor, this.morphFactor);
    if (glowStrength > 0.02) {
      const coreGlow = this.ctx.createRadialGradient(
        this.cx, this.cy, 0,
        this.cx, this.cy, (this.smoothedRadius * 2.0 + this.morphFactor * 150) * glowStrength
      );
      coreGlow.addColorStop(0,   rgbaTheme + (0.3 * glowStrength) + ")");
      coreGlow.addColorStop(0.4, rgbaTheme + (0.1 * glowStrength) + ")");
      coreGlow.addColorStop(1,   rgbaTheme + "0)");
      this.ctx.fillStyle = coreGlow;
      this.ctx.beginPath();
      this.ctx.ellipse(
        this.cx, this.cy,
        (this.smoothedRadius * 2.0 + this.morphFactor * 250) * glowStrength,
        (this.smoothedRadius * 2.0) * glowStrength,
        0, 0, Math.PI * 2
      );
      this.ctx.fill();
    }

    this.ctx.fillStyle = rgbaTheme + "0.9)";
    this.particles.forEach(p => {
      // ---- Sphere-space position ----
      let sr = this.smoothedRadius;
      if (state !== "SPEAKING") sr += Math.sin(this.time * 5 + p.offset) * 5;

      let sx = sr * Math.sin(p.phi) * Math.cos(p.theta);
      let sy = sr * Math.sin(p.phi) * Math.sin(p.theta);
      let sz = sr * Math.cos(p.phi);

      let syRot  =  sy * Math.cos(sRotX) - sz * Math.sin(sRotX);
      let szRot1 =  sy * Math.sin(sRotX) + sz * Math.cos(sRotX);
      let sxRot  =  sx * Math.cos(sRotY) + szRot1 * Math.sin(sRotY);
      let szRot  = -sx * Math.sin(sRotY) + szRot1 * Math.cos(sRotY);

      // ---- Wave-space position (sphere -> speaking waveform) ----
      let fz  = (p.waveLine - 2) * 60;
      let fx  = p.waveX + Math.sin(this.time + p.offset) * 30;
      let wF  = Math.max(0, 1 - Math.pow(p.waveX / 400, 2));
      let fy  = Math.sin(p.waveX * 0.02 - this.time * 8 + p.waveLine) * waveAmp * wF;
          fy += Math.cos(p.waveX * 0.04 - this.time * 4) * (waveAmp * 0.5) * wF;

      const sphereX = sxRot, sphereY = syRot, sphereZ = szRot;
      const formedX = sphereX * (1 - this.morphFactor) + fx * this.morphFactor;
      const formedY = sphereY * (1 - this.morphFactor) + fy * this.morphFactor;
      const formedZ = sphereZ * (1 - this.morphFactor) + fz * this.morphFactor;

      // ---- Scattered-space position (idle / recording free-roam) ----
      const agitation = (state === "LISTENING") ? 1.6 : 1.0;
      const driftAngle = this.time * p.driftSpeed * agitation + p.driftPhase;
      const scatterX = p.scatterNX * (this.cw * 0.46) + Math.cos(driftAngle) * p.driftRadius * agitation;
      const scatterY = p.scatterNY * (this.ch * 0.46) + Math.sin(driftAngle * 1.3) * p.driftRadius * agitation;
      const scatterZ = p.scatterZ + Math.sin(driftAngle * 0.7) * 20;

      // Stragglers resist fully forming — cap their effective form blend.
      const particleForm = p.isStraggler ? Math.min(this.formFactor, 0.35) : this.formFactor;

      const finalX = scatterX * (1 - particleForm) + formedX * particleForm;
      const finalY = scatterY * (1 - particleForm) + formedY * particleForm;
      const finalZ = scatterZ * (1 - particleForm) + formedZ * particleForm;

      const scale = 400 / (400 + finalZ);
      const px    = this.cx + finalX * scale;
      const py    = this.cy + finalY * scale;

      this.ctx.globalAlpha = Math.max(0.05, Math.min(1, (finalZ + 220) / 440));
      this.ctx.beginPath();
      this.ctx.arc(px, py, p.size * scale, 0, Math.PI * 2);
      this.ctx.fill();
    });

    this.ctx.globalAlpha = 1.0;

    // Concentric rings only render once the sphere has meaningfully formed,
    // so the idle/recording scatter stays clean with no stray ring shape.
    if (this.formFactor > 0.05) {
      const ringAlpha = this.formFactor;
      for (let ring = 1; ring <= 4; ring++) {
        this.ctx.beginPath();
        const ringR = this.smoothedRadius + ring * 20;
        for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.05) {
          const cDist = Math.sin(a * 4 + this.time * ring) * 5;
          const cX    = this.cx + Math.cos(a) * (ringR + cDist);
          const cY    = this.cy + Math.sin(a) * (ringR + cDist);

          const wX  = this.cx + (a / Math.PI - 1) * 400;
          const wF  = Math.max(0, 1 - Math.pow((a / Math.PI - 1), 2));
          const wY  = this.cy + Math.sin(wX * 0.02 - this.time * 8 + ring) * waveAmp * wF;

          const x = cX * (1 - this.morphFactor) + wX * this.morphFactor;
          const y = cY * (1 - this.morphFactor) + wY * this.morphFactor;

          if (a === 0) this.ctx.moveTo(x, y);
          else         this.ctx.lineTo(x, y);
        }
        this.ctx.strokeStyle = rgbaTheme + ((0.4 - ring * 0.08) * ringAlpha) + ")";
        this.ctx.lineWidth   = 2.0 + this.morphFactor * 1.5;
        this.ctx.stroke();
      }
    }

    requestAnimationFrame(() => this.draw());
  }
}

/* ==========================================
   7. STATE MANAGER
========================================== */
class StateManager {
  constructor(ui) { this.ui = ui; this.currentState = "IDLE"; }
  setState(state, customText = "") {
    this.currentState = state;
    this.ui.onStateChange(state, customText);
  }
}

/* ==========================================
   8. MAIN UI CONTROLLER
========================================== */
class VoiceUI {
  constructor() {
    this.api          = new VoiceApi();
    this.settings     = new SettingsManager(this.api);
    this.devices      = new DeviceManager(this.settings);
    this.audio        = new AudioEngine();
    this.conversation = new VoiceConversation(this);
    this.history      = new HistoryManager(this.audio);
    this.stateMgr     = new StateManager(this);
    this.visualizer   = new Visualizer(this.stateMgr, this.audio);

    this.mediaRecorder    = null;
    this.recordedChunks   = [];
    this.mediaStream      = null;
    this.sttTimerInterval = null;
    this.sttStartTime     = 0;

    this.speechRecognition      = null;
    this.currentAbortController = null;

    this.bindDOM();
  }

  bindDOM() {
    // Mode Switching
    document.querySelectorAll(".mode-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
        e.target.classList.add("active");
        this.switchMode(e.target.dataset.mode);
      });
    });

    // Mobile Expand/Collapse Toggle
    const expandBtn = document.getElementById("toggleExpandBtn");
    const chatPanel = document.getElementById("chatOverlayPanel");

    if (expandBtn && chatPanel) {
        expandBtn.addEventListener("click", () => {
            chatPanel.classList.toggle("expanded");
            if (chatPanel.classList.contains("expanded")) {
                expandBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>`; 
            } else {
                expandBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"/></svg>`; 
            }
        });
    }

    // Settings Drawer Logic (Floating variant)
    const settingsBtn = document.getElementById("openSettingsBtn");
    const settingsPanel = document.getElementById("settingsPanel");
    const settingsBackdrop = document.getElementById("settingsBackdrop");
    const closeSettingsBtn = document.getElementById("closeSettingsBtn");

    const openSettings = () => {
      if(settingsPanel) settingsPanel.classList.add("open");
      if(settingsBackdrop) settingsBackdrop.classList.add("show");
    };
    const closeSettings = () => {
      if(settingsPanel) settingsPanel.classList.remove("open");
      if(settingsBackdrop) settingsBackdrop.classList.remove("show");
    };

    if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
    if (closeSettingsBtn) closeSettingsBtn.addEventListener("click", closeSettings);
    if (settingsBackdrop) settingsBackdrop.addEventListener("click", closeSettings);

    // Conversations Dropdown Logic
    const convBtn = document.getElementById("convDropdownBtn");
    const convMenu = document.getElementById("convDropdownMenu");
    
    if (convBtn && convMenu) {
        convBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            convMenu.classList.toggle("show");
        });
        document.addEventListener("click", (e) => {
            if (!convMenu.contains(e.target) && !convBtn.contains(e.target)) {
                convMenu.classList.remove("show");
            }
        });
    }

    document.getElementById("newVoiceChat")?.addEventListener("click", () => this.conversation.newConversation());

    // TTS Logic
    const ttsEditor = document.getElementById("ttsEditor");
    ttsEditor?.addEventListener("input", () => {
      const text     = ttsEditor.value;
      const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
      const elWord   = document.getElementById("ttsWordCount");
      const elTok    = document.getElementById("ttsEstTokens");
      if (elWord) elWord.textContent = wordCount;
      if (elTok)  elTok.textContent  = Math.ceil(text.length / 4);
    });

    document.getElementById("btnGenerateSpeech")?.addEventListener("click", () => this.startTTS());
    document.getElementById("btnClearText")?.addEventListener("click", () => {
      if (ttsEditor) { ttsEditor.value = ""; ttsEditor.dispatchEvent(new Event("input")); }
    });

    // STT Controls
    document.getElementById("btnStartRecord")?.addEventListener("click",  () => this.startRecording());
    document.getElementById("btnStopRecord")?.addEventListener("click",   () => this.stopRecording());
    document.getElementById("btnPauseRecord")?.addEventListener("click",  () => this.pauseRecording());

    document.getElementById("btnCopySTT")?.addEventListener("click", () => {
      const text = document.getElementById("sttTranscriptOutput")?.textContent || "";
      navigator.clipboard.writeText(text);
      this.showToast("Copied to clipboard");
    });

    document.getElementById("btnDownloadSTT")?.addEventListener("click", () => {
      const text = document.getElementById("sttTranscriptOutput")?.textContent || "";
      const blob = new Blob([text], { type: "text/plain" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `transcript-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById("btnSendToChatspace")?.addEventListener("click", () => {
      const text = document.getElementById("sttTranscriptOutput")?.textContent || "";
      if (text.trim()) {
        sessionStorage.setItem("voiceStudioTransfer", text.trim());
        window.location.href = "../chatspace/index.html";
      }
    });

    // Audio Upload
    document.getElementById("uploadAudioBtn")?.addEventListener("click", () => {
      document.getElementById("audioUploadInput")?.click();
    });
    document.getElementById("audioUploadInput")?.addEventListener("change", e => {
      if (e.target.files?.[0]) this.handleAudioUpload(e.target.files[0]);
    });

    // Voice Chat Input (STS)
    document.getElementById("btnSendVoicePrompt")?.addEventListener("click", () => {
      const input = document.getElementById("voicePromptInput");
      if (input?.value.trim()) {
        this.conversation.send(input.value.trim());
        input.value = "";
      }
    });
    document.getElementById("voicePromptInput")?.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        document.getElementById("btnSendVoicePrompt")?.click();
      }
    });

    document.getElementById("dockMic")?.addEventListener("click",  () => this.startVoiceInput());
    document.getElementById("dockStop")?.addEventListener("click", () => this.stopGeneration());

    // Settings Drawer Record / Stop (General fallback)
    document.getElementById("recordBtn")?.addEventListener("click", () => {
      const mode = this.settings.get("mode");
      if (mode === "stt") {
        if (this.mediaRecorder && this.mediaRecorder.state === "recording") this.stopRecording();
        else this.startRecording();
      } else if (mode === "sts") {
        this.startVoiceInput();
      }
    });
    document.getElementById("stopBtn")?.addEventListener("click", () => this.stopGeneration());

    // Save Profile
    document.getElementById("btnSaveProfile")?.addEventListener("click", () => {
      this.api.saveProfile(this.settings.getAll()).then(() => this.showToast("Profile Saved"));
    });

    // Sliders & Selects
    ["speed", "pitch", "temp", "vol"].forEach(k => {
      const slider = document.getElementById(`${k}Slider`);
      const val    = document.getElementById(`${k}Val`);
      if (slider) slider.addEventListener("input", e => {
        if (val) val.textContent = e.target.value + (k === "speed" ? "x" : k === "vol" ? "%" : "");
        this.settings.update(`${k}Slider`, e.target.value);
      });
    });

    // voiceSelect / modelSelect / emotionSelect — simple save
    ["voiceSelect", "modelSelect", "emotionSelect"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", e => this.settings.update(id, e.target.value));
    });

    // providerSelect — cascade: reload models → reload voices
    const providerEl = document.getElementById("providerSelect");
    if (providerEl) {
      providerEl.addEventListener("change", async (e) => {
        const providerId = e.target.value;
        this.settings.update("providerSelect", providerId);
        await this.reloadModels(providerId);
        // HUD update
        const providerName = providerEl.options[providerEl.selectedIndex]?.text || providerId;
        this.updateHUD({ provider: providerName, model: document.getElementById("modelSelect")?.options[0]?.text || "--", gpu: "RTX 4050", latency: "--" });
      });
    }

    // modelSelect — cascade: reload voices for selected provider+model
    const modelEl = document.getElementById("modelSelect");
    if (modelEl) {
      modelEl.addEventListener("change", async (e) => {
        const modelId = e.target.value;
        this.settings.update("modelSelect", modelId);
        const providerId = this.settings.get("providerSelect");
        if (providerId) await this.reloadVoices(providerId, modelId);
      });
    }

    const toggleMap = {
      noiseSuppressionToggle: "noiseSuppression",
      echoCancellationToggle: "echoCancellation",
      realtimeToggle:         "realtime",
      vadToggle:              "vad",
      streamToggle:           "stream",
    };
    Object.entries(toggleMap).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", e => this.settings.update(key, e.target.checked));
    });
  }

  refreshButtons() {
    const mic      = document.getElementById("dockMic");
    const stop     = document.getElementById("dockStop");
    const send     = document.getElementById("btnSendVoicePrompt");
    const input    = document.getElementById("voicePromptInput");

    if (this.stateMgr.currentState === "IDLE") {
        if (send) send.classList.remove("hidden");
        if (stop) stop.classList.add("hidden");
        if (mic)  mic.classList.remove("hidden");
        if (input) input.disabled = false;
    } else if (this.stateMgr.currentState === "LISTENING") {
        if (send) send.classList.add("hidden");
        if (stop) stop.classList.remove("hidden");
        if (input) input.disabled = true;
    } else {
        if (send) send.classList.add("hidden");
        if (stop) stop.classList.remove("hidden");
        if (mic)  mic.classList.add("hidden");
        if (input) input.disabled = true;
    }
  }

  switchMode(newMode) {
    this.settings.update("mode", newMode);
    const views = document.querySelectorAll(".workspace-view");
    views.forEach(v => v.classList.remove("active", "hidden"));

    setTimeout(() => {
      views.forEach(v => { if (v.id !== `view-${newMode}`) v.classList.add("hidden"); });
      const target = document.getElementById(`view-${newMode}`);
      if (target) target.classList.add("active");
    }, 50);

    const actionSection = document.getElementById("leftActionSection");
    if (actionSection) {
      if (newMode === "sts") actionSection.classList.add("hidden");
      else                   actionSection.classList.remove("hidden");
    }

    // Re-filter providers for the new mode, then reload models+voices
    if (this._allProviders) {
      this.filterProvidersByMode(newMode);
      const firstProviderId = document.getElementById("providerSelect")?.value;
      if (firstProviderId) this.reloadModels(firstProviderId);
    }

    this.stopGeneration();
    this.stateMgr.setState("IDLE");
    this.refreshButtons();
  }

  async initialize() {
    await this.loadConversationHistory();
    this.setConnectionState("STARTING");
    try {
      const health          = await this.api.health();
      const providersResult = await this.api.getProviders();
      this._allProviders    = providersResult.providers ?? [];

      if (!this._allProviders.length) throw new Error("No providers available");

      // Populate providers filtered for current mode (default: tts)
      this.filterProvidersByMode(this.settings.get("mode") || "tts");

      // Load models + voices for whichever provider is now selected
      const firstProviderId = document.getElementById("providerSelect")?.value || this._allProviders[0]?.id;
      if (firstProviderId) {
        await this.reloadModels(firstProviderId);
      }

      const emotionSelect = document.getElementById("emotionSelect");
      if (emotionSelect) {
        const emotions = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];
        emotionSelect.innerHTML = emotions.map(e => `<option value="${e}">${e.charAt(0).toUpperCase() + e.slice(1)}</option>`).join("");
        this.settings.update("emotionSelect", emotionSelect.value);
      }

      try {
        const llmModels = await this.api.getLLMModels();
        const openRouterModels = llmModels.models.filter(m => m.source === "openrouter");
        const ollamaModels = llmModels.models.filter(m => m.source === "ollama");

        const select = document.getElementById("llmModelSelect");
        if (select) {
          select.innerHTML = "";
          const renderGroup = (title, groupModels) => {
            if (!groupModels.length) return;
            const optgroup = document.createElement("optgroup");
            optgroup.label = title;
            groupModels.forEach(m => {
              const opt = document.createElement("option");
              opt.value = m.name;
              opt.textContent = m.displayName || m.name;
              optgroup.appendChild(opt);
            });
            select.appendChild(optgroup);
          };
          renderGroup("Open Router", openRouterModels);
          renderGroup("Ollama", ollamaModels);
        }
      } catch (e) {
        console.warn("Could not load LLM models:", e);
      }

      const providerEl = document.getElementById("providerSelect");
      const modelEl    = document.getElementById("modelSelect");
      this.updateHUD({
        provider: providerEl?.options[providerEl.selectedIndex]?.text || "--",
        model:    modelEl?.options[modelEl.selectedIndex]?.text || "--",
        gpu:      "RTX 4050",
        latency:  "14ms",
      });
      this.setConnectionState(health.overall === "healthy" ? "CONNECTED" : "CONNECTED");
    } catch (err) {
      console.error(err);
      this.setConnectionState("ERROR");
    }

    // The initial providers/models/voices load above only reflects whatever
    // workers were already registered (see cluster.ts registerWorker) at
    // the moment this page loaded. If the node server was started before a
    // worker came online, that worker's voices never made it into this
    // session because nothing re-fetches /api/speech/voices afterwards —
    // the backend (ProviderManager.listVoices) itself is always fresh per
    // request, but the client just never asks again. Poll in the background
    // so a worker registering later still shows up without a page reload.
    this.startVoiceListPolling();
  }

  /**
   * Periodically re-fetches the voice list for the currently selected
   * provider/model so voices from workers that register with the cluster
   * after this page has already loaded still appear. Selection is preserved
   * (see reloadVoices/populateSelect preserveSelection) so this doesn't
   * disrupt anything mid-use. Paused while the tab is hidden to avoid
   * pointless polling in background tabs.
   *
   * IMPORTANT: this only actively polls while there's nothing useful in the
   * voice dropdown yet (i.e. genuinely waiting on a worker to register).
   * Once voices are present, the loop stops firing network requests
   * entirely — a flat "poll forever regardless of state" loop was hitting
   * /api/speech/voices -> the worker -> speech-runtime -> the engine's own
   * /v1/voices every 15s for the lifetime of the tab, including mid-
   * generation, which measurably slowed down synthesis on that shared
   * process. Visibility changes and provider/model dropdown changes both
   * re-arm the check, so a newly-registered worker's voices still show up
   * without needing a page reload — this just stops the unconditional
   * background chatter once there's nothing left to wait for.
   */
  startVoiceListPolling(intervalMs = 15000) {
    if (this._voicePollTimer) return; // already running

    const tick = () => {
      if (document.hidden) return;

      const providerId = document.getElementById("providerSelect")?.value;
      const modelId    = document.getElementById("modelSelect")?.value;
      if (!providerId || !modelId) return;

      const voiceSelect = document.getElementById("voiceSelect");
      const hasVoices = !!voiceSelect && voiceSelect.options.length > 0;

      if (hasVoices) {
        // Nothing to wait for right now - stop polling until something
        // actually changes (provider/model switch, tab refocus).
        this.stopVoiceListPolling();
        return;
      }

      this.reloadVoices(providerId, modelId, /* preserveSelection */ true);
    };

    this._voicePollTimer = setInterval(tick, intervalMs);

    // Also refresh immediately whenever the tab regains focus/visibility —
    // covers the common case of starting the worker while the browser tab
    // with the node server's UI was already open in the background. This
    // also re-arms the poll loop if it had stopped itself above.
    if (!this._voiceVisibilityHandlerAttached) {
      this._voiceVisibilityHandlerAttached = true;
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        const providerId = document.getElementById("providerSelect")?.value;
        const modelId    = document.getElementById("modelSelect")?.value;
        if (providerId && modelId) this.reloadVoices(providerId, modelId, true);
        this.startVoiceListPolling(intervalMs);
      });
    }
  }

  stopVoiceListPolling() {
    if (this._voicePollTimer) {
      clearInterval(this._voicePollTimer);
      this._voicePollTimer = null;
    }
  }

  /** Filter the provider dropdown to only show providers relevant for the current mode */
  filterProvidersByMode(mode) {
    const providers = this._allProviders || [];
    let filtered;
    if (mode === "stt") {
      // STT mode: show stt + hybrid providers
      filtered = providers.filter(p => p.type === "stt" || p.type === "hybrid");
    } else if (mode === "tts") {
      // TTS mode: show tts + hybrid providers
      filtered = providers.filter(p => p.type === "tts" || p.type === "hybrid");
    } else {
      // STS (speech-to-speech): need both TTS output and STT input — show all
      filtered = providers.filter(p => p.type === "tts" || p.type === "hybrid");
    }
    // Fallback: if nothing matches (e.g. types not set), show all
    if (!filtered.length) filtered = providers;
    this.populateSelect("providerSelect", filtered.map(p => ({ id: p.id, name: p.name })));
  }

  /** Reload models dropdown for a given provider, then reload voices */
  async reloadModels(providerId) {
    try {
      const modelsResult = await this.api.getModels(providerId);
      const models = modelsResult.models ?? [];
      this.populateSelect("modelSelect", models.map(m => ({ id: m.id, name: m.name })));
      // Reload voices for the first model
      const firstModelId = models[0]?.id;
      if (firstModelId) await this.reloadVoices(providerId, firstModelId);
      else this.populateSelect("voiceSelect", []);
    } catch (err) {
      console.warn("[Voice] Failed to load models:", err);
      this.populateSelect("modelSelect", []);
      this.populateSelect("voiceSelect", []);
    }
  }

  /**
   * Builds the dropdown label for a voice, annotating it with where it's
   * available from — the backend already merged local + worker runtimes
   * (see providerManager.listVoices()); this only formats what it sent.
   *   Kerry Condon                                (no metadata / local-only, old shape)
   *   Kerry Condon (Local)
   *   Kerry Condon (Worker - AI-DESKTOP)
   *   Kerry Condon (Local + Worker - AI-DESKTOP)
   *   Kerry Condon (Worker - AI-DESKTOP, AI-SERVER)
   */
  formatVoiceLabel(voice) {
    const location = voice.location;
    if (!location) return voice.name; // backward compat: older/plain voice objects

    const hostnames = (voice.workers ?? []).map(w => w.hostname).join(", ");

    if (location === "local") return `${voice.name} (Local)`;
    if (location === "worker") return `${voice.name} (Worker - ${hostnames})`;
    if (location === "local+worker") return `${voice.name} (Local + Worker - ${hostnames})`;

    return voice.name;
  }

  /**
   * Reload voices dropdown for a given provider + model.
   * @param {boolean} preserveSelection - keep the currently selected voice
   *   selected if it's still present in the refreshed list. Used by the
   *   background poll (startVoiceListPolling) so a worker that comes online
   *   after page load doesn't yank the user's chosen voice out from under
   *   them; normal cascade reloads (provider/model change) leave this false
   *   so they default back to the first voice as before.
   */
  async reloadVoices(providerId, modelId, preserveSelection = false) {
    try {
      const voicesResult = await this.api.getVoices(providerId, modelId);
      const voices = voicesResult.voices ?? [];
      this.populateSelect(
        "voiceSelect",
        voices.map(v => ({ id: v.id, name: this.formatVoiceLabel(v) })),
        preserveSelection
      );
    } catch (err) {
      console.warn("[Voice] Failed to load voices:", err);
      if (!preserveSelection) this.populateSelect("voiceSelect", []);
      // On a background refresh failure, leave the existing list alone
      // rather than wiping it out from under the user.
    }
  }

  appendUserMessage(text) {
    const container = document.getElementById("voiceConversation");
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="message user">
         <div class="bubble user-bubble">${marked.parse(text)}</div>
       </div>`
    );
    const scrollArea = document.getElementById("voiceChatStream");
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  appendAssistantMessage(messageId = crypto.randomUUID()) {
    const container = document.getElementById("voiceConversation");

    container.insertAdjacentHTML(
      "beforeend",
      `<div class="message assistant" data-message-id="${messageId}">
         <div class="bubble assistant-bubble streaming"></div>
         <div class="assistant-actions">
           <button class="assistant-replay">Replay</button>
           <button class="assistant-copy">Copy</button>
         </div>
       </div>`
    );
    const scrollArea = document.getElementById("voiceChatStream");
    scrollArea.scrollTop = scrollArea.scrollHeight;

    const element   = container.querySelector(`[data-message-id="${messageId}"]`);
    const replayBtn = element.querySelector(".assistant-replay");
    const copyBtn   = element.querySelector(".assistant-copy");

    replayBtn.onclick = () => {
      const message = this.conversation.getMessage(messageId);
      if (!message?.speech?.audio) return;
      this.audio.playAudio(message.speech.audio);
    };

    copyBtn.onclick = () => {
      const message = this.conversation.getMessage(messageId);
      if (!message) return;
      navigator.clipboard.writeText(message.content);
    };

    replayBtn.style.display = "none";
    copyBtn.style.display   = "none";

    return messageId;
  }

  updateAssistantMessage(messageId, text) {
    const message = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!message) return;
    const bubble = message.querySelector(".assistant-bubble");
    if (!bubble) return;

    bubble.innerHTML = marked.parse(text);
    bubble.querySelectorAll("pre code").forEach(block => hljs.highlightElement(block));
    message.querySelector(".assistant-copy").style.display = "";
    
    const scrollArea = document.getElementById("voiceChatStream");
    scrollArea.scrollTop = scrollArea.scrollHeight;
  }

  finishAssistantMessage(messageId) {
    const bubble = document.querySelector(`[data-message-id="${messageId}"] .assistant-bubble`);
    if (bubble) bubble.classList.remove("streaming");
  }

  async loadConversationHistory() {
    const res           = await fetch("/api/voice/conversations");
    const conversations = await res.json();
    this.renderConversationSidebar(conversations);
  }

  async openConversation(id) {
      document.getElementById('convDropdownMenu')?.classList.remove('show');
      try {
        await this.conversation.load(id);
        this.conversationId = id;
        this.history.setActive(id);
        await this.loadConversationHistory();
      } catch (err) {
        console.error("Failed to open conversation:", err);
        this.showToast("Couldn't load that conversation");
      }
  }

  renderConversationSidebar(conversations) {
    const sidebar = document.getElementById("historyList");
    if (!sidebar) return;
    sidebar.innerHTML = "";
    
    conversations.forEach(conv => {
      const item       = document.createElement("div");
      item.dataset.id  = conv.id;
      item.className   = "history-card glass-liquid";
      
      // --- THE FIX IS HERE: Added the rename button and action wrapper ---
      item.innerHTML = `
      <div class="hc-header">
          <span class="conv-title-span" title="${this.escapeHTML(conv.title || "New Conversation")}">${this.escapeHTML(conv.title || "New Conversation")}</span>
          <div class="hc-header-actions">
              <button class="voice-history-rename" title="Rename Conversation">✎</button>
              <button class="voice-history-delete" title="Delete Conversation">✕</button>
          </div>
      </div>
      <div class="hc-transcript">${this.escapeHTML(conv.preview || "")}</div>
      `;

      // 1. Handle Delete
      const deleteBtn = item.querySelector(".voice-history-delete");
      deleteBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this conversation?")) return;
          await this.api.deleteConversation(conv.id);
          if (this.conversation.conversationId === conv.id) {
            await this.conversation.newConversation();
          }
          await this.loadConversationHistory();
      };

      // 2. Handle Rename
      const renameBtn = item.querySelector(".voice-history-rename");
      renameBtn.onclick = async (e) => {
          e.stopPropagation(); // Prevents clicking the card from opening it
          const newTitle = prompt("Enter new conversation name:", conv.title);
          if (newTitle && newTitle.trim() !== "" && newTitle !== conv.title) {
              const updatedTitle = newTitle.trim();
              await this.api.renameConversation(conv.id, updatedTitle);
              
              // Update the UI immediately
              item.querySelector(".conv-title-span").textContent = updatedTitle;
              conv.title = updatedTitle; 
              
              if (this.conversation.conversationId === conv.id) {
                  this.conversation.title = updatedTitle;
              }
          }
      };

      // 3. Handle Card Click (Load Conversation)
      item.onclick = async () => {
          await this.openConversation(conv.id);
          sidebar.querySelectorAll(".history-card").forEach(card => card.classList.remove("active"));
          item.classList.add("active");
      };

      // Set active state if it's the current conversation
      if (conv.id === this.conversation.conversationId) {
        item.classList.add("active");
      }
      
      sidebar.appendChild(item);
    });
  }

  // ================== STT MODE ==================

  async startRecording() {
    try {
      const constraints = {
        audio: {
          deviceId:          this.settings.get("micDevice") ? { exact: this.settings.get("micDevice") } : undefined,
          noiseSuppression:  this.settings.get("noiseSuppression"),
          echoCancellation:  this.settings.get("echoCancellation"),
        },
      };

      const stream     = await navigator.mediaDevices.getUserMedia(constraints);
      this.mediaStream = stream;
      this.audio.connectMicrophone(stream);

      this.mediaRecorder    = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      this.recordedChunks   = [];

      this.mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.recordedChunks, { type: "audio/webm" });
        this.handleSTTUpload(blob);
        this.audio.disconnectMicrophone();
        stream.getTracks().forEach(t => t.stop());
      };

      this.mediaRecorder.start(100);
      this.stateMgr.setState("LISTENING", "Recording...");
      this.refreshButtons();

      const ring      = document.getElementById("sttRecorderRing");
      const startBtn  = document.getElementById("btnStartRecord");
      const pauseBtn  = document.getElementById("btnPauseRecord");
      const stopBtn   = document.getElementById("btnStopRecord");
      const recordBtn = document.getElementById("recordBtn");
      const statusText = document.getElementById("sttStatusText");

      if (ring)      ring.classList.add("recording");
      if (startBtn)  startBtn.classList.add("hidden");
      if (pauseBtn)  pauseBtn.classList.remove("hidden");
      if (stopBtn)   stopBtn.classList.remove("hidden");
      if (recordBtn) recordBtn.classList.add("recording");
      if (statusText) statusText.textContent = "Recording...";

      this.sttStartTime = Date.now();
      const timerEl    = document.getElementById("sttTimer");
      if (timerEl) timerEl.dataset.elapsed = "0";

      this.sttTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - this.sttStartTime) / 1000);
        const mins    = Math.floor(elapsed / 60).toString().padStart(2, "0");
        const secs    = (elapsed % 60).toString().padStart(2, "0");
        if (timerEl) { timerEl.textContent = `${mins}:${secs}`; timerEl.dataset.elapsed = String(elapsed); }
      }, 1000);

    } catch (err) {
      console.error("Recording failed:", err);
      this.stateMgr.setState("ERROR", "Microphone access denied");
      this.refreshButtons();
    }
  }

  pauseRecording() {
    if (!this.mediaRecorder) return;
    const pauseBtn = document.getElementById("btnPauseRecord");
    const statusText = document.getElementById("sttStatusText");

    if (this.mediaRecorder.state === "recording") {
      this.mediaRecorder.pause();
      clearInterval(this.sttTimerInterval);
      if (pauseBtn) pauseBtn.textContent = "Resume";
      if (statusText) statusText.textContent = "Paused";
    } else if (this.mediaRecorder.state === "paused") {
      this.mediaRecorder.resume();
      const elapsed = parseInt(document.getElementById("sttTimer")?.dataset.elapsed || "0");
      this.sttStartTime = Date.now() - elapsed * 1000;
      this.sttTimerInterval = setInterval(() => {
        const newElapsed = Math.floor((Date.now() - this.sttStartTime) / 1000);
        const mins = Math.floor(newElapsed / 60).toString().padStart(2, "0");
        const secs = (newElapsed % 60).toString().padStart(2, "0");
        const timerEl = document.getElementById("sttTimer");
        if (timerEl) { timerEl.textContent = `${mins}:${secs}`; timerEl.dataset.elapsed = String(newElapsed); }
      }, 1000);
      if (pauseBtn) pauseBtn.textContent = "Pause";
      if (statusText) statusText.textContent = "Recording...";
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
    clearInterval(this.sttTimerInterval);
    this.stateMgr.setState("IDLE");
    this.refreshButtons();

    const ring      = document.getElementById("sttRecorderRing");
    const startBtn  = document.getElementById("btnStartRecord");
    const pauseBtn  = document.getElementById("btnPauseRecord");
    const stopBtn   = document.getElementById("btnStopRecord");
    const recordBtn = document.getElementById("recordBtn");
    const statusText = document.getElementById("sttStatusText");

    if (ring)      ring.classList.remove("recording");
    if (startBtn)  startBtn.classList.remove("hidden");
    if (pauseBtn)  { pauseBtn.classList.add("hidden"); pauseBtn.textContent = "Pause"; }
    if (stopBtn)   stopBtn.classList.add("hidden");
    if (recordBtn) recordBtn.classList.remove("recording");
    if (statusText) statusText.textContent = "Ready";
  }

  async handleSTTUpload(blob) {
    this.stateMgr.setState("PROCESSING", "Transcribing...");
    this.refreshButtons();

    const file     = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("audio", file);

    try {
      const result     = await this.api.transcribe(formData);
      const transcript = result.text || result.transcript || "";
      const output     = document.getElementById("sttTranscriptOutput");
      if (output) output.textContent = transcript;

      const ufName     = document.getElementById("ufName");
      const ufSize     = document.getElementById("ufSize");
      const ufDuration = document.getElementById("ufDuration");
      const ufInfo     = document.getElementById("uploadFileInfo");
      const elapsed    = parseInt(document.getElementById("sttTimer")?.dataset.elapsed || "0");

      if (ufName)     ufName.textContent     = file.name;
      if (ufSize)     ufSize.textContent     = (file.size / 1024).toFixed(1) + " KB";
      if (ufDuration) ufDuration.textContent = `0:${Math.round(elapsed).toString().padStart(2, "0")}`;
      if (ufInfo)     ufInfo.classList.remove("hidden");

      this.history.addCard({
        mode: "stt", text: transcript, response: null, durationSecs: elapsed,
        audioBuffer: null,
        provider: document.getElementById("providerSelect")?.options[document.getElementById("providerSelect").selectedIndex]?.text || "Local",
        model:    document.getElementById("modelSelect")?.options[document.getElementById("modelSelect").selectedIndex]?.text || "Whisper",
      });

      this.stateMgr.setState("IDLE");
      this.refreshButtons();
    } catch (err) {
      console.error("Transcription failed:", err);
      this.stateMgr.setState("ERROR", "Transcription failed");
      this.refreshButtons();
    }
  }

  async handleAudioUpload(file) {
    const ufName     = document.getElementById("ufName");
    const ufSize     = document.getElementById("ufSize");
    const ufDuration = document.getElementById("ufDuration");
    const ufInfo     = document.getElementById("uploadFileInfo");

    if (ufName)     ufName.textContent     = file.name;
    if (ufSize)     ufSize.textContent     = (file.size / 1024).toFixed(1) + " KB";
    if (ufDuration) ufDuration.textContent = "--:--";
    if (ufInfo)     ufInfo.classList.remove("hidden");

    const formData = new FormData();
    formData.append("audio", file);

    this.stateMgr.setState("PROCESSING", "Transcribing uploaded audio...");
    this.refreshButtons();
    try {
      const result     = await this.api.transcribe(formData);
      const transcript = result.text || result.transcript || "";
      const output     = document.getElementById("sttTranscriptOutput");
      if (output) output.textContent = transcript;

      this.history.addCard({
        mode: "stt", text: transcript, response: null, durationSecs: 0, audioBuffer: null,
        provider: document.getElementById("providerSelect")?.options[document.getElementById("providerSelect").selectedIndex]?.text || "Local",
        model:    document.getElementById("modelSelect")?.options[document.getElementById("modelSelect").selectedIndex]?.text || "Whisper",
      });

      this.stateMgr.setState("IDLE");
      this.refreshButtons();
    } catch (err) {
      console.error("Upload transcription failed:", err);
      this.stateMgr.setState("ERROR", "Transcription failed");
      this.refreshButtons();
    }
  }

  // ================== VOICE CHAT MODE (STS) ==================

  startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.showToast("Speech recognition not supported. Use text input.");
      return;
    }
    if (this.speechRecognition) { this.speechRecognition.stop(); return; }

    this.speechRecognition             = new SpeechRecognition();
    this.speechRecognition.continuous      = true;
    this.speechRecognition.interimResults  = true;
    this.speechRecognition.lang            = "en-US";

    let finalTranscript = "";

    this.speechRecognition.onstart = () => {
      this.stateMgr.setState("LISTENING", "Listening...");
      this.refreshButtons();
      const micBtn    = document.getElementById("dockMic");
      const recordBtn = document.getElementById("recordBtn");
      if (micBtn)    { micBtn.classList.add("active"); }
      if (recordBtn) recordBtn.classList.add("recording");
    };

    this.speechRecognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
        else                           interim          += event.results[i][0].transcript;
      }
      const input = document.getElementById("voicePromptInput");
      if (input) input.value = finalTranscript + interim;
    };

    this.speechRecognition.onerror = event => {
      console.error("Speech recognition error:", event.error);
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.stateMgr.setState("ERROR", event.error);
        this.refreshButtons();
      }
    };

    this.speechRecognition.onend = () => {
      const micBtn    = document.getElementById("dockMic");
      const recordBtn = document.getElementById("recordBtn");
      if (micBtn)    { micBtn.classList.remove("active"); }
      if (recordBtn) recordBtn.classList.remove("recording");

      if (finalTranscript.trim()) {
        const prompt         = finalTranscript.trim();
        const input = document.getElementById("voicePromptInput");
        if (input) input.value = "";
        this.speechRecognition = null;
        this.conversation.send(prompt);
      } else {
        this.speechRecognition = null;
        this.stateMgr.setState("IDLE");
        this.refreshButtons();
      }
    };

    this.speechRecognition.start();
  }

  // ================== TTS MODE ==================

  async startTTS() {
    try {
      const text = document.getElementById("ttsEditor")?.value.trim();
      if (!text) return;

      this.stateMgr.setState("GENERATING");
      this.refreshButtons();

      const response = await this.api.synthesize({
        text,
        // Use the current dropdown values directly for correct field names
        providerId:  document.getElementById("providerSelect")?.value || this.settings.get("providerSelect"),
        modelId:     document.getElementById("modelSelect")?.value    || this.settings.get("modelSelect"),
        voiceId:     document.getElementById("voiceSelect")?.value    || this.settings.get("voiceSelect"),
        speed:       parseFloat(this.settings.get("speedSlider") || 1.0),
        pitch:       parseFloat(this.settings.get("pitchSlider") || 0),
        volume:      parseFloat(this.settings.get("volSlider")   || 100) / 100,
        temperature: parseFloat(this.settings.get("tempSlider")  || 0.7),
        emotion:     this.settings.get("emotionSelect") || "neutral",
      });

      this.stateMgr.setState("SPEAKING");
      this.refreshButtons();

      this.audio.onComplete = () => {
        this.stateMgr.setState("IDLE");
        this.refreshButtons();
        this.history.addCard({
          mode: "tts", text, response: null,
          durationSecs: response.duration || 0,
          audioBuffer:  response.audio,
          provider: document.getElementById("providerSelect")?.options[document.getElementById("providerSelect").selectedIndex]?.text || "--",
          model:    document.getElementById("modelSelect")?.options[document.getElementById("modelSelect").selectedIndex]?.text || "--",
        });
      };
      await this.audio.playAudio(response.audio);
    } catch (err) {
      console.error(err);
      this.stateMgr.setState("ERROR", err.message || "TTS failed");
      this.refreshButtons();
      setTimeout(() => { this.stateMgr.setState("IDLE"); this.refreshButtons(); }, 1800);
    }
  }

  // ================== UTILS ==================

  stopGeneration() {
    this.audio.stopAudio();
    if (this.speechRecognition) { this.speechRecognition.stop(); this.speechRecognition = null; }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
    if (this.currentAbortController) { this.currentAbortController.abort(); this.currentAbortController = null; }
    this.stateMgr.setState("IDLE");
    this.refreshButtons();
  }

  populateSelect(id, items, preserveSelection = false) {
    const el = document.getElementById(id);
    if (!el) return;
    // preserveSelection: keep the current value selected (if it still exists
    // in the new options) instead of always snapping back to the first item.
    // Needed for periodic background refreshes (see startVoiceListPolling)
    // so a worker coming online mid-session doesn't reset the user's pick.
    const previousValue = preserveSelection ? el.value : null;
    el.innerHTML = items.map(i => `<option value="${i.id}">${i.name}</option>`).join("");
    if (previousValue && items.some(i => String(i.id) === previousValue)) {
      el.value = previousValue;
    }
    this.settings.update(id, el.value);
  }

  updateHUD({ provider, model, gpu, latency }) {
    const hudProvider = document.getElementById("hudProvider");
    const hudModel    = document.getElementById("hudModel");
    const hudGpu      = document.getElementById("hudGpu");
    const hudLatency  = document.getElementById("hudLatency");
    if (hudProvider) hudProvider.textContent = provider;
    if (hudModel)    hudModel.textContent    = model;
    if (hudGpu)      hudGpu.textContent      = gpu;
    if (hudLatency)  hudLatency.textContent  = latency;
  }

  setConnectionState(state) {
    const dot = document.getElementById("connDot");
    const txt = document.getElementById("connText");
    if (!dot || !txt) return;
    dot.className    = "status-dot";
    txt.textContent  = state;
    if      (state === "CONNECTED") dot.classList.add("connected");
    else if (state === "STARTING")  dot.classList.add("starting");
    else if (state === "ERROR")     dot.classList.add("error");
    else                            dot.classList.add("offline");
  }

  onStateChange(state, customText) {
    const visStatus = document.getElementById("visualizerStatus");
    const recText   = document.getElementById("recordStatusText");

    ["indListening", "indProcessing", "indThinking", "indGenerating", "indSpeaking", "indError"].forEach(id => {
      document.getElementById(id)?.classList.add("hidden");
    });

    if (state === "LISTENING") {
      if (recText)   recText.textContent   = customText || "Capturing Audio...";
      if (visStatus) { visStatus.textContent = "RECORDING";   visStatus.style.opacity = "1"; }
      document.getElementById("indListening")?.classList.remove("hidden");
    } else if (state === "THINKING" || state === "PROCESSING") {
      if (recText)   recText.textContent   = customText || "Processing Context...";
      if (visStatus) { visStatus.textContent = "COMPUTING";   visStatus.style.opacity = "1"; }
      document.getElementById("indProcessing")?.classList.remove("hidden");
      if (state === "THINKING") document.getElementById("indThinking")?.classList.remove("hidden");
    } else if (state === "GENERATING") {
      if (visStatus) { visStatus.textContent = "SYNTHESIZING"; visStatus.style.opacity = "1"; }
      document.getElementById("indGenerating")?.classList.remove("hidden");
    } else if (state === "SPEAKING") {
      if (recText)   recText.textContent   = customText || "Engine Active...";
      if (visStatus) { visStatus.textContent = "TRANSMITTING"; visStatus.style.opacity = "1"; }
      document.getElementById("indSpeaking")?.classList.remove("hidden");
    } else if (state === "ERROR") {
      if (recText)   recText.textContent   = customText || "Error Occurred.";
      if (visStatus) { visStatus.textContent = "ERROR";        visStatus.style.opacity = "1"; }
      document.getElementById("indError")?.classList.remove("hidden");
    } else {
      if (recText)   recText.textContent   = customText || "Ready to capture";
      if (visStatus) { visStatus.textContent = "IDLE";         visStatus.style.opacity = "0.3"; }
    }
  }

  escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, tag => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[tag] || tag));
  }

  showToast(message) {
    const toast = document.createElement("div");
    toast.textContent = message;
    toast.style.cssText = "position:fixed; bottom:24px; left:50%; transform:translateX(-50%); padding:8px 16px; background:rgba(0,0,0,0.8); border:1px solid rgba(255,255,255,0.1); border-radius:8px; font-size:0.85rem; color:var(--fg); z-index:10000; pointer-events:none; transition:opacity 0.3s;";
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 300); }, 2000);
    });
  }
}

/* ==========================================
   9. VOICE CONVERSATION
========================================== */
class VoiceConversation {
  constructor(ui) {
    this.ui             = ui;
    this.api            = ui.api;
    this.audio          = ui.audio;
    this.messages       = [];
    this.conversationId = null;
    this.generating     = false;
    this.abortController    = null;
    this.isStreaming        = false;
    this.isSpeaking         = false;
    this.isRecording        = false;
    this.currentAssistantMessage = null;
    this.id        = null;
    this.title     = "New Conversation";
    this.createdAt  = null;
    this.updatedAt  = null;
    this.model      = null;
  }

  async load(conversationId) {
    this.conversationId = conversationId;
    const data = await this.api.loadConversation(conversationId);
    console.log("Conversation");
    console.log(data.conversation);
    console.log("Messages");
    console.log(data.messages);
    const conversation = data.conversation;
    const messages = data.messages;
    this.messages = [];
    this.title = conversation.title;
    this.model = conversation.modelId;
    this.createdAt = conversation.createdAt;
    this.updatedAt = conversation.updatedAt;
    const container = document.getElementById( "voiceConversation" );
    if (container)
        container.innerHTML = "";
    for (const msg of messages) {
      console.log(msg.role, msg.content);
        const message = {
            ...msg,
            speech: {
                audio: msg.audio,
                providerId: msg.providerId,
                modelId: msg.speechModelId,
                voiceId: msg.voiceId,
                duration: msg.duration,
            }
        };
        this.messages.push(message);
        if (msg.role === "user") {
            this.ui.appendUserMessage( msg.content );
        } else {
            const id = this.ui.appendAssistantMessage(msg.id);
            this.ui.updateAssistantMessage( id, msg.content );
            this.ui.finishAssistantMessage( id );
            // appendAssistantMessage() hides replay by default and
            // updateAssistantMessage() no longer shows it unconditionally —
            // so reload needs to decide visibility itself, same as the live
            // streaming path does once fullAudio arrives.
            if (message.speech.audio) {
                const msgEl = document.querySelector(`[data-message-id="${id}"]`);
                msgEl?.querySelector(".assistant-replay")?.style.setProperty("display", "");
            }
        }
    }
    return data;
    console.log(messages);
  }

  newConversation() {
      this.conversationId = null;
      this.messages = [];
      const container = document.getElementById("voiceConversation");
      if (container)
          container.innerHTML = "";
      this.ui.stateMgr.setState(
          "IDLE"
      );
      this.ui.refreshButtons();
  }
  getMessage(id) {
    return this.messages.find(m => m.id === id || m.domId === id);
  }

  async send(text) {
    if (!text.trim() || this.generating) return;
    this.generating = true;
    this.ui.stateMgr.setState("THINKING", "Computing response...");
    this.ui.refreshButtons();
    try {
      if (!this.conversationId) {
        const conversation = await this.api.createConversation({
          title: text.substring(0, 60),
          model: document.getElementById("llmModelSelect").value,
          mode: "voice",
          providerId: document.getElementById("providerSelect").value,
          speechModelId: document.getElementById("modelSelect").value,
          voiceId: document.getElementById("voiceSelect").value,
      });
      this.conversationId = conversation.id;
      await this.ui.loadConversationHistory();
    }
      this.ui.appendUserMessage(text);
      this.messages.push({ role: "user", content: text, timestamp: Date.now() });
      await this.api.saveMessage({
      conversationId:this.conversationId,
      role:"user",
      content:text,
      providerId:null,
      speechModelId:null,
      voiceId:null,
      audio:null,
      duration:null
      });
      await this.stream(text);
      await this.ui.loadConversationHistory();

    } catch (err) {
      console.error("Voice send failed:", err);
      this.ui.stateMgr.setState("ERROR", "Something went wrong");
      this.ui.refreshButtons();
      setTimeout(() => { this.ui.stateMgr.setState("IDLE"); this.ui.refreshButtons(); }, 1800);
    } finally {
      this.generating = false;
    }
  }

  async stream(prompt) {
    const response = await this.api.chatStream({
      model: document.getElementById("llmModelSelect").value,
      prompt,
      conversationId: this.conversationId,
      mode: "voice",
      responseMode: "voice",
      useRag: false,
      uploadedAttachments: [],
      selectedKnowledgeFiles: [],
      // Send the current dropdown selection on every turn so switching
      // provider/model/voice mid-conversation takes effect immediately,
      // rather than only using the settings captured when the conversation
      // was first created.
      providerId: document.getElementById("providerSelect")?.value,
      speechModelId: document.getElementById("modelSelect")?.value,
      voiceId: document.getElementById("voiceSelect")?.value,
      // Modulation panel sliders — read live so changes apply on the
      // very next turn without needing to restart the conversation.
      speed:       parseFloat(this.ui.settings.get("speedSlider") ?? 1.0),
      pitch:       parseFloat(this.ui.settings.get("pitchSlider") ?? 0),
      temperature: parseFloat(this.ui.settings.get("tempSlider")  ?? 0.7),
      volume:      parseFloat(this.ui.settings.get("volSlider")   ?? 100) / 100,
    });

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => "");
      console.error(`[VOICE STREAM] request failed (${response.status}):`, errText);
      throw new Error(`Stream failed (${response.status})${errText ? `: ${errText}` : ""}`);
    }

    const messageId = this.ui.appendAssistantMessage();
    const reader    = response.body.getReader();
    const decoder   = new TextDecoder();
    let buffer = "";
    let answer = "";
    let tokenStats = {};
    // Populated once the backend finishes concatenating every streamed
    // sentence into one saved recording (see json.fullAudio handling in
    // processLine below). Stays null if that never arrives — a synthesis
    // failure on every sentence, or a save/concat error server-side — in
    // which case the replay button is simply left hidden, same as before.
    let fullAudioInfo = null;

    // ── Streaming Audio Queue ─────────────────────────────────────────────
    // Segments arrive mid-stream as { speech: { sequence, audio, ... } }
    // chunks.  AudioQueue buffers out-of-order arrivals and plays them in
    // strict sequence order.  A Promise is used to keep stream() alive
    // until the queue has fully drained after the NDJSON stream closes.
    let queueDrainResolve = null;
    const queueDrainPromise = new Promise(resolve => { queueDrainResolve = resolve; });

    const audioQueue = new AudioQueue(
      this.audio,
      // onFirstPlay — first segment is ready: transition to SPEAKING now,
      // while the LLM may still be generating later sentences.
      () => {
        this.ui.stateMgr.setState("SPEAKING");
        this.ui.refreshButtons();
      },
      // onDrained — all segments have finished playing.
      () => {
        queueDrainResolve();
      }
    );
    // ─────────────────────────────────────────────────────────────────────

    const processLine = async (line) => {
      if (!line.trim()) return;
      let json;
      try {
          json = JSON.parse(line);
      } catch {
          return;
      } 
      if (json.conversationId && !this.conversationId) {
          this.conversationId = json.conversationId;
      }
      if (json.status) {

    this.ui.stateMgr.setState(

        "THINKING",

        json.status

    );

    return;

}
      if (json.error) {
        // boot.ts can now send a structured error chunk mid-stream (Ollama
        // backend error, generate timeout, stall watchdog firing). Without
        // this branch it was silently dropped — no toast, no state change,
        // the UI just sat in THINKING forever with nothing to show for it.
        console.error("[VOICE STREAM] server error:", json.error);
        throw new Error("__VOICE_STREAM_SERVER_ERROR__" + json.error);
      }
      if (json.response) {
          answer += json.response;
          this.ui.updateAssistantMessage(
              messageId,
              answer
          );
          tokenStats = {
              prompt: json.promptTokens,
              completion: json.completionTokens,
              total: json.totalTokens,
              evalCount: json.evalCount,
              evalDuration: json.evalDuration,
          };
      }
      if (json.speech) {
          // Enqueue immediately — playback begins as soon as sequence 0 arrives,
          // without waiting for the full NDJSON stream to close.
          audioQueue.push(json.speech.sequence, json.speech.audio);
      }
      if (json.fullAudio) {
          // Sent once, after every streamed sentence has been synthesized
          // and stitched server-side into one continuous recording. Doesn't
          // affect realtime playback (already happening via audioQueue) —
          // this is purely what gets attached to the saved message so the
          // replay button has something to fetch later.
          fullAudioInfo = json.fullAudio;
      }
  };  

    const SERVER_ERROR_MARKER = "__VOICE_STREAM_SERVER_ERROR__";

    const safeProcessLine = async (line) => {
      try {
        await processLine(line);
      } catch (err) {
        if (err instanceof Error && err.message?.startsWith(SERVER_ERROR_MARKER)) {
          // Deliberate: re-throw server-reported errors (json.error) so
          // send()'s catch can set ERROR state and notify the user.
          throw new Error(err.message.slice(SERVER_ERROR_MARKER.length));
        }
        // Anything else (an unexpected line shape, a future new json.x
        // handler throwing) shouldn't kill an otherwise-working response —
        // log and keep going instead.
        console.error("[VOICE STREAM] processLine threw on line:", line, err);
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) { if (buffer.trim()) await safeProcessLine(buffer); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) await safeProcessLine(line);
    }

    // NDJSON stream is closed — signal the queue so it fires onDrained once
    // the last segment finishes playing.
    audioQueue.end();

    this.ui.finishAssistantMessage(messageId);
    this.ui.refreshButtons();

    if (!answer.trim()) {
      // No text was generated; resolve the drain promise immediately since
      // there are no audio segments to play.
      queueDrainResolve();
      return;
    }

    const assistantMessage = {
      id:        crypto.randomUUID(),
      role:      "assistant",
      content:   answer,
      timestamp: Date.now(),
      domId:     messageId,
      tokens:    tokenStats,
      speech: {
        // Populated once the backend has stitched every streamed sentence
        // into one continuous recording (see json.fullAudio handling in
        // processLine above). This is a URL (/api/voice/audio/:id), not a
        // base64 blob — playAudio() below fetches it on demand instead of
        // keeping the whole clip in memory/DB. Stays null only if every
        // sentence failed to synthesize or the save/concat step itself
        // failed server-side, in which case replay is correctly left
        // unavailable, same as before.
        audio:      fullAudioInfo?.url ?? null,
        providerId: document.getElementById("providerSelect").value,
        modelId:    document.getElementById("modelSelect").value,
        voiceId:    document.getElementById("voiceSelect").value,
        duration:   fullAudioInfo?.duration ?? null,
      },
    };
    this.messages.push(assistantMessage);

    // Show replay only if a recording actually got saved; hide it otherwise
    // (synthesis failed for every sentence, or the save/concat step itself
    // failed server-side). updateAssistantMessage() no longer shows this
    // button unconditionally on every streamed token, so this is the one
    // place that decides its final visibility for a live response.
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) {
      const replayBtn = msgEl.querySelector(".assistant-replay");
      if (replayBtn) {
        replayBtn.style.display = assistantMessage.speech.audio ? "" : "none";
      }
    }

    await this.api.saveMessage({
      conversationId: this.conversationId,
      role:           "assistant",
      content:        assistantMessage.content,
      providerId:     assistantMessage.speech.providerId,
      speechModelId:  assistantMessage.speech.modelId,
      voiceId:        assistantMessage.speech.voiceId,
      audio:          assistantMessage.speech.audio,     // URL string, or null if nothing was saved
      duration:       assistantMessage.speech.duration,
    });
  
    // Wait for the audio queue to fully drain (all segments played) before
    // returning control to send(), which will then set state to IDLE.
    // If no speech chunks arrived (non-voice mode, TTS error, etc.) the
    // promise was already resolved above.
    await queueDrainPromise;

    if (this.messages.length === 2) {
      await this.api.renameConversation(
          this.conversationId,
          prompt.length > 60
              ? prompt.substring(0, 60)
              : prompt
      );
      await this.ui.loadConversationHistory();
    }

    this.ui.stateMgr.setState("IDLE");
    this.ui.refreshButtons();
  }
}
/* ==========================================
   BOOT
========================================== */
document.addEventListener("DOMContentLoaded", async () => {
  window.VoiceStudio = new VoiceUI();
  await window.VoiceStudio.initialize();
});
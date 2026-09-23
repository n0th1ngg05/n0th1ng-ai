let currentJobId = null;
let currentModalImage = null;

/* ===================== NAV & DRAWER ===================== */

const drawer = document.getElementById("drawer");

document
  .getElementById("burger")
  ?.addEventListener("click", () => {
    drawer?.classList.add("open");
  });

drawer
  ?.querySelector(".drawer-bg")
  ?.addEventListener("click", () => {
    drawer.classList.remove("open");
  });

drawer
  ?.querySelectorAll("[data-close]")
  ?.forEach((el) => {
    el.addEventListener("click", () => {
      drawer.classList.remove("open");
    });
  });

/* ===================== SIDEBAR TOGGLES WITH BACKDROP ===================== */

const leftSidebar = document.getElementById("leftSidebar");
const rightSidebar = document.getElementById("rightSidebar");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

function isMobile() {
  return window.innerWidth <= 1024;
}

document
  .getElementById("openLeftSidebar")
  ?.addEventListener("click", () => {
    leftSidebar?.classList.add("open");
    if (isMobile()) sidebarBackdrop?.classList.add("show");
  });

document
  .getElementById("closeLeftSidebar")
  ?.addEventListener("click", () => {
    leftSidebar?.classList.remove("open");
    checkSidebarBackdrop();
  });

document
  .getElementById("openRightSidebar")
  ?.addEventListener("click", () => {
    rightSidebar?.classList.add("open");
    if (isMobile()) sidebarBackdrop?.classList.add("show");
  });

document
  .getElementById("toggleRightSidebar")
  ?.addEventListener("click", () => {
    if (isMobile()) {
      rightSidebar?.classList.add("open");
      sidebarBackdrop?.classList.add("show");
    } else {
      rightSidebar?.classList.toggle("open");
    }
  });

document
  .getElementById("closeRightSidebar")
  ?.addEventListener("click", () => {
    rightSidebar?.classList.remove("open");
    checkSidebarBackdrop();
  });

sidebarBackdrop?.addEventListener("click", () => {
  leftSidebar?.classList.remove("open");
  rightSidebar?.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
});

function checkSidebarBackdrop() {
  if (!leftSidebar?.classList.contains("open") && !rightSidebar?.classList.contains("open")) {
    sidebarBackdrop?.classList.remove("show");
  }
}

document.addEventListener("click", (e) => {
  // If click is outside sidebars and not on a toggle button
  const isLeftOpen = leftSidebar?.classList.contains("open");
  const isRightOpen = rightSidebar?.classList.contains("open");
  
  if (isLeftOpen && !leftSidebar.contains(e.target) && !e.target.closest("#openLeftSidebar")) {
    leftSidebar.classList.remove("open");
    checkSidebarBackdrop();
  }
  
  if (isRightOpen && !rightSidebar.contains(e.target) && !e.target.closest("#openRightSidebar") && !e.target.closest(".composer-tools")) {
    rightSidebar.classList.remove("open");
    checkSidebarBackdrop();
  }
});

// Ensure resize resolves stray backdrops
window.addEventListener("resize", () => {
  if (!isMobile()) {
    sidebarBackdrop?.classList.remove("show");
    leftSidebar?.classList.remove("open");
  }
});


/* ===================== ELEMENTS ===================== */

const promptInput = document.getElementById("promptInput");
const negativePromptInput = document.getElementById("negativePrompt");
const DEFAULT_NEGATIVE_PROMPT = "cartoon, anime, CGI, 3D render, toy car, unrealistic reflections, plastic body, distorted car, incorrect proportions, warped wheels, malformed headlights, duplicate car, floating vehicle, excessive motion blur, oversaturated colors, artificial lighting, low detail, blurry, low resolution, noisy image, excessive HDR, crushed blacks, blown highlights, watermark, text, logo";
if (negativePromptInput && !negativePromptInput.value) {
  negativePromptInput.value = DEFAULT_NEGATIVE_PROMPT;
}
const seedInput = document.getElementById("seedInput");
const btnGenerate = document.getElementById("btnGenerate");
const emptyState = document.getElementById("emptyState");
const genProgress = document.getElementById("genProgress");
const previewStage = document.getElementById("previewStage");
const metaSection = document.getElementById("metaSection");
const progressBar = document.getElementById("progressBar");
const stepCount = document.getElementById("stepCount");
const stepTotal = document.getElementById("stepTotal");
const timeEst = document.getElementById("timeEst");
document.getElementById("historySearch")?.addEventListener("input",() => {renderGallery();});

/* ===================== TEXTAREA AUTO RESIZE ===================== */

promptInput?.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

/* ===================== STYLE BUTTONS ===================== */

document.querySelectorAll(".qa-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".qa-btn").forEach((b) => b.classList.remove("active"));
    e.target.classList.add("active");
  });
});

/* ===================== ASPECT RATIOS & RESOLUTION ===================== */

function parseAspectRatio(str) {
  if (!str) return null;
  const cleaned = String(str).trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (match) {
    const w = parseFloat(match[1]);
    const h = parseFloat(match[2]);
    if (w > 0 && h > 0) return w / h;
  }
  const single = parseFloat(cleaned);
  if (!isNaN(single) && single > 0) return single;
  return null;
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function formatRatio(w, h) {
  if (!w || !h) return "1:1";
  const g = gcd(Math.round(w), Math.round(h));
  const rw = Math.round(w / g);
  const rh = Math.round(h / g);
  if (rw <= 32 && rh <= 32) {
    return `${rw}:${rh}`;
  }
  const ratio = w / h;
  const common = [
    { r: 1, text: "1:1" },
    { r: 16/9, text: "16:9" },
    { r: 9/16, text: "9:16" },
    { r: 4/3, text: "4:3" },
    { r: 3/4, text: "3:4" },
    { r: 3/2, text: "3:2" },
    { r: 2/3, text: "2:3" },
    { r: 21/9, text: "21:9" },
    { r: 9/21, text: "9:21" },
    { r: 5/4, text: "5:4" },
    { r: 4/5, text: "4:5" },
  ];
  for (const c of common) {
    if (Math.abs(ratio - c.r) < 0.03) return c.text;
  }
  return `${ratio.toFixed(2)}:1`;
}

function updateAspectRatioUI(w, h, ratioStr, source) {
  const previewFrame = document.querySelector(".preview-frame");
  const arDisplay = document.getElementById("arDisplay");
  const customArInput = document.getElementById("customArInput");
  const baseWidthInput = document.getElementById("baseWidthInput");
  const baseHeightInput = document.getElementById("baseHeightInput");

  const validW = Math.max(256, Math.min(4096, Math.round(w)));
  const validH = Math.max(256, Math.min(4096, Math.round(h)));

  if (previewFrame) {
    previewFrame.style.aspectRatio = `${validW} / ${validH}`;
  }

  if (source !== "inputs") {
    if (baseWidthInput) baseWidthInput.value = validW;
    if (baseHeightInput) baseHeightInput.value = validH;
  }

  const computedRatio = ratioStr || formatRatio(validW, validH);
  if (source !== "ratio" && customArInput) {
    customArInput.value = computedRatio;
  }
  if (arDisplay) {
    arDisplay.textContent = computedRatio;
  }

  // Update preset active state
  const currentRatioNum = validW / validH;
  document.querySelectorAll(".ar-btn").forEach((btn) => {
    const btnW = Number(btn.dataset.w);
    const btnH = Number(btn.dataset.h);
    const btnRatio = parseAspectRatio(btn.dataset.ratio || btn.title);
    const isMatch = (btnW === validW && btnH === validH) ||
      (btnRatio !== null && Math.abs(currentRatioNum - btnRatio) < 0.02);
    btn.classList.toggle("active", isMatch);
  });
}

// Preset buttons
document.querySelectorAll(".ar-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    const target = e.currentTarget;
    const w = Number(target.dataset.w) || 1024;
    const h = Number(target.dataset.h) || 1024;
    const r = target.dataset.ratio || target.title;
    updateAspectRatioUI(w, h, r, "preset");
  });
});

// Custom ratio text input
document.getElementById("customArInput")?.addEventListener("input", (e) => {
  const ratio = parseAspectRatio(e.target.value);
  if (ratio) {
    const targetArea = 1024 * 1024;
    const h = Math.round(Math.sqrt(targetArea / ratio) / 16) * 16;
    const w = Math.round((h * ratio) / 16) * 16;
    updateAspectRatioUI(w, h, e.target.value.trim(), "ratio");
  }
});

// Width & Height inputs
document.getElementById("baseWidthInput")?.addEventListener("input", () => {
  const w = parseInt(document.getElementById("baseWidthInput")?.value || "1024", 10);
  const h = parseInt(document.getElementById("baseHeightInput")?.value || "1024", 10);
  if (w > 0 && h > 0) {
    updateAspectRatioUI(w, h, null, "inputs");
  }
});

document.getElementById("baseHeightInput")?.addEventListener("input", () => {
  const w = parseInt(document.getElementById("baseWidthInput")?.value || "1024", 10);
  const h = parseInt(document.getElementById("baseHeightInput")?.value || "1024", 10);
  if (w > 0 && h > 0) {
    updateAspectRatioUI(w, h, null, "inputs");
  }
});

// Swap dimensions button
document.getElementById("swapDimensionsBtn")?.addEventListener("click", () => {
  const wi = document.getElementById("baseWidthInput");
  const hi = document.getElementById("baseHeightInput");
  const w = parseInt(wi?.value || "1024", 10);
  const h = parseInt(hi?.value || "1024", 10);
  updateAspectRatioUI(h, w, null, "swap");
});


/* ===================== TARGET SIZE BUTTONS ===================== */

document.querySelectorAll(".tsz-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tsz-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    // Fill the W×H inputs with the preset values
    const w = btn.dataset.w;
    const h = btn.dataset.h;
    const wi = document.getElementById("targetWidthInput");
    const hi = document.getElementById("targetHeightInput");
    if (wi && w) wi.value = w;
    if (hi && h) hi.value = h;
  });
});

// When the user types in the number inputs, deactivate any preset button
document.getElementById("targetWidthInput")?.addEventListener("input", () => {
  document.querySelectorAll(".tsz-btn").forEach((b) => b.classList.remove("active"));
});
document.getElementById("targetHeightInput")?.addEventListener("input", () => {
  document.querySelectorAll(".tsz-btn").forEach((b) => b.classList.remove("active"));
});

/* ===================== SLIDERS ===================== */

document.querySelectorAll(".form-slider").forEach((slider) => {
  slider.addEventListener("input", (e) => {
    const val = e.target.parentElement.querySelector(".slider-val");
    if (val) {
      val.textContent = e.target.value;
    }
  });
});

/* ===================== HIRES SLIDERS ===================== */

document.getElementById("hiresStepsSlider")?.addEventListener("input", (e) => {
  const v = document.getElementById("hiresStepsVal");
  if (v) v.textContent = e.target.value;
});

document.getElementById("hiresDenoiseSlider")?.addEventListener("input", (e) => {
  const v = document.getElementById("hiresDenoiseVal");
  if (v) v.textContent = Number(e.target.value).toFixed(2);
});

/* ===================== PROMPT FILLER ===================== */

window.fillPrompt = function (text) {
  promptInput.value = text;
  promptInput.style.height = "auto";
  promptInput.style.height = promptInput.scrollHeight + "px";
  promptInput.focus();
};

/* ===================== CONFIG BUILDER ===================== */

function getSelectedResolution() {
  const wi = parseInt(document.getElementById("baseWidthInput")?.value || "1024", 10);
  const hi = parseInt(document.getElementById("baseHeightInput")?.value || "1024", 10);
  const w = isNaN(wi) ? 1024 : Math.max(256, Math.min(4096, wi));
  const h = isNaN(hi) ? 1024 : Math.max(256, Math.min(4096, hi));
  const ar = document.getElementById("customArInput")?.value.trim() || `${w}:${h}`;
  return { width: w, height: h, aspectRatio: ar };
}

function getGenerationConfig() {
  const resolution = getSelectedResolution();
  const providerSelect = document.getElementById("providerSelect");

  return {
    prompt: promptInput.value.trim(),
    negativePrompt: (negativePromptInput && negativePromptInput.value.trim().length > 0)
      ? negativePromptInput.value.trim()
      : DEFAULT_NEGATIVE_PROMPT,
    width: resolution.width,
    height: resolution.height,
    aspectRatio: resolution.aspectRatio,
    steps: Number(document.getElementById("stepsSlider")?.value || 30),
    cfg: Number(document.getElementById("cfgSlider")?.value || 7),
    denoise: Number(document.getElementById("denoiseSlider")?.value || 1),
    batchSize: Number(document.getElementById("batchSlider")?.value || 1),
    sampler: document.getElementById("samplerSelect")?.value || "euler",
    scheduler: document.getElementById("schedulerSelect")?.value || "simple",
    seed: Number(seedInput?.value) >= 0 ? Number(seedInput.value) : undefined,
    providerId: providerSelect ? providerSelect.value : undefined,
    ...getUpscaleConfig(),
  };
}

function getUpscaleConfig() {
  const section = document.getElementById("upscaleSection");
  if (!section || section.classList.contains("hidden")) return {};

  const tw = parseInt(document.getElementById("targetWidthInput")?.value || "2048", 10);
  const th = parseInt(document.getElementById("targetHeightInput")?.value || "2048", 10);
  return {
    upscaleModel: document.getElementById("upscaleModelSelect")?.value || "4x-UltraSharp.pth",
    targetWidth: isNaN(tw) ? 2048 : tw,
    targetHeight: isNaN(th) ? 2048 : th,
    interpolation: document.getElementById("interpolationSelect")?.value || "lanczos",
    hiresSteps: Number(document.getElementById("hiresStepsSlider")?.value || 12),
    hiresDenoise: Number(document.getElementById("hiresDenoiseSlider")?.value || 0.5),
  };
}

/* ===================== GENERATE ===================== */

btnGenerate?.addEventListener("click", async () => {
  const config = getGenerationConfig();

  if (!config.prompt) {
    promptInput.focus();
    return;
  }

  try {
    btnGenerate.disabled = true;
    btnGenerate.querySelector("span").textContent = "Generating...";

    emptyState.classList.add("hidden");
    previewStage.classList.remove("hidden");
    metaSection.classList.add("hidden");
    genProgress.classList.remove("hidden");

    progressBar.style.width = "0%";
    stepCount.textContent = "0";
    if (stepTotal) stepTotal.textContent = config.steps;
    timeEst.textContent = "QUEUED";

    const response = await fetch("/api/image/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });

    if (!response.ok) {
      throw new Error(`Generation failed (${response.status})`);
    }

    const data = await response.json();
    currentJobId = data.jobId;
    console.log("JOB CREATED:", currentJobId);

    // Start SSE for live ComfyUI node updates
    connectLiveStream(currentJobId);
    
    // Fallback polling for overall status
    pollGeneration(currentJobId);

  } catch (err) {
    console.error("Generation Error:", err);
    btnGenerate.disabled = false;
    btnGenerate.querySelector("span").textContent = "Generate";
  }
});

/* ===================== LIVE STREAM (SSE) ===================== */

let currentEventSource = null;

function connectLiveStream(jobId) {
  if (currentEventSource) {
    currentEventSource.close();
  }

  currentEventSource = new EventSource(`/api/image/stream/${jobId}`);

  // boot.ts sends NAMED SSE events (`event: comfy_progress`, `event:
  // comfy_node`, `event: queued`, `event: done`, `event: error`), not
  // the default unnamed `message` event - a plain .onmessage handler
  // never fires for these, so progress previously never appeared even
  // though the connection opened successfully. Payload is also flat
  // ({ type, value, max }), not nested under a `.data` key.

  currentEventSource.addEventListener("queued", () => {
    timeEst.textContent = "QUEUED";
  });

  currentEventSource.addEventListener("comfy_progress", (e) => {
    try {
      const data = JSON.parse(e.data);
      const step = data.value || 0;
      const total = data.max || parseInt(document.getElementById("stepsSlider")?.value) || 30;
      const pct = Math.min(100, Math.round((step / total) * 100));

      stepCount.textContent = step;
      if (stepTotal) stepTotal.textContent = total;
      progressBar.style.width = `${pct}%`;
      timeEst.textContent = "SAMPLING";
    } catch (err) {
      console.error("SSE parse error (comfy_progress)", err);
    }
  });

  currentEventSource.addEventListener("comfy_node", (e) => {
    try {
      const data = JSON.parse(e.data);
      const phaseEl = document.getElementById("loaderPhase");
      if (data.node) {
        // Map ComfyUI node titles to friendly phase labels
        const n = String(data.node).toLowerCase();
        let phase = "PROCESSING";
        let sub = `NODE ${data.node}`;
        if (n.includes("pass 1") || n.includes("base")) { phase = "PASS 1 · BASE GEN"; sub = "SAMPLING"; }
        else if (n.includes("upscale") || n.includes("esrgan") || n.includes("imageupscale")) { phase = "UPSCALING"; sub = "ESRGAN"; }
        else if (n.includes("imagescale")) { phase = "UPSCALING"; sub = "RESIZING"; }
        else if (n.includes("pass 2") || n.includes("hires")) { phase = "PASS 2 · HIRES-FIX"; sub = "SAMPLING"; }
        else if (n.includes("vae") || n.includes("decode")) { phase = "DECODING"; sub = "VAE"; }
        else if (n.includes("save")) { phase = "SAVING"; sub = "WRITING FILE"; }
        if (phaseEl) phaseEl.textContent = phase;
        timeEst.textContent = sub;
      } else {
        if (phaseEl) phaseEl.textContent = "FINALIZING";
        timeEst.textContent = "SAVING";
      }
    } catch (err) {
      console.error("SSE parse error (comfy_node)", err);
    }
  });

  currentEventSource.addEventListener("done", async (e) => {
    timeEst.textContent = "COMPLETED";
    currentEventSource.close();
    currentEventSource = null;
    if (currentJobId) {
      await loadResult(currentJobId);
      await loadGallery();
    }
    btnGenerate.disabled = false;
    btnGenerate.querySelector("span").textContent = "Generate";
  });

  currentEventSource.addEventListener("error", (e) => {
    try {
      const data = JSON.parse(e.data || "{}");
      if (data.error) {
        console.error("Generation Error:", data.error);
        currentEventSource.close();
        currentEventSource = null;
        btnGenerate.disabled = false;
        btnGenerate.querySelector("span").textContent = "Generate";
        return;
      }
    } catch {
      // Not a parseable server error payload - fall through to the
      // connection-level handling below.
    }
  });

  // Native EventSource connection-level error (stream never opened, or
  // dropped mid-flight without a clean server-sent "error" event first).
  // Falls back to polling so progress doesn't just silently stop.
  currentEventSource.onerror = () => {
    if (currentEventSource && currentEventSource.readyState === EventSource.CLOSED) {
      console.warn("SSE stream closed unexpectedly, falling back to polling for job", jobId);
      currentEventSource = null;
      pollGeneration(jobId);
    }
  };
}

/* ===================== POLLING ===================== */

async function pollGeneration(jobId) {
  const interval = setInterval(async () => {
    try {
      const response = await fetch(`/api/image/status/${jobId}`);
      const status = await response.json();

      console.log("STATUS:", status);

      stepCount.textContent = status.currentStep || 0;
      progressBar.style.width = `${status.progress || 0}%`;
      timeEst.textContent = (status.status || "UNKNOWN").toUpperCase();

      if (status.status === "failed") {
        clearInterval(interval);
        console.error(status.error);
        btnGenerate.disabled = false;
        btnGenerate.querySelector("span").textContent = "Generate";
        return;
      }

      if (status.status === "completed") {
        clearInterval(interval);
        await loadResult(jobId);
        await loadGallery();
      }
    } catch (err) {
      console.error(err);
    }
  }, 1000);
}

/* ===================== LOAD RESULT ===================== */

async function loadResult(jobId) {
  try {
    const response = await fetch(`/api/image/result/${jobId}`);
    const result = await response.json();

    genProgress.classList.add("hidden");
    previewStage.classList.remove("hidden");
    metaSection.classList.remove("hidden");

    btnGenerate.disabled = false;
    btnGenerate.querySelector("span").textContent = "Generate";

    const preview = document.querySelector(".preview-frame");

    // Full-pipeline: show base + upscaled side-by-side
    if (result.baseImageUrl && result.imageUrl) {
      preview.style.aspectRatio = "2 / 1";
      preview.innerHTML = `
        <div class="dual-result-wrap">
          <div class="result-pane">
            <span class="result-pane-label">Base · 1024²</span>
            <img src="${result.baseImageUrl}" alt="Base generation" />
            <div class="result-pane-actions">
              <button class="action-btn glass" title="Download base" onclick="_dlImg('${result.baseImageUrl}','base.png')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              </button>
            </div>
          </div>
          <div class="result-pane">
            <span class="result-pane-label upscaled">Upscaled · ${result.targetWidth || 2048}²</span>
            <img src="${result.imageUrl}" alt="Upscaled result" />
            <div class="result-pane-actions">
              <button class="action-btn glass bg-aurora" title="Download upscaled" onclick="_dlImg('${result.imageUrl}','upscaled.png')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Single-stage: original single image display
      if (result.resolution) {
        preview.style.aspectRatio = result.resolution.replace("x", "/");
      } else {
        preview.style.aspectRatio = "1/1";
      }
      let img = preview.querySelector("img.result-img");
      if (!img) {
        img = document.createElement("img");
        img.className = "result-img";
        img.style = "position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:inherit; z-index:5;";
        preview.appendChild(img);
      }
      img.src = result.imageUrl;
    }
  } catch (err) {
    console.error("Result Error:", err);
    btnGenerate.disabled = false;
    btnGenerate.querySelector("span").textContent = "Generate";
  }
}

// Helper for inline download buttons in dual-result view
window._dlImg = function(url, name) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
};

let galleryImages = [];
let currentModalIndex = 0;

async function loadGallery() {
  try {
    const response = await fetch("/api/trpc/image.list");
    const data = await response.json();
    
    galleryImages = data.result.data.json;
    renderGallery();

    const inspireGrid = document.querySelector(".inspire-grid");
    if (inspireGrid && galleryImages.length >= 1) {
      const topImages = galleryImages.slice(0, 3);
      inspireGrid.innerHTML = "";
      topImages.forEach((img, idx) => {
        inspireGrid.insertAdjacentHTML("beforeend", `
          <div class="inspire-card" style="animation-delay: ${idx * 0.1}s;" onclick="showImage(${img.id})">
            <img src="${img.imageUrl}" alt="Recent Generation">
            <span class="inspire-badge" style="max-width: 90%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${img.prompt}">${img.prompt || 'Untitled'}</span>
          </div>
        `);
      });
    }
  } catch (err) {
    console.error("Gallery Load Error:", err);
  }
}

function renderGallery() {
  const gallery = document.getElementById("galleryGrid");
  const galleryEmpty = document.getElementById("galleryEmpty");
  const searchInput = document.getElementById("historySearch");
  
  if (!gallery) return;
  gallery.innerHTML = "";

  const query = searchInput?.value?.toLowerCase()?.trim() || "";
  const filteredImages = galleryImages.filter((image) =>
    image.prompt?.toLowerCase().includes(query)
  );

  if (filteredImages.length === 0) {
    if(galleryEmpty) galleryEmpty.classList.remove("hidden");
    return;
  } else {
    if(galleryEmpty) galleryEmpty.classList.add("hidden");
  }

  filteredImages.forEach((image) => {
    gallery.insertAdjacentHTML(
      "beforeend",
      `
      <div class="g-item glass fade-up" onclick="showImage(${image.id})">

    <button
      class="g-delete"
      onclick="deleteImage(event, ${image.id})"
      title="Delete Image"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
    </button>
  
    <button
      class="g-reuse"
      onclick="reusePrompt(event, ${image.id})"
      title="Reuse Prompt"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.92-10.26l5.08 5.08"/></svg>
    </button>

  <img src="${image.imageUrl}" />

  <div class="g-overlay">
    <span>${image.resolution || '1024x1024'}</span>
    <span>${image.generationTime || '4.2'}s</span>
  </div>

</div>
      `
    );
  });
  
}

async function deleteImage(
  event,
  imageId
) {
  event.stopPropagation();

  const confirmed =
    confirm(
      "Delete this image?"
    );

  if (!confirmed) {
    return;
  }

  try {

    await fetch(
      "/api/trpc/image.delete",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          json: {
            id: imageId,
          },
        }),
      }
    );

    galleryImages =
      galleryImages.filter(
        img =>
          img.id !== imageId
      );

    renderGallery();

    loadGallery();

    if (
      currentModalImage &&
      currentModalImage.id === imageId
    ) {
      closeImageModal();
    }

  } catch (err) {

    console.error(
      "Delete failed:",
      err
    );

    alert(
      "Failed to delete image"
    );
  }
}

function reusePrompt(
  event,
  imageId
) {
  event.stopPropagation();

  const image =
    galleryImages.find(
      img => img.id === imageId
    );

  if (!image) {
    return;
  }

  promptInput.value =
    image.prompt || "";

  promptInput.dispatchEvent(
    new Event("input")
  );

  promptInput.focus();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });
}

function showImage(id) {
  const image = galleryImages.find((img) => img.id === id);
  if (!image) return;

  previewStage.classList.remove("hidden");
  metaSection.classList.remove("hidden");
  emptyState.classList.add("hidden");

  const preview = document.querySelector(".preview-frame");
  if (image.baseImageUrl) {
    preview.style.aspectRatio = "2 / 1";
    preview.innerHTML = `
      <div class="dual-result-wrap">
        <div class="result-pane">
          <span class="result-pane-label">Base · 1024²</span>
          <img src="${image.baseImageUrl}" alt="Base generation" />
          <div class="result-pane-actions">
            <button class="action-btn glass" title="Download base" onclick="_dlImg('${image.baseImageUrl}','base.png')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            </button>
          </div>
        </div>
        <div class="result-pane">
          <span class="result-pane-label upscaled">Upscaled · Final</span>
          <img src="${image.imageUrl}" alt="Upscaled result" />
          <div class="result-pane-actions">
            <button class="action-btn glass bg-aurora" title="Download upscaled" onclick="_dlImg('${image.imageUrl}','upscaled.png')">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  } else {
    preview.innerHTML = '';
    if (image.resolution) {
      preview.style.aspectRatio = image.resolution.replace("x", "/");
    } else {
      preview.style.aspectRatio = "1/1";
    }
    const img = document.createElement("img");
    img.className = "result-img";
    img.style = "position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:inherit; z-index:5;";
    img.src = image.imageUrl;
    preview.appendChild(img);
  }

  updateMetadata(image);
  
  if(window.innerWidth <= 1024) {
    leftSidebar.classList.remove("open");
    checkSidebarBackdrop();
  }
}

function updateMetadata(image) {
  const promptEl = document.getElementById("metaPrompt");
  if(promptEl) promptEl.textContent = image.prompt;

  const resEl = document.getElementById("metaResolution");
  if(resEl) resEl.textContent = image.resolution;

  const stepsEl = document.getElementById("metaSteps");
  if(stepsEl) stepsEl.textContent = image.steps;

  const cfgEl = document.getElementById("metaCfg");
  if(cfgEl) cfgEl.textContent = image.cfg;

  const samplerEl = document.getElementById("metaSampler");
  if(samplerEl) samplerEl.textContent = image.sampler;

  const schedulerEl = document.getElementById("metaScheduler");
  if(schedulerEl) schedulerEl.textContent = image.scheduler;

  const seedEl = document.getElementById("metaSeed");
  if(seedEl) seedEl.textContent = image.seed;

  const timeEl = document.getElementById("metaTime");
  if(timeEl) timeEl.textContent = `${image.generationTime}s`;
}

/* ===================== LUXURY FULLSCREEN MODAL ===================== */

function updateModalUI(image) {
  // Update Source Instantly (No Timeout Glitch)
  document.getElementById("modalImage").src = image.imageUrl;

  // Update Bottom Command Bar
  const p = document.getElementById("modalPromptText");
  if(p) p.textContent = image.prompt || "No prompt provided";

  const r = document.getElementById("modalResTag");
  if(r) r.textContent = image.resolution || "1024x1024";

  const s = document.getElementById("modalStepsTag");
  if(s) s.textContent = (image.steps || 30) + " Steps";

  const c = document.getElementById("modalCfgTag");
  if(c) c.textContent = "CFG " + (image.cfg || 7.0);

  // Re-assign Action Listeners
  const dl = document.getElementById("downloadBtn");
  if(dl) dl.onclick = () => downloadImage(image);

  const baseBtn = document.getElementById("downloadBaseBtn");
  if (baseBtn) {
    if (image.baseImageUrl) {
      baseBtn.classList.remove("hidden");
      baseBtn.onclick = () => {
        const a = document.createElement("a");
        a.href = image.baseImageUrl;
        a.download = `image-${image.id}-base.png`;
        a.click();
      };
    } else {
      baseBtn.classList.add("hidden");
    }
  }

  const cp = document.getElementById("copyPromptBtn");
  if(cp) cp.onclick = () => copyPrompt(image);
}

function openImageModal(id) {
  const image = galleryImages.find(img => img.id === id);
  if (!image) return;

  currentModalIndex =
  galleryImages.findIndex(
    img => img.id === id
  );

currentModalImage =
  image;

updateModalUI(image);
  updateModalUI(image);

  document.getElementById("imageModal").classList.add("open");
}

function closeImageModal() {
  document.getElementById("imageModal").classList.remove("open");
}

document
  .getElementById(
    "reuseConfigBtn"
  )
  ?.addEventListener(
    "click",
    reuseConfiguration
  );

function reuseConfiguration() {

  if (!currentModalImage) {
    return;
  }

  promptInput.value =
    currentModalImage.prompt || "";

  if (negativePromptInput) {
    negativePromptInput.value =
      currentModalImage.negativePrompt || "";
  }

  if (seedInput) {
    seedInput.value =
      currentModalImage.seed || "";
  }

  document.getElementById(
    "stepsSlider"
  ).value =
    currentModalImage.steps || 20;

  document.getElementById(
    "cfgSlider"
  ).value =
    currentModalImage.cfg || 1;

  document.getElementById(
    "denoiseSlider"
  ).value =
    currentModalImage.denoise || 1;

  document.getElementById(
    "batchSlider"
  ).value =
    currentModalImage.batchSize || 1;

  document.getElementById(
    "samplerSelect"
  ).value =
    currentModalImage.sampler || "euler";

  document.getElementById(
    "schedulerSelect"
  ).value =
    currentModalImage.scheduler || "simple";

  if (currentModalImage.provider) {
    const provSelect = document.getElementById("providerSelect");
    if (provSelect && provSelect.value !== currentModalImage.provider) {
      provSelect.value = currentModalImage.provider;
      provSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  if (currentModalImage.upscaleModel) {
    const um = document.getElementById("upscaleModelSelect");
    if (um) {
      um.value = currentModalImage.upscaleModel;
      um.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  if (currentModalImage.hiresSteps) {
    const hs = document.getElementById("hiresStepsSlider");
    const hsv = document.getElementById("hiresStepsVal");
    if (hs) hs.value = currentModalImage.hiresSteps;
    if (hsv) hsv.textContent = currentModalImage.hiresSteps;
  }

  if (currentModalImage.hiresDenoise) {
    const hd = document.getElementById("hiresDenoiseSlider");
    const hdv = document.getElementById("hiresDenoiseVal");
    if (hd) hd.value = currentModalImage.hiresDenoise;
    if (hdv) hdv.textContent = Number(currentModalImage.hiresDenoise).toFixed(2);
  }

  setResolutionFromImage(
    currentModalImage.resolution
  );

  updateSliderLabels();

  closeImageModal();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  promptInput.focus();
}

function updateSliderLabels() {

  document
    .querySelectorAll(
      ".form-slider"
    )
    .forEach(slider => {

      const label =
        slider.parentElement
          ?.querySelector(
            ".slider-val"
          );

      if (label) {
        label.textContent =
          slider.value;
      }

    });
}

function setResolutionFromImage(
  resolution
) {
  if (!resolution) {
    return;
  }

  const [
    width,
    height
  ] = resolution
    .split("x")
    .map(Number);

  if (!width || !height) return;

  updateAspectRatioUI(width, height, null, "preset");
}

function previousImage() {
  if (currentModalIndex <= 0) return;
  currentModalIndex--;
  updateModalUI(galleryImages[currentModalIndex]);
}

function nextImage() {
  if (currentModalIndex >= galleryImages.length - 1) return;
  currentModalIndex++;
  updateModalUI(galleryImages[currentModalIndex]);
}

function downloadImage(image) {
  const a = document.createElement("a");
  a.href = image.imageUrl;
  a.download = `image-${image.id}.png`;
  a.click();
}

function copyPrompt(image) {
  navigator.clipboard.writeText(image.prompt);
  
  // Feedback
  const btn = document.getElementById("copyPromptBtn");
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied`;
  btn.style.color = "var(--color-healthy)";
  btn.style.borderColor = "var(--color-healthy)";
  
  setTimeout(() => {
    btn.innerHTML = originalHtml;
    btn.style.color = "";
    btn.style.borderColor = "";
  }, 2000);
}

// Global Keybinds for Modal Navigation
document.addEventListener("keydown", (e) => {
  if (!document.getElementById("imageModal").classList.contains("open")) return;
  
  if (e.key === "Escape") closeImageModal();
  if (e.key === "ArrowLeft") previousImage();
  if (e.key === "ArrowRight") nextImage();
});

/* ===================== LOAD PROVIDERS ===================== */

async function loadImageProviders() {
  const select = document.getElementById("providerSelect");
  if (!select) return;

  try {
    const url = `/api/trpc/providers.list?input=${encodeURIComponent(JSON.stringify({ json: { mediaType: 'image' } }))}`;
    const res = await fetch(url);
    const data = await res.json();
    const providers = data?.result?.data?.json;

    if (!providers || providers.length === 0) {
      select.innerHTML = '<option value="" disabled selected>No image providers found</option>';
      return;
    }

    select.innerHTML = '';
    providers.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      if (i === 0) opt.selected = true;
      select.appendChild(opt);
    });

    // Apply the first provider's defaults immediately
    applyProviderDefaults(providers[0]);

    select.addEventListener("change", () => {
      const chosen = providers.find(p => p.id === select.value);
      if (chosen) {
        applyProviderDefaults(chosen);
        applyUpscaleDefaults(chosen);
      }
    });

    // Apply upscale defaults for the initially selected provider too
    applyUpscaleDefaults(providers[0]);

  } catch (err) {
    select.innerHTML = '<option value="" disabled selected>Could not load providers</option>';
    console.error("Failed to load image providers:", err);
  }

  function applyProviderDefaults(provider) {
    const d = provider.defaults || provider.defaultParams;
    if (d) {
      if (d.steps) {
        const s = document.getElementById("stepsSlider");
        if (s) s.value = d.steps;
      }
      if (d.cfg !== undefined) {
        const c = document.getElementById("cfgSlider");
        if (c) c.value = d.cfg;
      }
      updateSliderLabels();
    }
  }

  function applyUpscaleDefaults(provider) {
    const section = document.getElementById("upscaleSection");
    if (!section) return;

    const isFullPipeline = provider.executor === 'full-pipeline' ||
      (provider.id && (provider.id.includes('full') || provider.id.includes('krea') || provider.id.includes('klein-full')));

    if (isFullPipeline) {
      section.classList.remove("hidden");

      const ud = provider.upscaleDefaults || {
        upscaleModel: "4x-UltraSharp.pth",
        interpolation: "lanczos",
        targetWidth: 2048,
        targetHeight: 2048,
        hiresSteps: 12,
        hiresDenoise: 0.5,
      };

      // Upscale model
      const modelSel = document.getElementById("upscaleModelSelect");
      if (modelSel && ud.upscaleModel) {
        modelSel.value = ud.upscaleModel;
        modelSel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Interpolation
      const interp = document.getElementById("interpolationSelect");
      if (interp && ud.interpolation) {
        interp.value = ud.interpolation;
        interp.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // Hires steps
      const hiresStepsSlider = document.getElementById("hiresStepsSlider");
      const hiresStepsVal = document.getElementById("hiresStepsVal");
      if (hiresStepsSlider && ud.hiresSteps) {
        hiresStepsSlider.value = ud.hiresSteps;
        if (hiresStepsVal) hiresStepsVal.textContent = ud.hiresSteps;
      }
      // Hires denoise
      const hiresDenoiseSlider = document.getElementById("hiresDenoiseSlider");
      const hiresDenoiseVal = document.getElementById("hiresDenoiseVal");
      if (hiresDenoiseSlider && ud.hiresDenoise) {
        hiresDenoiseSlider.value = ud.hiresDenoise;
        if (hiresDenoiseVal) hiresDenoiseVal.textContent = Number(ud.hiresDenoise).toFixed(2);
      }
      // Target size: write into number inputs + highlight matching preset if any
      const tw = ud.targetWidth || 2048;
      const th = ud.targetHeight || 2048;
      const wi = document.getElementById("targetWidthInput");
      const hi = document.getElementById("targetHeightInput");
      if (wi) wi.value = tw;
      if (hi) hi.value = th;
      document.querySelectorAll(".tsz-btn").forEach(btn => {
        const match = Number(btn.dataset.w) === tw && Number(btn.dataset.h) === th;
        btn.classList.toggle("active", match);
      });
    } else {
      section.classList.add("hidden");
    }
  }
}

/* ===================== COMFY OPTIONS (live dropdowns) ===================== */

async function loadComfyOptions() {
  try {
    const url = "/api/trpc/providers.comfyOptions";
    const res = await fetch(url);
    const data = await res.json();
    const opts = data?.result?.data?.json;
    if (!opts) return;

    function populateSelect(id, items, currentVal) {
      const sel = document.getElementById(id);
      if (!sel || !items?.length) return;
      const prev = currentVal ?? sel.value;
      sel.innerHTML = "";
      items.forEach(v => {
        const o = document.createElement("option");
        o.value = v;
        // Make label human-readable: replace underscores/hyphens, title-case
        o.textContent = v.replace(/[_\-]/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        sel.appendChild(o);
      });
      // Restore previous selection if still valid, else pick first
      if (items.includes(prev)) sel.value = prev;
      else sel.value = items[0];
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    populateSelect("samplerSelect", opts.samplers, "euler");
    populateSelect("schedulerSelect", opts.schedulers, "simple");
    populateSelect("upscaleModelSelect", opts.upscaleModels, "4x-UltraSharp.pth");
    populateSelect("interpolationSelect", opts.interpolations, "lanczos");
  } catch (err) {
    console.warn("Could not load ComfyUI options (ComfyUI offline?), using defaults:", err);
  }
}

loadComfyOptions();
loadImageProviders();
loadGallery();



previewStage?.addEventListener('click', (e) => {
  if (e.target.closest('.preview-frame')) return;
  if (e.target.closest('.meta-section')) return;
  if (!genProgress?.classList.contains('hidden')) return;
  
  previewStage.classList.add('hidden');
  metaSection.classList.add('hidden');
  emptyState.classList.remove('hidden');
});
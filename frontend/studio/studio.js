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

/* ===================== ASPECT RATIOS ===================== */

document.querySelectorAll(".ar-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    document.querySelectorAll(".ar-btn").forEach((b) => b.classList.remove("active"));
    const target = e.currentTarget;
    target.classList.add("active");

    const previewFrame = document.querySelector(".preview-frame");
    const ratio = target.title;

    if (ratio === "1:1") previewFrame.style.aspectRatio = "1 / 1";
    if (ratio === "16:9") previewFrame.style.aspectRatio = "16 / 9";
    if (ratio === "9:16") previewFrame.style.aspectRatio = "9 / 16";
    if (ratio === "4:3") previewFrame.style.aspectRatio = "4 / 3";
  });
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

/* ===================== PROMPT FILLER ===================== */

window.fillPrompt = function (text) {
  promptInput.value = text;
  promptInput.style.height = "auto";
  promptInput.style.height = promptInput.scrollHeight + "px";
  promptInput.focus();
};

/* ===================== CONFIG BUILDER ===================== */

function getSelectedResolution() {
  const active = document.querySelector(".ar-btn.active")?.title;

  switch (active) {
    case "16:9": return { width: 1280, height: 720 };
    case "9:16": return { width: 720, height: 1280 };
    case "4:3":  return { width: 1024, height: 768 };
    default:     return { width: 1024, height: 1024 };
  }
}

function getGenerationConfig() {
  const sliders = document.querySelectorAll(".form-slider");
  const resolution = getSelectedResolution();
  const providerSelect = document.getElementById("providerSelect");

  return {
    prompt: promptInput.value.trim(),
    negativePrompt: negativePromptInput?.value || "",
    width: resolution.width,
    height: resolution.height,
    steps: Number(sliders[0]?.value || 30),
    cfg: Number(sliders[1]?.value || 7),
    denoise: 1,
    batchSize: 1,
    sampler: "euler",
    scheduler: "simple",
    seed: Number(seedInput?.value) >= 0 ? Number(seedInput.value) : undefined,
    providerId: providerSelect ? providerSelect.value : undefined,
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
      if (data.node) {
        timeEst.textContent = `NODE: ${data.node}`;
      } else {
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
    if (result.resolution) {
      preview.style.aspectRatio = result.resolution.replace("x", "/");
    } else {
      preview.style.aspectRatio = "1/1";
    }
    let img = preview.querySelector("img.result-img");
    if(!img) {
      img = document.createElement("img");
      img.className = "result-img";
      img.style = "position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:inherit; z-index:5;";
      preview.appendChild(img);
    }
    img.src = result.imageUrl;
  } catch (err) {
    console.error("Result Error:", err);
    btnGenerate.disabled = false;
    btnGenerate.querySelector("span").textContent = "Generate";
  }
}

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
  if (image.resolution) {
    preview.style.aspectRatio = image.resolution.replace("x", "/");
  } else {
    preview.style.aspectRatio = "1/1";
  }

  let img = preview.querySelector("img.result-img");
  if(!img) {
    img = document.createElement("img");
    img.className = "result-img";
    img.style = "position:absolute; inset:0; width:100%; height:100%; object-fit:cover; border-radius:inherit; z-index:5;";
    preview.appendChild(img);
  }
  img.src = image.imageUrl;

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

  document
    .querySelectorAll(".ar-btn")
    .forEach(btn =>
      btn.classList.remove(
        "active"
      )
    );

  if (
    width === 1024 &&
    height === 1024
  ) {
    document
      .querySelector(
        '[title="1:1"]'
      )
      ?.classList.add(
        "active"
      );
  }

  if (
    width > height
  ) {
    document
      .querySelector(
        '[title="16:9"]'
      )
      ?.classList.add(
        "active"
      );
  }

  if (
    height > width
  ) {
    document
      .querySelector(
        '[title="9:16"]'
      )
      ?.classList.add(
        "active"
      );
  }
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
      if (chosen) applyProviderDefaults(chosen);
    });

  } catch (err) {
    select.innerHTML = '<option value="" disabled selected>Could not load providers</option>';
    console.error("Failed to load image providers:", err);
  }

  function applyProviderDefaults(provider) {
    // If the provider has default overrides for steps/cfg, update UI
    if (provider.defaultParams) {
      if (provider.defaultParams.steps) {
        document.getElementById("stepsSlider").value = provider.defaultParams.steps;
      }
      if (provider.defaultParams.cfg) {
        document.getElementById("cfgSlider").value = provider.defaultParams.cfg;
      }
      updateSliderLabels();
    }
  }
}

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
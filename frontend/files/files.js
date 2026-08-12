/* ===================== STATE ===================== */
let currentFolderId = null;
let folders = [];
let files = [];

/* ===================== NAV & DRAWER ===================== */
const drawer = document.getElementById('drawer');
document.getElementById('burger')?.addEventListener('click', () => drawer.classList.add('open'));
drawer.querySelector('.drawer-bg')?.addEventListener('click', () => drawer.classList.remove('open'));
drawer.querySelectorAll('[data-close]').forEach(el =>
  el.addEventListener('click', () => drawer.classList.remove('open'))
);

/* ===================== SIDEBAR TOGGLES ===================== */
const leftSidebar = document.getElementById('leftSidebar');
const sidebarBackdrop = document.getElementById("sidebarBackdrop");

function isMobile() {
  return window.innerWidth <= 1024;
}

document.getElementById('openLeftSidebar')?.addEventListener('click', () => {
  leftSidebar.classList.add('open');
  if (isMobile()) sidebarBackdrop?.classList.add('show');
});

document.getElementById('closeLeftSidebar')?.addEventListener('click', () => {
  leftSidebar.classList.remove('open');
  checkSidebarBackdrop();
});

sidebarBackdrop?.addEventListener('click', () => {
  leftSidebar?.classList.remove('open');
  sidebarBackdrop.classList.remove('show');
});

function checkSidebarBackdrop() {
  if (!leftSidebar?.classList.contains('open')) {
    sidebarBackdrop?.classList.remove('show');
  }
}

window.addEventListener('resize', () => {
  if (!isMobile()) {
    sidebarBackdrop?.classList.remove('show');
    leftSidebar?.classList.remove('open');
  }
});

/* ===================== ELEMENTS ===================== */
const folderList = document.getElementById("folderList");
const fileGrid = document.getElementById("fileGrid");
const emptyState = document.getElementById("emptyState");
const currentFolderTitle = document.getElementById("currentFolderTitle");
const newFolderBtn = document.getElementById("newFolderBtn");
const uploadBtn = document.getElementById("uploadBtn");
const hiddenFileInput = document.getElementById("hiddenFileInput");
const searchInput = document.getElementById("searchInput");

/* ===================== FORMATTERS ===================== */
function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

function getIconForMime(mimeType) {
  if (!mimeType) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
  if (mimeType.includes("pdf")) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
  if (mimeType.includes("image")) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
  if (mimeType.includes("json") || mimeType.includes("code") || mimeType.includes("text") || mimeType.includes("document")) return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
}

/* ===================== FOLDER LOGIC ===================== */
async function loadFolders() {
  try {
    const response = await fetch("/api/trpc/file.listFolders");
    if (!response.ok) throw new Error("Failed to fetch folders");
    
    const data = await response.json();
    folders = data.result?.data?.json || [];
    renderFolders();
  } catch (error) {
    console.error("Error loading folders:", error);
  }
}

function renderFolders() {
  folderList.innerHTML = `
    <li class="folder-item ${currentFolderId === null ? 'active' : ''}" data-id="null">
      <div class="f-name">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>All Files</span>
      </div>
    </li>
  `;

  folders.forEach(folder => {
    folderList.insertAdjacentHTML("beforeend", `
      <li class="folder-item ${currentFolderId === folder.id ? 'active' : ''}" data-id="${folder.id}">
        <div class="f-name">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span>${folder.name}</span>
        </div>
        <button class="f-delete-btn" title="Delete Folder" data-folder-id="${folder.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </li>
    `);
  });

  folderList.querySelectorAll(".folder-item").forEach(item => {
    item.addEventListener("click", (e) => {
      const deleteBtn = e.target.closest('.f-delete-btn');
      if(deleteBtn) {
        deleteFolder(deleteBtn.dataset.folderId, e);
        return;
      }

      const idAttr = item.getAttribute("data-id");
      currentFolderId = idAttr === "null" ? null : Number(idAttr);
      
      const folderName = idAttr === "null" ? "All Files" : folders.find(f => String(f.id) === String(currentFolderId))?.name;
      currentFolderTitle.textContent = folderName;

      renderFolders(); 
      loadFiles();     
      
      if(isMobile()) {
        leftSidebar.classList.remove('open');
        checkSidebarBackdrop();
      }
    });
  });
}

newFolderBtn.addEventListener("click", async () => {
  const name = prompt("Enter new folder name:");
  if (!name || !name.trim()) return;

  try {
    const response = await fetch("/api/trpc/file.createFolder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { name: name.trim() } })
    });

    if (!response.ok) throw new Error("Failed to create folder");
    await loadFolders();
  } catch (error) {
    console.error("Error creating folder:", error);
  }
});

window.deleteFolder = async function(idStr, event) {
  event.stopPropagation();
  if(!confirm("Delete this folder? Files inside will be moved to 'All Files'.")) return;

  try {
    const id = Number(idStr);
    const response = await fetch("/api/trpc/file.deleteFolder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { id } })
    });

    if (!response.ok) throw new Error("Failed to delete folder");

    if(String(currentFolderId) === String(id)) {
      currentFolderId = null;
      currentFolderTitle.textContent = "All Files";
      await loadFiles();
    }
    await loadFolders();
  } catch (error) {
    console.error("Error deleting folder:", error);
  }
}

/* ===================== FILE LOGIC (PRODUCTION) ===================== */
async function loadFiles(query = "") {
  try {
    let url = "";
    
    if (query) {
      url = `/api/trpc/file.search?input=${encodeURIComponent(JSON.stringify({ json: { query } }))}`;
    } else {
      const inputJson = currentFolderId !== null ? { folderId: currentFolderId } : {};
      url = `/api/trpc/file.list?input=${encodeURIComponent(JSON.stringify({ json: inputJson }))}`;
    }

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch files. Status: ${response.status}`);

    const data = await response.json();
    const resultData = data.result?.data?.json;

    if (Array.isArray(resultData)) {
      files = resultData;
    } else if (resultData && Array.isArray(resultData.files)) {
      files = resultData.files;
    } else {
      files = [];
    }

    renderFiles();
  } catch (error) {
    console.error("Error loading files:", error);
    files = []; 
    renderFiles();
  }
}

function renderFiles() {
  fileGrid.innerHTML = "";

  if (files.length === 0) {
    emptyState.classList.remove("hidden");
  } else {
    emptyState.classList.add("hidden");
  }

  files.forEach(file => {
    const isIndexed = file.isIndexed !== undefined ? file.isIndexed : file.is_indexed;
    const mimeType = file.mimeType !== undefined ? file.mimeType : file.mime_type;
    const createdAt = file.createdAt !== undefined ? file.createdAt : file.created_at;
    const fileName = file.name || "Unknown File";

    const statusHtml = isIndexed 
      ? `<div class="fc-status indexed"><div class="dot"></div>Indexed</div>`
      : `<div class="fc-status pending"><div class="dot"></div>Pending</div>`;

    // CRITICAL FIX: Inline 'onclick' removed to destroy string parsing bugs. Event delegation applied via data-file-id.
    fileGrid.insertAdjacentHTML("beforeend", `
      <div class="file-card glass-strong fade-up" data-file-id="${file.id}">
        <div class="fc-icon">
          ${getIconForMime(mimeType)}
        </div>
        <div class="fc-name" title="${escapeHTML(fileName)}">${escapeHTML(fileName)}</div>
        
        ${statusHtml}

        <div class="fc-meta">
          <div class="fc-meta-row">
            <span>Size</span>
            <span>${formatBytes(file.size)}</span>
          </div>
          <div class="fc-meta-row">
            <span>Added</span>
            <span>${formatDate(createdAt)}</span>
          </div>
        </div>

        <button class="fc-delete" title="Delete File" data-delete-id="${file.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `);
  });
}

// CRITICAL FIX: Direct listener on grid ensures ALL cards are clickable regardless of DOM overlays
fileGrid.addEventListener('click', (e) => {
  const deleteBtn = e.target.closest('.fc-delete');
  if (deleteBtn) {
    e.stopPropagation();
    deleteFile(deleteBtn.dataset.deleteId);
    return;
  }

  const fileCard = e.target.closest('.file-card');
  if (fileCard) {
    previewFile(fileCard.dataset.fileId);
  }
});

/* ===================== UPLOAD LOGIC ===================== */
uploadBtn.addEventListener("click", () => {
  hiddenFileInput.click();
});

hiddenFileInput.addEventListener("change", async (e) => {
  const selectedFiles = e.target.files;
  if (selectedFiles.length === 0) return;

  const file = selectedFiles[0];
  const originalText = uploadBtn.innerHTML;
  uploadBtn.innerHTML = `Uploading...`;
  uploadBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append("file", file);
    if (currentFolderId !== null) {
      formData.append("folderId", currentFolderId);
    }

    const response = await fetch("/api/files/upload", {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error("Server rejected upload");
    const uploadResult = await response.json();
    await loadFiles(searchInput.value.trim());

    // Kick off the LangGraph document_analysis pipeline the moment a
    // document finishes uploading. Runs in the background (not awaited)
    // so the upload button resets immediately; progress surfaces via the
    // toast in the corner, and in the file's Analysis tab if it's open.
    if (uploadResult?.fileId) {
      startDocumentAnalysis(uploadResult.fileId, file.name);
    }

  } catch (error) {
    console.error("Upload failed", error);
    alert("Upload failed. Please check network connection.");
  } finally {
    uploadBtn.innerHTML = originalText;
    uploadBtn.disabled = false;
    hiddenFileInput.value = ""; 
  }
});

/* ===================== DELETE FILE ===================== */
window.deleteFile = async function(idStr) {
  if(!confirm("Permanently delete this file? This will remove it from the knowledge base and disk.")) return;

  try {
    const file = files.find(f => String(f.id) === String(idStr));
    const targetId = file ? file.id : idStr;

    const response = await fetch("/api/trpc/file.delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ json: { id: targetId } })
    });

    if (!response.ok) throw new Error("Failed to delete file");

    await loadFiles(searchInput.value.trim());
  } catch (error) {
    console.error("Error deleting file:", error);
  }
}

/* ===================== SEARCH LOGIC ===================== */
let searchTimeout;
searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    loadFiles(e.target.value.trim());
  }, 300);
});

/* ===================== LUXURY PREVIEW MODAL LOGIC ===================== */
let currentPreviewFileId = null;
let isExtractedTextLoaded = false;

window.previewFile = function(idStr) {
  const file = files.find(f => String(f.id) === String(idStr));
  
  if (!file) {
    console.error("Could not find file with ID:", idStr);
    return;
  }

  currentPreviewFileId = file.id; 
  isExtractedTextLoaded = false;

  const mime = file.mime_type || file.mimeType || "";
  const fileName = file.name || "Unknown File";
  const ext = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  
  let pathStr = file.path || `uploads/${fileName}`;
  const url = pathStr.startsWith('/') ? pathStr : `/${pathStr}`;
  
  document.getElementById('fmTitle').textContent = fileName;
  document.getElementById('fmIcon').innerHTML = getIconForMime(mime);
  
  const downloadBtn = document.getElementById('fmDownloadBtn');
  downloadBtn.onclick = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const fmBodyPreview = document.getElementById('fmBodyPreview');
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext) || mime.includes("image");
  const isDocument = ["pdf", "txt", "md"].includes(ext) || mime.includes("pdf");

  // CRITICAL FIX: Native <object> tag deployed for PDF viewing to prevent strict browser frame blocking
  if (isImage) {
    fmBodyPreview.innerHTML = `<img src="${url}" alt="${escapeHTML(fileName)}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 50px -10px rgba(0,0,0,0.6);" />`;
  } else if (isDocument) {
    fmBodyPreview.innerHTML = `
      <object data="${url}" type="${mime || 'application/pdf'}" style="width: 100%; height: 100%; border-radius: 12px; background: #fff; box-shadow: 0 20px 50px -10px rgba(0,0,0,0.6);">
        <iframe src="${url}" style="width: 100%; height: 100%; border: none;"></iframe>
      </object>`;
  } else {
    fmBodyPreview.innerHTML = `
      <div class="unsupported" style="display: flex; flex-direction: column; align-items: center; justify-content:center; gap: 24px; color: var(--fg-muted); text-align: center; height:100%;">
        <div style="opacity:0.5; width:80px; height:80px;">${getIconForMime(mime)}</div>
        <div>
          <h3 style="font-size: 1.25rem; margin-bottom: 8px; color: #fff;">Preview Not Available</h3>
          <p>This file type (.${ext}) cannot be previewed natively.</p>
        </div>
        <button class="action-btn bg-aurora" style="padding: 12px 24px; color: #000; font-weight: 500; border-radius: 12px; border:none; cursor:pointer;" onclick="document.getElementById('fmDownloadBtn').click()">
          Download to View
        </button>
      </div>
    `;
  }

  switchModalTab('preview');
  document.getElementById('fileModal').classList.add('open');
};

window.closeFileModal = function() {
  document.getElementById('fileModal').classList.remove('open');
  document.getElementById('fmBodyPreview').classList.remove('active');
  document.getElementById('fmBodyExtracted').classList.remove('active');
  document.getElementById('fmBodyAnalysis').classList.remove('active');
  currentPreviewFileId = null;
  setTimeout(() => {
    document.getElementById('fmBodyPreview').innerHTML = ''; 
    document.getElementById('extractedContent').innerHTML = '';
  }, 300);
};

window.switchModalTab = async function(tab) {
  document.getElementById('tabPreview').classList.toggle('active', tab === 'preview');
  document.getElementById('tabExtracted').classList.toggle('active', tab === 'extracted');
  document.getElementById('tabAnalysis').classList.toggle('active', tab === 'analysis');

  document.getElementById('fmBodyPreview').classList.toggle('active', tab === 'preview');
  document.getElementById('fmBodyExtracted').classList.toggle('active', tab === 'extracted');
  document.getElementById('fmBodyAnalysis').classList.toggle('active', tab === 'analysis');

  if (tab === 'extracted' && !isExtractedTextLoaded && currentPreviewFileId !== null) {
    await loadExtractedText(currentPreviewFileId);
  }

  if (tab === 'analysis' && currentPreviewFileId !== null) {
    await loadAnalysisTab(currentPreviewFileId);
  }
};

async function loadExtractedText(fileId) {
  const loadingState = document.getElementById('extractedLoading');
  const emptyState = document.getElementById('extractedEmpty');
  const contentState = document.getElementById('extractedContent');

  loadingState.classList.remove('hidden');
  emptyState.classList.add('hidden');
  contentState.classList.add('hidden');
  contentState.innerHTML = '';

  try {
    const payload = encodeURIComponent(JSON.stringify({ json: { fileId } }));
    const response = await fetch(`/api/trpc/fileContent.getByFileId?input=${payload}`);
    
    if (!response.ok) throw new Error("Failed to fetch extracted text");

    const data = await response.json();
    
    // Support parsing 'content' and potentially 'chunks' if backend adds them
    const content = data.result?.data?.json?.content;
    const chunks = data.result?.data?.json?.chunks; 

    loadingState.classList.add('hidden');

    let htmlPayload = '';

    if (content && content.trim() !== '') {
      htmlPayload += `<div class="raw-content">${escapeHTML(content)}</div>`;
    }

    // BONUS: Exquisitely render visual Chunks if the backend happens to pass them!
    if (chunks && Array.isArray(chunks) && chunks.length > 0) {
      htmlPayload += `<div class="chunks-container">
        <h4 style="color: var(--gold-bright); margin-bottom: 16px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; font-family: var(--font);">Extracted Chunks</h4>`;
      
      chunks.forEach((chunk, index) => {
         const chunkStr = typeof chunk === 'string' ? chunk : (chunk.text || chunk.content || JSON.stringify(chunk));
         htmlPayload += `
           <div class="chunk-box glass-strong">
             <div style="font-size: 0.75rem; color: var(--fg-muted); margin-bottom: 8px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.05em;">Chunk #${chunk.id || index + 1}</div>
             <div style="font-size: 0.9rem; line-height: 1.6; color: var(--fg); white-space: pre-wrap; word-break: break-word;">${escapeHTML(chunkStr)}</div>
           </div>`;
      });
      htmlPayload += `</div>`;
    }

    if (htmlPayload !== '') {
      contentState.innerHTML = htmlPayload;
      contentState.classList.remove('hidden');
    } else {
      emptyState.classList.remove('hidden');
    }

    isExtractedTextLoaded = true;

  } catch (error) {
    console.error("Error loading extracted text:", error);
    loadingState.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.getElementById("fileModal").classList.contains("open")) {
    closeFileModal();
  }
});

/* ===================== DOCUMENT ANALYSIS (LangGraph pipeline) ===================== */
// Tracks in-flight analysis runs so a toast + the modal (if open on that
// file) both reflect the same live state, and so re-opening the modal
// while a run is still going doesn't start a second stream.
const analysisRuns = new Map(); // fileId -> { status, label, data, error }

const ANALYSIS_NODE_ORDER = ["ingestion", "summarizer", "extractor", "metadata", "synthesizer"];

function analysisToastContainer() {
  return document.getElementById("analysisToastContainer");
}

function renderToast(fileId, fileName, run) {
  const container = analysisToastContainer();
  if (!container) return;

  let toast = document.getElementById(`analysisToast-${fileId}`);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = `analysisToast-${fileId}`;
    toast.className = "analysis-toast";
    container.appendChild(toast);
  }

  toast.classList.toggle("done", run.status === "done");
  toast.classList.toggle("error", run.status === "error");

  const spinnerSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-bright)" stroke-width="2" class="spin-animation"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
  const doneSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold-bright)" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;
  const errorSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ff6b6b" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>`;

  const icon = run.status === "done" ? doneSvg : run.status === "error" ? errorSvg : spinnerSvg;
  const message = run.status === "done"
    ? "Analysis complete"
    : run.status === "error"
      ? (run.error || "Analysis failed")
      : run.label;

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-text">
      <strong>${escapeHTML(fileName)}</strong>
      <span>${escapeHTML(message)}</span>
    </div>
  `;

  if (run.status === "done" || run.status === "error") {
    setTimeout(() => {
      toast.remove();
    }, run.status === "error" ? 6000 : 3500);
  }
}

// Opens the SSE stream for a freshly uploaded (or manually re-triggered)
// file and drives both the toast and, if the file's modal happens to be
// open, the Analysis tab's live step indicator.
window.startDocumentAnalysis = function(fileId, fileName) {
  if (analysisRuns.has(fileId)) return; // already running

  const run = { status: "progress", label: "Starting analysis...", data: null, error: null };
  analysisRuns.set(fileId, run);
  renderToast(fileId, fileName, run);
  if (currentPreviewFileId === fileId) {
    renderAnalysisProgress(run);
  }

  fetch(`/api/files/${fileId}/analyze-stream`)
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error("Failed to start analysis stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          const lines = frame.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventName = eventLine.replace("event:", "").trim();
          let data;
          try {
            data = JSON.parse(dataLine.replace("data:", "").trim());
          } catch {
            continue;
          }

          if (eventName === "progress") {
            run.status = "progress";
            run.label = data.label || data.node;
            run.currentNode = data.node;
          } else if (eventName === "thinking") {
            run.status = "progress";
            run.thinking = run.thinking || {};
            run.thinking[data.node] = (run.thinking[data.node] || "") + data.token;
          } else if (eventName === "done") {
            run.status = "done";
            run.data = data;
          } else if (eventName === "error") {
            run.status = "error";
            run.error = data.error;
            run.errorNode = data.node;
          }

          // Thinking events can arrive dozens of times per second — skip
          // the toast re-render for those (progress/done/error still do)
          // to avoid needless DOM churn; the in-modal live view still
          // updates every token via renderAnalysisProgress below.
          if (eventName !== "thinking") {
            renderToast(fileId, fileName, run);
          }
          if (currentPreviewFileId === fileId) {
            renderAnalysisProgress(run);
          }
        }
      }
    })
    .catch((err) => {
      console.error("Document analysis stream error:", err);
      run.status = "error";
      run.error = err.message || "Analysis stream failed.";
      renderToast(fileId, fileName, run);
      if (currentPreviewFileId === fileId) {
        renderAnalysisProgress(run);
      }
    })
    .finally(() => {
      // Keep the finished/errored run around briefly so a modal opened
      // right after completion still shows the result instead of the
      // idle state, then drop it so a future re-analysis can start fresh.
      setTimeout(() => analysisRuns.delete(fileId), 8000);
    });
};

function renderAnalysisProgress(run) {
  const idle = document.getElementById("analysisIdle");
  const progress = document.getElementById("analysisProgress");
  const errorEl = document.getElementById("analysisError");
  const content = document.getElementById("analysisContent");

  idle.classList.add("hidden");
  errorEl.classList.add("hidden");
  content.classList.add("hidden");

  if (run.status === "progress") {
    progress.classList.remove("hidden");
    document.getElementById("analysisProgressLabel").textContent = run.label || "Analyzing...";

    const currentIdx = ANALYSIS_NODE_ORDER.indexOf(run.currentNode);
    document.querySelectorAll("#analysisSteps .analysis-step").forEach((el) => {
      const idx = ANALYSIS_NODE_ORDER.indexOf(el.dataset.node);
      el.classList.toggle("active", idx === currentIdx);
      el.classList.toggle("done", idx !== -1 && currentIdx !== -1 && idx < currentIdx);
    });

    // Live model output ("thinking") for whichever node is currently
    // streaming — raw JSON tokens as Ollama emits them, so you can watch
    // the model actually working instead of just a static spinner.
    let thinkingEl = document.getElementById("analysisThinking");
    if (!thinkingEl) {
      thinkingEl = document.createElement("div");
      thinkingEl.id = "analysisThinking";
      thinkingEl.className = "analysis-thinking";
      progress.appendChild(thinkingEl);
    }
    const liveText = (run.thinking && run.thinking[run.currentNode]) || "";
    if (liveText) {
      thinkingEl.classList.remove("hidden");
      thinkingEl.textContent = liveText;
      thinkingEl.scrollTop = thinkingEl.scrollHeight;
    } else {
      thinkingEl.classList.add("hidden");
    }
    return;
  }

  progress.classList.add("hidden");

  if (run.status === "error") {
    errorEl.classList.remove("hidden");
    const nodeLabel = run.errorNode ? ` (${run.errorNode} stage)` : "";
    document.getElementById("analysisErrorText").textContent = (run.error || "Analysis failed.") + nodeLabel;
    return;
  }

  if (run.status === "done" && run.data) {
    content.classList.remove("hidden");
    content.innerHTML = buildAnalysisHTML(run.data);
  }
}

function buildAnalysisHTML(analysis) {
  const entities = analysis.entities || {};
  const metadata = analysis.metadata || {};

  // The extraction model is prompted to return plain strings, but local
  // models occasionally return objects instead (e.g. {"name": "..."} or
  // {"person": "..."}). Rather than let String(v) collapse those to the
  // literal text "[object Object]", pull out the first sensible-looking
  // field, falling back to a compact JSON preview only as a last resort.
  const displayValue = (v) => {
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    if (v && typeof v === "object") {
      const candidateKeys = ["name", "value", "text", "label", "title", "person", "organization"];
      for (const key of candidateKeys) {
        if (typeof v[key] === "string" && v[key]) return v[key];
      }
      const firstString = Object.values(v).find((x) => typeof x === "string" && x);
      if (firstString) return firstString;
      return JSON.stringify(v);
    }
    return String(v);
  };

  const entitySection = (label, list) => {
    if (!list || list.length === 0) return "";
    return `
      <div class="analysis-section-title">${escapeHTML(label)}</div>
      <div class="analysis-tags">
        ${list.map((v) => `<span class="analysis-tag">${escapeHTML(displayValue(v))}</span>`).join("")}
      </div>
    `;
  };

  return `
    <div class="analysis-summary">${escapeHTML(analysis.summary || "No summary available.")}</div>

    ${entitySection("People", entities.people)}
    ${entitySection("Organizations", entities.organizations)}
    ${entitySection("Locations", entities.locations)}
    ${entitySection("Dates", entities.dates)}
    ${entitySection("Technologies", entities.technologies)}
    ${entitySection("Keywords", analysis.keywords)}
    ${entitySection("Topics", analysis.topics)}

    <div class="analysis-meta">
      <span>Language: ${escapeHTML(metadata.language || "Unknown")}</span>
      <span>Type: ${escapeHTML(metadata.document_type || "Unknown")}</span>
      <span>Confidence: ${metadata.confidence != null ? Math.round(metadata.confidence * 100) + "%" : "—"}</span>
    </div>
  `;
}

// Called when the Analysis tab is opened. If a run is already live for
// this file, renders its current state. Otherwise fetches the last
// persisted result from the DB (document_analysis table) so previously
// analyzed files show their result without re-running the pipeline.
async function loadAnalysisTab(fileId) {
  const idle = document.getElementById("analysisIdle");
  const progress = document.getElementById("analysisProgress");
  const errorEl = document.getElementById("analysisError");
  const content = document.getElementById("analysisContent");

  const liveRun = analysisRuns.get(fileId);
  if (liveRun) {
    renderAnalysisProgress(liveRun);
    return;
  }

  idle.classList.add("hidden");
  progress.classList.add("hidden");
  errorEl.classList.add("hidden");
  content.classList.add("hidden");

  try {
    const response = await fetch(`/api/files/${fileId}/analysis`);
    const data = await response.json();
    const row = data?.analysis;

    if (!row || row.status !== "complete") {
      idle.classList.remove("hidden");
      const runBtn = document.getElementById("runAnalysisBtn");
      if (runBtn) {
        runBtn.onclick = () => {
          const file = files.find((f) => String(f.id) === String(fileId));
          startDocumentAnalysis(fileId, file?.name || "Document");
          renderAnalysisProgress(analysisRuns.get(fileId));
        };
      }
      return;
    }

    content.classList.remove("hidden");
    content.innerHTML =
      buildAnalysisHTML({
        summary: row.summary,
        entities: row.entities,
        keywords: row.keywords,
        topics: row.topics,
        metadata: {
          language: row.language,
          document_type: row.documentType,
          confidence: row.confidence,
        },
      }) +
      `<button class="analysis-reanalyze-btn" id="reanalyzeBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
        Re-analyze
      </button>`;

    const reanalyzeBtn = document.getElementById("reanalyzeBtn");
    if (reanalyzeBtn) {
      reanalyzeBtn.onclick = () => {
        const file = files.find((f) => String(f.id) === String(fileId));
        // Force a fresh run even if a stale entry is still cooling down
        // in analysisRuns from a previous run's 8s post-completion window.
        analysisRuns.delete(fileId);
        startDocumentAnalysis(fileId, file?.name || "Document");
        renderAnalysisProgress(analysisRuns.get(fileId));
      };
    }
  } catch (err) {
    console.error("Failed to load analysis:", err);
    idle.classList.remove("hidden");
  }
}

/* ===================== INITIALIZE ===================== */
(async () => {
  await loadFolders();
  await loadFiles();
})();
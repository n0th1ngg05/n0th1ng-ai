// ═══════════════════════════════════════════════════════════════════════
// Rendering engine — pure SVG, no framework, curved bezier data-flow pipes
// with animated traveling packets.
// ═══════════════════════════════════════════════════════════════════════

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

// ── Tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

// ── Topology map ──────────────────────────────────────────────────────
function nodeCenter(n) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}
function nodeEdgePoint(n, towardX, towardY) {
  // pick the anchor on the node box nearest the direction of travel
  const c = nodeCenter(n);
  const dx = towardX - c.x, dy = towardY - c.y;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx > 0 ? n.x + n.w : n.x, y: c.y };
  }
  return { x: c.x, y: dy > 0 ? n.y + n.h : n.y };
}

function renderTopology() {
  const svg = document.getElementById("topoSvg");
  svg.innerHTML = "";

  // defs
  const defs = svgEl("defs");
  const glow = svgEl("filter", { id: "softGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  glow.innerHTML = '<feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(glow);
  svg.appendChild(defs);

  // tier backdrops
  const tiers = [
    { label: "CLIENT", x: 40, y: 40, w: 320, h: 180 },
    { label: "MASTER NODE — LAPTOP (api-master)", x: 460, y: 10, w: 590, h: 560 },
    { label: "WORKER NODE — DESKTOP (RTX 4050)", x: 460, y: 590, w: 830, h: 260 },
  ];
  tiers.forEach(t => {
    svg.appendChild(svgEl("rect", {
      x: t.x, y: t.y, width: t.w, height: t.h, rx: 14,
      fill: "rgba(255,255,255,.012)", stroke: "var(--hairline-soft)", "stroke-width": 1, "stroke-dasharray": "3 4",
    }));
    const lbl = svgEl("text", { x: t.x + 16, y: t.y + 22, class: "tier-label" });
    lbl.textContent = t.label;
    svg.appendChild(lbl);
  });

  const nodesById = {};
  TOPOLOGY.nodes.forEach(n => nodesById[n.id] = n);

  // edges (draw first, under nodes)
  const edgeGroup = svgEl("g");
  svg.appendChild(edgeGroup);
  TOPOLOGY.edges.forEach(e => {
    const a = nodesById[e.from], b = nodesById[e.to];
    if (!a || !b) return;
    const ca = nodeCenter(a), cb = nodeCenter(b);
    const p1 = nodeEdgePoint(a, cb.x, cb.y);
    const p2 = nodeEdgePoint(b, ca.x, ca.y);
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const c1x = p1.x + dx * 0.5, c1y = p1.y + dy * 0.15;
    const c2x = p1.x + dx * 0.5, c2y = p1.y + dy * 0.85;
    const d = `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;

    const path = svgEl("path", { d, class: `edge-path edge-${e.kind}`, id: `edge-${e.from}-${e.to}` });
    edgeGroup.appendChild(path);

    // traveling packet
    const packet = svgEl("circle", { class: `packet packet-${e.kind}` });
    const anim = svgEl("animateMotion", {
      dur: (3 + Math.random() * 2).toFixed(1) + "s",
      repeatCount: "indefinite",
      path: d,
    });
    packet.appendChild(anim);
    edgeGroup.appendChild(packet);

    // caption at midpoint
    const midX = p1.x + dx * 0.5, midY = p1.y + dy * 0.5;
    const cap = svgEl("text", { x: midX, y: midY - 5, class: "edge-caption", "text-anchor": "middle" });
    cap.textContent = e.label;
    edgeGroup.appendChild(cap);
  });

  // nodes
  const nodeGroup = svgEl("g");
  svg.appendChild(nodeGroup);
  TOPOLOGY.nodes.forEach(n => {
    const g = svgEl("g", { style: "cursor:pointer" });
    const box = svgEl("rect", {
      x: n.x, y: n.y, width: n.w, height: n.h, rx: 8,
      class: `node-box ${n.tag}`,
    });
    g.appendChild(box);

    const label = svgEl("text", { x: n.x + 16, y: n.y + 30, class: "node-label" });
    label.textContent = n.label;
    g.appendChild(label);

    const sub = svgEl("text", { x: n.x + 16, y: n.y + 48, class: "node-sub" });
    sub.textContent = n.sub;
    g.appendChild(sub);

    // status pulse dot
    const dot = svgEl("circle", { cx: n.x + n.w - 16, cy: n.y + 18, r: 4, fill: "var(--ok)" });
    const pulse = svgEl("animate", { attributeName: "opacity", values: "1;0.3;1", dur: "2s", repeatCount: "indefinite" });
    dot.appendChild(pulse);
    g.appendChild(dot);

    g.addEventListener("click", () => selectNode(n));
    nodeGroup.appendChild(g);
  });
}

function selectNode(n) {
  document.querySelectorAll(".node-box").forEach(b => b.style.strokeWidth = "1.4");
  const insp = document.getElementById("inspector");

  const tagLabel = n.tag === "master" ? "Master" : n.tag === "db" ? "Data Layer" : "Worker";

  insp.innerHTML = `
    <span class="insp-tag ${n.tag}">${tagLabel}</span>
    <div class="insp-title">${n.label}</div>
    <div class="insp-desc">${n.desc}</div>
    <div class="insp-section-lbl">Source Files</div>
    <div>${n.files.map(f => `<span class="file-chip ${n.tag === 'master' ? 'm' : n.tag === 'db' ? 'd' : ''}">${escapeHtml(f)}</span>`).join("")}</div>
    <div class="insp-section-lbl">Key Behaviors</div>
    <ul class="insp-list">${n.points.map(p => `<li>${escapeHtml(p)}</li>`).join("")}</ul>
  `;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Generic flow-diagram renderer (used by chat/cluster/speech tabs) ──
function renderFlow(svgId, steps, width = 1200) {
  const svg = document.getElementById(svgId);
  svg.innerHTML = "";

  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "arrowhead", markerWidth: "8", markerHeight: "8", refX: "6", refY: "3", orient: "auto",
  });
  marker.innerHTML = '<path d="M0,0 L6,3 L0,6 Z" fill="var(--hairline)"/>';
  defs.appendChild(marker);
  svg.appendChild(defs);

  const boxW = width - 160;
  const boxX = 80;
  let y = 20;

  steps.forEach((step, i) => {
    const h = 60 + Math.ceil(step.body.length / 70) * 16 + (step.file ? 20 : 0);

    if (step.branch) {
      // draw a branch label off to the side, doesn't consume main flow vertical space beyond box height
    }

    const boxClass = step.master ? "step-box master" : step.branch ? "step-box branch" : i === 0 ? "step-box accent" : "step-box";
    const rect = svgEl("rect", { x: boxX, y, width: boxW, height: h, rx: 8, class: boxClass });
    svg.appendChild(rect);

    const num = svgEl("text", { x: boxX + 18, y: y + 24, class: "step-num" });
    num.textContent = step.num || String(i + 1).padStart(2, "0");
    svg.appendChild(num);

    const title = svgEl("text", { x: boxX + 56, y: y + 24, class: "step-title" });
    title.textContent = step.title;
    svg.appendChild(title);

    // wrap body text
    const words = step.body.split(" ");
    let line = "", lines = [], maxChars = 100;
    words.forEach(w => {
      if ((line + " " + w).trim().length > maxChars) { lines.push(line.trim()); line = w; }
      else line += " " + w;
    });
    if (line.trim()) lines.push(line.trim());
    lines.forEach((ln, li) => {
      const t = svgEl("text", { x: boxX + 56, y: y + 42 + li * 15, class: "step-body" });
      t.textContent = ln;
      svg.appendChild(t);
    });

    if (step.file) {
      const f = svgEl("text", { x: boxX + 56, y: y + 42 + lines.length * 15 + 4, class: "step-file" });
      f.textContent = "→ " + step.file;
      svg.appendChild(f);
    }

    // connecting arrow to next
    if (i < steps.length - 1) {
      const nextY = y + h + 34;
      const arrow = svgEl("path", {
        d: `M ${boxX + boxW / 2} ${y + h} L ${boxX + boxW / 2} ${nextY - 2}`,
        class: "flow-arrow" + (step.hot ? " hot" : ""),
      });
      svg.appendChild(arrow);
    }

    y += h + 34;
  });

  svg.setAttribute("viewBox", `0 0 ${width} ${y + 20}`);
}

// ── Flow content (drawn from real source logic) ────────────────────────
const CHAT_STEPS = [
  { title: "Frontend sends request", body: "chatspace/chat.js POSTs prompt, model, conversationId, selectedFiles, uploadedAttachments, responseMode to /api/chat/stream.", file: "boot.ts:183" },
  { title: "Attachment context search", body: "If conversationId is present, searchChatAttachments() runs a semantic search over that conversation's uploaded files and injects up to 8 matching chunks.", file: "services/chatAttachmentSearch.ts" },
  { title: "Memory + conversation history load", body: "Loads conversation memory and prior messages — voice vs text conversations use separate tables/functions. If message count ≥ 20 and no summary exists yet, summarizeConversation() is triggered and cached to the DB.", file: "services/conversationMemory.ts, conversationSummary.ts" },
  { title: "5-stage tool router decision", master: true, body: "shouldUseTools() runs the cascade: heuristic pre-check → yes/no gate on the main model → regex pattern match → qwen3:0.6b native tool-calling fallback. Produces mode: CHAT | TOOL | RAG | TOOL_RAG.", file: "services/toolRouter.ts" },
  { title: "Tool execution (if TOOL / TOOL_RAG)", body: "processTools() resolves each ToolCall against uploadedAttachments, dispatches through toolExecutor.ts, which in turn calls cluster.ts's executeClusterTool() to run locally or on a remote worker.", file: "services/toolPipeline.ts → cluster.ts" },
  { title: "RAG context build (if not skipped)", body: "buildRagPrompt() calls searchKnowledge() against the knowledge_chunks + chunk_embeddings tables using cosine similarity over nomic-embed-text vectors, capped at 8000 characters of context.", file: "services/rag.ts, semanticSearch.ts" },
  { title: "Final prompt assembly", body: "memoryContext + attachmentContext + toolContext + ragPrompt (or finalConversationContext) are concatenated into one prompt string, logged in full to the console for debugging.", file: "boot.ts (FINAL PROMPT block)" },
  { title: "Ollama streaming generation", hot: true, body: "POST http://localhost:11434/api/generate with stream:true and a 120s AbortController timeout. supportsThinking() adds think:true for qwen3/qwen3.5 models. Non-2xx responses return a clean 502/504 instead of silently flushing zero tokens.", file: "boot.ts (Ollama fetch block)" },
  { title: "Live NDJSON → SSE transform", body: "Ollama's raw NDJSON lines are parsed and re-emitted as {response, thinking} tokens the frontend's processLine() expects." },
  { title: "Sentence-boundary TTS dispatch (voice mode)", branch: true, body: "In voice/text+voice response mode, a streaming sentence parser scans accumulated tokens for genuine sentence boundaries (handling decimals, abbreviations like 'Dr.', and mid-abbreviation periods) and dispatches each finished sentence to speechManager.synthesize() immediately — audio starts before the LLM has finished generating." },
];

const CLUSTER_STEPS = [
  { title: "Worker boots & registers", body: "src-worker/server.ts calls getCapabilities() (GPU model, tool list, provider list via systeminformation) and getRuntimeStatus(), then POSTs to {LAPTOP}/api/cluster/register.", file: "src-worker/src/server.ts" },
  { title: "Master accepts registration", master: true, body: "POST /api/cluster/register → registerWorker(worker). A brand-new worker gets the full 13-line console banner; a repeat registration from an already-known worker is a silent, quiet refresh — avoids log spam from the 5s retry loop.", file: "boot.ts:1741, services/cluster.ts" },
  { title: "Heartbeat loop takes over", body: "Once connected, the worker's registration loop stops and a lighter heartbeat loop begins — POST /api/cluster/heartbeat every 5s with live CPU/RAM/GPU stats and current job count. Exactly one of the two loops is ever active.", file: "src-worker/src/server.ts (state machine)" },
  { title: "Master tracks liveness", master: true, body: "heartbeat(workerId, stats) updates the in-memory Worker record. A separate setInterval(removeOfflineWorkers, 5000) in boot.ts prunes any worker whose lastHeartbeat exceeds HEARTBEAT_TIMEOUT (15000ms).", file: "services/cluster.ts" },
  { title: "Tool call needs dispatch", master: true, body: "chatpipeline calls executeClusterTool(tool, toolCall, localExecutor). selectWorker(tool) filters online workers advertising that tool (and, for Python-backed tools, requiring runtimes.python true), sorted by currentJobs ascending — least-busy worker wins.", file: "services/cluster.ts" },
  { title: "Remote execution over HTTP", body: "executeRemote() POSTs the ToolCall to the chosen worker's /execute endpoint. worker.currentJobs is incremented before the call and decremented in a finally block regardless of outcome.", file: "services/workerClient.ts" },
  { title: "Worker executes & responds", body: "POST /execute → startJob() → executeTool(toolCall). Python-runtime-backed tools are forwarded to the worker's local FastAPI runtime (port 8002); native tools (calculator, internet_search, url_reader, research_query) run in-process. finishJob() logs duration and status.", file: "src-worker/src/server.ts, executor.ts" },
  { title: "Graceful fallback on failure", master: true, body: "If the remote call throws, the worker is marked offline immediately (no waiting for the next heartbeat timeout) and the tool falls back to the local Python runtime (if PYTHON_TOOLS has it) or the local in-process executor.", file: "services/cluster.ts (executeClusterTool catch block)" },
];

const SPEECH_STEPS = [
  { title: "Request enters speechManager", master: true, body: "synthesize(request) or transcribe(request) validates the request, resolves a Profile (provider + model + voice + tuning sliders), and looks up the matching ITTSProvider/ISTTProvider from providerManager.", file: "speech/manager/speechManager.ts" },
  { title: "Runtime start (lazy, routed)", body: "runtimeManager.startRuntime(providerId) triggers PythonRuntime.start(). No child process is spawned here — it just checks selectWorker('speech') to decide whether requests should route to a cluster worker or the local runtime the operator started manually.", file: "speech/runtimes/pythonRuntime.ts" },
  { title: "Cluster-first HTTP client selection", master: true, body: "getHttpClient() re-checks selectWorker('speech') on every call: worker online → ClusterHttpClient targets that worker's IP:port; otherwise falls back to the local 127.0.0.1:9000 client.", file: "speech/runtimes/pythonRuntime.ts, clusterHttpClient.ts" },
  { title: "Cluster dispatch with fallback", body: "executeClusterSpeech() POSTs the SpeechHttpRequest to {worker.ip}:{worker.port}/speech with a 300s timeout via AbortController. Any failure (timeout, non-2xx, network error) logs a warning and transparently falls back to the local executor.", file: "speech/services/clusterSpeech.ts" },
  { title: "Worker's /speech proxy", body: "src-worker's POST /speech receives the forwarded request, calls forwardSpeech() (speechGateway.ts) which relays it into the worker machine's own local speech-runtime on port 9000, then streams the response (JSON or raw audio bytes) back through.", file: "src-worker/src/speechGateway.ts" },
  { title: "Speech-runtime provider registry", body: "The 74-file FastAPI service (speech-runtime/) routes the request through providers/registry.py to one of 7 registered engines: kokoro, whisper, xtts, fishspeech, dia, chatterbox, piper — each implementing a common ITTSProvider/ISTTProvider-style interface.", file: "speech-runtime/providers/*.py" },
  { title: "Standalone engine process (Kokoro example)", branch: true, body: "Some engines (Kokoro, Chatterbox, FishSpeech) run as fully separate FastAPI microservices, started independently via launcher.py, exposing a minimal shared contract: GET /v1/health, POST /v1/tts. This isolates GPU memory per-engine so one crashing model doesn't take down the whole speech stack.", file: "kokoro-engines-worker/source/api_server.py" },
  { title: "Audio pipeline & response", body: "Generated audio passes through audio/normalizer.py, resampler.py, and converter.py before being encoded to WAV/MP3 and returned up the chain — through the worker's /speech proxy, back through clusterSpeech.ts, and finally into the sentence-buffered voice playback on the frontend.", file: "speech-runtime/audio/*.py" },
];

// ── Init ──────────────────────────────────────────────────────────────
renderTopology();
renderFlow("chatSvg", CHAT_STEPS, 1150);
renderFlow("clusterSvg", CLUSTER_STEPS, 1150);
renderFlow("speechSvg", SPEECH_STEPS, 1150);

window.addEventListener("resize", () => { /* viewBox scaling handles responsiveness */ });
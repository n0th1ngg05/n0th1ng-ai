import "./style.css";

// ── Constants ────────────────────────────────────────────────────────────────
const HUD_TOKEN    = (import.meta as any).env?.VITE_HUD_TOKEN ?? "";
const WORKER_URL   = "http://localhost:3001";
const EXPOSE_URL   = ""; // relative via Vite proxy

// ── Auth header helper ────────────────────────────────────────────────────────
function authHeaders(): HeadersInit {
    return { Authorization: `Bearer ${HUD_TOKEN}` };
}

// ── Clock ─────────────────────────────────────────────────────────────────────
function startClock() {
    const clockEl = document.getElementById("systemClock")!;
    const dateEl  = document.getElementById("systemDate")!;
    const tick = () => {
        const now = new Date();
        clockEl.textContent = now.toTimeString().slice(0, 8);
        dateEl.textContent  = now.toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "2-digit", year: "numeric"
        }).toUpperCase();
    };
    tick();
    setInterval(tick, 1000);
}

// ── Gauge arc helper ──────────────────────────────────────────────────────────
// Arc total length = ~141 for the semicircle with r=45
const ARC_LEN = 141;

function setGauge(arcId: string, valId: string, pct: number, label: string) {
    const arc = document.getElementById(arcId) as SVGPathElement | null;
    const val = document.getElementById(valId);
    if (!arc || !val) return;
    const filled = (Math.min(Math.max(pct, 0), 100) / 100) * ARC_LEN;
    arc.setAttribute("stroke-dasharray", `${filled} ${ARC_LEN}`);
    val.textContent = label;
}

// ── Sparkline canvas ──────────────────────────────────────────────────────────
const RX_HISTORY: number[] = Array(60).fill(0);
const TX_HISTORY: number[] = Array(60).fill(0);

function drawSparkline(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = 50;
    ctx.clearRect(0, 0, W, H);

    const maxVal = Math.max(...RX_HISTORY, ...TX_HISTORY, 1);
    const stepX  = W / (RX_HISTORY.length - 1);

    const drawLine = (data: number[], color: string) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 6;
        data.forEach((v, i) => {
            const x = i * stepX;
            const y = H - (v / maxVal) * (H - 4);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    };

    drawLine(RX_HISTORY, "#00ff88");
    drawLine(TX_HISTORY, "#00c8ff");
}

// ── Status polling — single call to /internal/status covers everything ─────────
let sparklineCanvas: HTMLCanvasElement;

async function pollStatus() {
    try {
        // One call through the Vite proxy (which injects HUD_TOKEN automatically).
        // The response now includes runtime health checked server-side — no CORS issues.
        const res = await fetch("/internal/status");
        if (res.ok) {
            const s: {
                exposed: boolean;
                tunnelUrl: string | null;
                toggleMode: "AUTO" | "FORCE_ON" | "FORCE_OFF";
                masterConnected: boolean;
                autoTimerActive: boolean;
                timeUntilAutoMs: number | null;
                runtimes: { python: boolean; speech: boolean; worker: boolean; expose: boolean };
            } = await res.json();

            updateMasterStatus(s.masterConnected);
            updateExposurePanel(s);

            // Update all runtime indicators from the server-side health checks
            updateRuntimeItem("rtPython", s.runtimes.python);
            updateRuntimeItem("rtSpeech", s.runtimes.speech);
            updateRuntimeItem("rtWorker", s.runtimes.worker);
            updateRuntimeItem("rtExpose", s.runtimes.expose);
        } else {
            // Exposure service responded with non-200 (shouldn't happen after auth fix)
            updateRuntimeItem("rtExpose", false);
        }
    } catch {
        // Exposure service unreachable
        updateRuntimeItem("rtExpose", false);
    }
}

async function pollMetricsFromCapabilities() {
    try {
        // Fetch live vitals from the worker's capabilities endpoint (adds minimal overhead)
        const res = await fetch(`${WORKER_URL}/ping`);
        if (!res.ok) return;

        // Since we don't have a dedicated /capabilities endpoint exposed, we use
        // the /internal/status data from the exposure service (which runs systeminformation)
        // and fall back to reading /internal/metrics snapshots from the DB.
        const mRes = await fetch("/internal/metrics", { headers: authHeaders() });
        if (!mRes.ok) return;

        const { snapshots } = await mRes.json() as { snapshots: any[]; history: any[]; accessLogs: any[] };
        if (!snapshots?.length) return;

        // Use latest snapshot for current vitals
        const latest = snapshots[0];
        setGauge("cpuArc", "cpuVal", latest.cpu_pct ?? 0, `${Math.round(latest.cpu_pct ?? 0)}%`);
        setGauge("ramArc", "ramVal", ((latest.ram_gb ?? 0) / 64) * 100, `${(latest.ram_gb ?? 0).toFixed(1)} GB`);
        setGauge("gpuArc", "gpuVal", latest.gpu_pct ?? 0, `${Math.round(latest.gpu_pct ?? 0)}%`);

        const cpuTempEl = document.getElementById("cpuTemp")!;
        const gpuTempEl = document.getElementById("gpuTemp")!;
        cpuTempEl.textContent = latest.cpu_temp != null ? `${Math.round(latest.cpu_temp)}°C` : "--°C";
        gpuTempEl.textContent = latest.gpu_temp != null ? `${Math.round(latest.gpu_temp)}°C` : "--°C";
        cpuTempEl.className = `temp-val${(latest.cpu_temp ?? 0) > 90 ? " crit" : (latest.cpu_temp ?? 0) > 75 ? " hot" : ""}`;
        gpuTempEl.className = `temp-val${(latest.gpu_temp ?? 0) > 85 ? " crit" : (latest.gpu_temp ?? 0) > 70 ? " hot" : ""}`;

        // Network sparkline
        const rxKb = Math.round((latest.rx_bps ?? 0) / 1024);
        const txKb  = Math.round((latest.tx_bps ?? 0) / 1024);
        RX_HISTORY.push(rxKb); RX_HISTORY.shift();
        TX_HISTORY.push(txKb); TX_HISTORY.shift();
        document.getElementById("rxVal")!.textContent = `${rxKb > 1024 ? (rxKb/1024).toFixed(1)+" MB" : rxKb+" KB"}/s`;
        document.getElementById("txVal")!.textContent = `${txKb > 1024 ? (txKb/1024).toFixed(1)+" MB" : txKb+" KB"}/s`;
        drawSparkline(sparklineCanvas);

    } catch {
        // silently ignore — polling
    }
}

async function pollHistory() {
    try {
        const mRes = await fetch("/internal/metrics");
        if (!mRes.ok) return;
        const { history } = await mRes.json() as { history: any[] };
        renderHistoryTable(history ?? []);
    } catch {}
}

// ── Master status ─────────────────────────────────────────────────────────────
function updateMasterStatus(connected: boolean) {
    const dot   = document.getElementById("masterDot")!;
    const label = document.getElementById("masterLabel")!;
    dot.className   = `status-dot ${connected ? "connected" : "disconnected"}`;
    label.textContent = connected ? "MASTER CONNECTED" : "MASTER OFFLINE";
}

// ── Runtime items ─────────────────────────────────────────────────────────────
function updateRuntimeItem(id: string, online: boolean) {
    const el = document.getElementById(id)!;
    if (!el) return;
    el.className = `runtime-item ${online ? "online" : "offline"}`;
    el.querySelector(".rt-status")!.textContent = online ? "ONLINE" : "OFFLINE";
}

// ── Exposure panel ────────────────────────────────────────────────────────────
function updateExposurePanel(s: {
    exposed: boolean;
    tunnelUrl: string | null;
    toggleMode: string;
    autoTimerActive: boolean;
    timeUntilAutoMs: number | null;
}) {
    const panel     = document.querySelector(".exposure-panel")!;
    const statusLbl = document.getElementById("expStatusLabel")!;
    const urlEl     = document.getElementById("expUrl")!;
    const timerEl   = document.getElementById("expTimer")!;
    const copyRow   = document.getElementById("expCopyRow")!;
    const urlInput  = document.getElementById("expUrlInput") as HTMLInputElement;

    if (s.exposed) {
        panel.classList.add("exposed");
        statusLbl.textContent = "INTERNET EXPOSED";
        urlEl.textContent     = s.tunnelUrl ?? "";
        timerEl.textContent   = "";
        if (s.tunnelUrl) {
            copyRow.style.display = "flex";
            urlInput.value = s.tunnelUrl;
        }
    } else {
        panel.classList.remove("exposed");
        copyRow.style.display = "none";
        urlEl.textContent     = "";
        if (s.autoTimerActive && s.timeUntilAutoMs != null) {
            const min  = Math.floor(s.timeUntilAutoMs / 60000);
            const sec  = Math.floor((s.timeUntilAutoMs % 60000) / 1000);
            statusLbl.textContent = "LOCAL — AUTO PENDING";
            timerEl.textContent   = `Auto-expose in ${min}m ${sec}s`;
        } else {
            statusLbl.textContent = "LOCAL ONLY";
            timerEl.textContent   = "";
        }
    }

    // Highlight active toggle button
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        (btn as HTMLElement).classList.toggle("active", (btn as HTMLElement).dataset.mode === s.toggleMode);
    });
}

// ── History table ─────────────────────────────────────────────────────────────
function renderHistoryTable(history: any[]) {
    const tbody = document.getElementById("historyTableBody")!;
    if (!history.length) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="5">No history yet</td></tr>`;
        return;
    }
    tbody.innerHTML = history.slice(0, 50).map(row => {
        const ts = new Date(row.started_at).toLocaleTimeString();
        const dur = row.duration_ms < 1000
            ? `${row.duration_ms}ms`
            : `${(row.duration_ms / 1000).toFixed(1)}s`;
        const src = row.source === "remote"
            ? `<span class="tag-remote">REMOTE</span>`
            : `<span class="tag-local">LOCAL</span>`;
        const status = row.success
            ? `<span class="tag-success">OK</span>`
            : `<span class="tag-fail">FAIL</span>`;
        return `<tr><td>${ts}</td><td>${row.tool}</td><td>${dur}</td><td>${src}</td><td>${status}</td></tr>`;
    }).join("");
}

// ── Active jobs (polled via worker ping hack — real data comes from logs) ──────
// We can't directly read in-memory job state cross-process, so we maintain
// a light set from the log stream (see log parser below).
const activeJobs = new Map<string, { tool: string; startedAt: number; source: string }>();

function renderJobsTable() {
    const tbody = document.getElementById("jobsTableBody")!;
    const badge = document.getElementById("jobCount")!;
    badge.textContent = String(activeJobs.size);

    if (!activeJobs.size) {
        tbody.innerHTML = `<tr class="empty-row"><td colspan="4">No active jobs</td></tr>`;
        return;
    }

    tbody.innerHTML = [...activeJobs.entries()].map(([id, j]) => {
        const elapsed = Date.now() - j.startedAt;
        const dur = elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
        const src = j.source === "remote"
            ? `<span class="tag-remote">REMOTE</span>`
            : `<span class="tag-local">LOCAL</span>`;
        return `<tr><td>#${id}</td><td>${j.tool}</td><td>${dur}</td><td>${src}</td></tr>`;
    }).join("");
}

// Keep elapsed times updating
setInterval(renderJobsTable, 500);

// ── Log SSE stream ────────────────────────────────────────────────────────────
const MAX_LOG_LINES = 300;
const logLines: Array<{ ts: number; src: string; stream: string; line: string }> = [];
let logFilter = "";

function appendLogLine(entry: { source: string; stream: string; line: string; timestamp: number }) {
    logLines.push({ ts: entry.timestamp, src: entry.source, stream: entry.stream, line: entry.line });
    if (logLines.length > MAX_LOG_LINES) logLines.shift();

    // Parse for job start/finish from worker logs
    const m = entry.line.match(/\[WORKER\] Tool\s*:\s*(.+)/);
    if (m) {
        // We see a tool starting — add a tentative active job
        const tool = m[1].trim();
        const id   = `${entry.timestamp}`;
        activeJobs.set(id, { tool, startedAt: entry.timestamp, source: "local" });
        setTimeout(() => activeJobs.delete(id), 300_000); // auto-clean after 5 min if no finish
    }
    const done = entry.line.match(/Duration\s*:\s*(\d+)\s*ms/);
    if (done) {
        // Best-effort: delete the oldest active job (the one that just finished)
        const oldest = [...activeJobs.keys()][0];
        if (oldest) activeJobs.delete(oldest);
    }

    renderLogBody();
}

function renderLogBody() {
    const body = document.getElementById("logBody")!;
    const filtered = logFilter
        ? logLines.filter(l =>
            logFilter === "kokoro"
                ? /kokoro/i.test(l.line)
                : l.src === logFilter
          )
        : logLines;

    body.innerHTML = filtered.slice(-150).map(l => {
        const ts  = new Date(l.ts).toLocaleTimeString();
        const cls = l.stream === "stderr" ? " stderr" : "";
        return `<div class="log-line">
            <span class="log-ts">${ts}</span>
            <span class="log-src ${l.src}">${l.src.toUpperCase()}</span>
            <span class="log-text${cls}">${escHtml(l.line)}</span>
        </div>`;
    }).join("");

    // Auto-scroll to bottom
    body.scrollTop = body.scrollHeight;
}

function escHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function startLogStream(source: string) {
    const url = `/logs/stream${source ? `?source=${source}` : ""}`;
    const es  = new EventSource(url);
    es.onmessage = (ev) => {
        try {
            const entry = JSON.parse(ev.data);
            appendLogLine(entry);
        } catch {}
    };
    es.onerror = () => {
        // Reconnect handled by browser EventSource automatically
    };
    return es;
}

// ── Toggle button wiring ──────────────────────────────────────────────────────
function wireToggleButtons() {
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
            const mode = (btn as HTMLElement).dataset.mode;
            try {
                await fetch("/internal/toggle", {
                    method: "POST",
                    headers: { ...authHeaders(), "Content-Type": "application/json" },
                    body: JSON.stringify({ mode }),
                });
            } catch (e) {
                console.error("Toggle failed:", e);
            }
        });
    });

    document.getElementById("copyBtn")?.addEventListener("click", () => {
        const url = (document.getElementById("expUrlInput") as HTMLInputElement).value;
        navigator.clipboard.writeText(url).then(() => {
            const btn = document.getElementById("copyBtn")!;
            btn.textContent = "COPIED!";
            setTimeout(() => btn.textContent = "COPY", 1500);
        });
    });
}

// ── Log tab wiring ────────────────────────────────────────────────────────────
function wireLogTabs() {
    document.querySelectorAll(".log-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            document.querySelectorAll(".log-tab").forEach(t => t.classList.remove("active"));
            tab.classList.add("active");
            logFilter = (tab as HTMLElement).dataset.src ?? "";
            renderLogBody();
        });
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
    startClock();
    wireToggleButtons();
    wireLogTabs();

    sparklineCanvas = document.getElementById("netSparkline") as HTMLCanvasElement;

    // Mark all runtimes as checking initially
    ["rtPython", "rtSpeech", "rtWorker", "rtExpose"].forEach(id => {
        const el = document.getElementById(id)!;
        el.className = "runtime-item checking";
        el.querySelector(".rt-status")!.textContent = "CHECKING";
    });

    // Start log stream (all sources)
    startLogStream("");

    // Poll status every 3s
    pollStatus();
    setInterval(pollStatus, 3000);

    // Poll metrics + history every 15s
    pollHistory();
    setInterval(pollHistory, 15_000);
}

init();

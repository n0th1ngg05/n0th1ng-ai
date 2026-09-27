#!/usr/bin/env python3
"""
ollama_dual_gpu.py
-------------------
Launches two Ollama servers, one pinned to each GPU, and streams both
processes' logs into a single live web dashboard.

  RX 9060 XT (AMD/ROCm)  -> port 11434, bound to 0.0.0.0 (LAN-accessible)
  GTX 1060 6GB (NVIDIA)  -> port 11435, bound to 0.0.0.0 (LAN-accessible)
  Dashboard              -> http://localhost:7717

Run it with:
    python ollama_dual_gpu.py

Stop everything with Ctrl+C in this window — it will terminate both
Ollama processes cleanly before exiting.
"""

import os
import sys
import json
import queue
import signal
import socket
import subprocess
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DASHBOARD_PORT = 7717

# ---- GPU server definitions -------------------------------------------------
# Edit these dicts if your env vars ever need to change.

SERVERS = [
    {
        "id": "amd",
        "label": "RX 9060 XT (ROCm)",
        "color": "#ff5f56",  # red-ish
        "port": 11434,
        "env_extra": {
            "OLLAMA_HOST": "0.0.0.0:11434",
            "ROCR_VISIBLE_DEVICES": "1",
        },
    },
    {
        "id": "nvidia",
        "label": "GTX 1060 6GB (CUDA)",
        "color": "#2f81f7",  # blue-ish
        "port": 11435,
        "env_extra": {
            "OLLAMA_HOST": "0.0.0.0:11435",
            "OLLAMA_LLM_LIBRARY": "cuda_v12",
            "CUDA_VISIBLE_DEVICES": "0",
        },
    },
]

# ---- shared state ------------------------------------------------------------

log_queues = {s["id"]: queue.Queue() for s in SERVERS}
log_history = {s["id"]: [] for s in SERVERS}
HISTORY_LIMIT = 2000
history_lock = threading.Lock()
processes = {}
shutting_down = threading.Event()


def timestamp():
    return datetime.now().strftime("%H:%M:%S")


def push_line(server_id, line):
    entry = {"ts": timestamp(), "text": line.rstrip("\n")}
    with history_lock:
        hist = log_history[server_id]
        hist.append(entry)
        if len(hist) > HISTORY_LIMIT:
            del hist[: len(hist) - HISTORY_LIMIT]
    try:
        log_queues[server_id].put_nowait(entry)
    except queue.Full:
        pass


def reader_thread(server_id, pipe):
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            push_line(server_id, line)
    except Exception as e:
        push_line(server_id, f"[reader error: {e}]")
    finally:
        pipe.close()


def launch_server(server):
    env = os.environ.copy()
    env.update(server["env_extra"])
    push_line(server["id"], f"--- launching ollama serve ({server['label']}) ---")
    push_line(
        server["id"],
        "--- env: " + " ".join(f"{k}={v}" for k, v in server["env_extra"].items()) + " ---",
    )
    creationflags = 0
    if os.name == "nt":
        # Prevent Ctrl+C in this console from also killing children early;
        # we handle shutdown explicitly below.
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP

    proc = subprocess.Popen(
        ["ollama", "serve"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=creationflags,
    )
    processes[server["id"]] = proc
    t = threading.Thread(target=reader_thread, args=(server["id"], proc.stdout), daemon=True)
    t.start()
    return proc


def shutdown_all():
    if shutting_down.is_set():
        return
    shutting_down.set()
    print("\nShutting down Ollama servers...")
    for sid, proc in processes.items():
        if proc.poll() is None:
            try:
                if os.name == "nt":
                    proc.send_signal(signal.CTRL_BREAK_EVENT)
                else:
                    proc.terminate()
            except Exception:
                pass
    for sid, proc in processes.items():
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
    print("Done.")


# ---- dashboard web server -----------------------------------------------------

PAGE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ollama Dual-GPU Dashboard</title>
<style>
  :root {
    --bg: #0d1117;
    --panel: #11161d;
    --border: #21262d;
    --text: #c9d1d9;
    --dim: #6e7681;
    --accent: #58a6ff;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; color: var(--text); }
  header .sub { font-size: 12px; color: var(--dim); }
  .status-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #3fb950;
    box-shadow: 0 0 6px #3fb950; flex-shrink: 0;
  }
  .status-dot.off { background: #f85149; box-shadow: 0 0 6px #f85149; }
  .grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 1px; background: var(--border);
    height: calc(100vh - 58px);
  }
  @media (max-width: 900px) {
    .grid { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  }
  .panel { background: var(--bg); display: flex; flex-direction: column; min-height: 0; }
  .panel-head {
    padding: 10px 16px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px; background: var(--panel);
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .panel-head .name { font-weight: 600; font-size: 13px; }
  .panel-head .port { font-size: 11px; color: var(--dim); margin-left: auto; }
  .log { flex: 1; overflow-y: auto; padding: 10px 14px; font-family: "SF Mono", Consolas, "Courier New", monospace; font-size: 12px; line-height: 1.55; }
  .log .line { white-space: pre-wrap; word-break: break-word; }
  .log .ts { color: var(--dim); margin-right: 8px; }
  .log .line.warn { color: #d29922; }
  .log .line.err { color: #f85149; }
  .log .line.marker { color: var(--accent); font-weight: 600; }
  .log::-webkit-scrollbar { width: 10px; }
  .log::-webkit-scrollbar-thumb { background: var(--border); border-radius: 5px; }
  footer {
    padding: 6px 20px; font-size: 11px; color: var(--dim);
    border-top: 1px solid var(--border); background: var(--panel);
  }
</style>
</head>
<body>
<header>
  <div class="status-dot" id="conn-dot"></div>
  <h1>Ollama Dual-GPU Dashboard</h1>
  <span class="sub" id="conn-text">connecting…</span>
</header>
<div class="grid" id="grid"></div>
<footer>Reachable on your LAN via each server's own port. This dashboard itself only listens on localhost.</footer>
<script>
const SERVERS = __SERVERS_JSON__;
const grid = document.getElementById('grid');
const logEls = {};

for (const s of SERVERS) {
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.innerHTML = `
    <div class="panel-head">
      <div class="dot" style="background:${s.color}"></div>
      <div class="name">${s.label}</div>
      <div class="port">:${s.port}</div>
    </div>
    <div class="log" id="log-${s.id}"></div>
  `;
  grid.appendChild(panel);
  logEls[s.id] = panel.querySelector('.log');
}

function classify(text) {
  const low = text.toLowerCase();
  if (low.includes('error') || low.includes('panic') || low.includes('fatal')) return 'err';
  if (low.startsWith('--- ') ) return 'marker';
  if (low.includes('level=warn') || low.includes(' warn ')) return 'warn';
  return '';
}

function appendLine(id, entry) {
  const el = logEls[id];
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  const div = document.createElement('div');
  div.className = 'line ' + classify(entry.text);
  div.innerHTML = `<span class="ts">${entry.ts}</span>${entry.text.replace(/</g,'&lt;')}`;
  el.appendChild(div);
  while (el.childElementCount > 3000) el.removeChild(el.firstChild);
  if (atBottom) el.scrollTop = el.scrollHeight;
}

async function loadHistory() {
  const res = await fetch('/history');
  const data = await res.json();
  for (const id in data) {
    for (const entry of data[id]) appendLine(id, entry);
  }
}

function connect() {
  const dot = document.getElementById('conn-dot');
  const text = document.getElementById('conn-text');
  const es = new EventSource('/stream');
  es.onopen = () => { dot.classList.remove('off'); text.textContent = 'live'; };
  es.onerror = () => { dot.classList.add('off'); text.textContent = 'reconnecting…'; };
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    appendLine(msg.id, msg.entry);
  };
}

loadHistory().then(connect);
</script>
</body>
</html>
"""


class DashboardHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # silence default HTTP logging; Ollama logs are what matter

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            html = PAGE_HTML.replace(
                "__SERVERS_JSON__",
                json.dumps(
                    [
                        {"id": s["id"], "label": s["label"], "color": s["color"], "port": s["port"]}
                        for s in SERVERS
                    ]
                ),
            )
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/history":
            with history_lock:
                body = json.dumps(log_history).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        elif self.path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            local_queues = {sid: queue.Queue() for sid in log_queues}

            # Tap: subscribe by re-pushing future lines into per-client queues.
            # Simplify by polling shared queues directly with an offset approach:
            # instead, use a broadcast list.
            client_q = queue.Queue()
            listeners.append(client_q)
            try:
                while True:
                    try:
                        msg = client_q.get(timeout=15)
                        data = json.dumps(msg)
                        self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                if client_q in listeners:
                    listeners.remove(client_q)
        else:
            self.send_response(404)
            self.end_headers()


listeners = []


def broadcast_pump():
    """Move entries from each server's queue into all connected SSE clients."""
    while not shutting_down.is_set():
        for sid, q in log_queues.items():
            try:
                entry = q.get(timeout=0.2)
            except queue.Empty:
                continue
            for client_q in list(listeners):
                client_q.put({"id": sid, "entry": entry})


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    print("=" * 60)
    print("Ollama Dual-GPU Launcher")
    print("=" * 60)

    for server in SERVERS:
        launch_server(server)

    pump = threading.Thread(target=broadcast_pump, daemon=True)
    pump.start()

    httpd = ThreadingHTTPServer(("127.0.0.1", DASHBOARD_PORT), DashboardHandler)
    http_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    http_thread.start()

    lan_ip = get_lan_ip()
    dashboard_url = f"http://localhost:{DASHBOARD_PORT}"

    print(f"\nDashboard:        {dashboard_url}")
    print(f"RX 9060 XT API:   http://{lan_ip}:11434  (also http://localhost:11434)")
    print(f"GTX 1060 API:     http://{lan_ip}:11435  (also http://localhost:11435)")
    print("\nBoth Ollama servers are bound to 0.0.0.0 -> reachable from other devices on your LAN.")
    print("Press Ctrl+C here to stop everything.\n")

    try:
        webbrowser.open(dashboard_url)
    except Exception:
        pass

    def handle_sigint(signum, frame):
        shutdown_all()
        httpd.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_sigint)
    if os.name != "nt":
        signal.signal(signal.SIGTERM, handle_sigint)

    import time
    try:
        while True:
            time.sleep(1)
            for server in SERVERS:
                proc = processes[server["id"]]
                if proc.poll() is not None and not shutting_down.is_set():
                    push_line(server["id"], f"--- process exited with code {proc.returncode} ---")
    except KeyboardInterrupt:
        handle_sigint(None, None)


if __name__ == "__main__":
    main()
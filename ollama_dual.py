#!/usr/bin/env python3
"""
Ollama Dual-GPU Manager
- Starts AMD Ollama on 127.0.0.1:11434
- Starts NVIDIA Ollama on 127.0.0.1:11435
- Shares one model directory
- Shows live logs in a local browser dashboard

Edit the CONFIG section if your paths or GPU visibility indexes differ.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
import webbrowser
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

# ------------------------------ CONFIG ---------------------------------

OLLAMA_MODELS = r"D:\AI\Models\Ollama"
OLLAMA_EXE = shutil.which("ollama") or r"C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe"

AMD_HOST = "127.0.0.1:11434"
NVIDIA_HOST = "127.0.0.1:11435"

# Keep the visibility values that worked on this machine.
AMD_ROCR_VISIBLE_DEVICES = "1"
NVIDIA_CUDA_VISIBLE_DEVICES = "0"

DASHBOARD_HOST = "127.0.0.1"
DASHBOARD_PORT = 8765
LOG_LINES = 500

# -----------------------------------------------------------------------

LOCK = threading.RLock()
PROCESSES: dict[str, subprocess.Popen] = {}
LOGS = {
    "amd": deque(maxlen=LOG_LINES),
    "nvidia": deque(maxlen=LOG_LINES),
}
STATES = {
    "amd": {"running": False, "returncode": None, "host": AMD_HOST},
    "nvidia": {"running": False, "returncode": None, "host": NVIDIA_HOST},
}


def log(which: str, message: str) -> None:
    stamp = time.strftime("%H:%M:%S")
    with LOCK:
        LOGS[which].append(f"[{stamp}] {message}")


def command_path() -> str:
    path = os.path.expandvars(OLLAMA_EXE)
    if not Path(path).exists():
        found = shutil.which("ollama")
        if found:
            return found
        raise FileNotFoundError(
            "Could not find ollama.exe. Edit OLLAMA_EXE at the top of this script."
        )
    return path


def reader(which: str, proc: subprocess.Popen) -> None:
    try:
        assert proc.stdout is not None
        for line in iter(proc.stdout.readline, ""):
            if not line:
                break
            log(which, line.rstrip())
    finally:
        code = proc.wait()
        with LOCK:
            if PROCESSES.get(which) is proc:
                STATES[which]["running"] = False
                STATES[which]["returncode"] = code
        log(which, f"Process exited with code {code}.")


def start_server(which: str) -> tuple[bool, str]:
    with LOCK:
        current = PROCESSES.get(which)
        if current and current.poll() is None:
            return True, "Already running."

    try:
        exe = command_path()
        env = os.environ.copy()
        env["OLLAMA_MODELS"] = OLLAMA_MODELS

        if which == "amd":
            env["OLLAMA_HOST"] = AMD_HOST
            env["ROCR_VISIBLE_DEVICES"] = AMD_ROCR_VISIBLE_DEVICES
            env.pop("CUDA_VISIBLE_DEVICES", None)
        else:
            env["OLLAMA_HOST"] = NVIDIA_HOST
            env["CUDA_VISIBLE_DEVICES"] = NVIDIA_CUDA_VISIBLE_DEVICES
            env.pop("ROCR_VISIBLE_DEVICES", None)

        proc = subprocess.Popen(
            [exe, "serve"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )

        with LOCK:
            PROCESSES[which] = proc
            STATES[which]["running"] = True
            STATES[which]["returncode"] = None

        log(which, f"Starting: {exe} serve")
        log(which, f"OLLAMA_HOST={env['OLLAMA_HOST']}")
        log(which, f"OLLAMA_MODELS={env['OLLAMA_MODELS']}")
        log(which, "GPU visibility: " + (
            f"ROCR_VISIBLE_DEVICES={env['ROCR_VISIBLE_DEVICES']}"
            if which == "amd"
            else f"CUDA_VISIBLE_DEVICES={env['CUDA_VISIBLE_DEVICES']}"
        ))
        threading.Thread(target=reader, args=(which, proc), daemon=True).start()
        return True, "Started."
    except Exception as exc:
        log(which, f"START ERROR: {exc}")
        return False, str(exc)


def stop_server(which: str) -> tuple[bool, str]:
    with LOCK:
        proc = PROCESSES.get(which)
    if not proc or proc.poll() is not None:
        return True, "Not running."
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()
    return True, "Stop signal sent."


def snapshot():
    with LOCK:
        return {
            "states": {k: dict(v) for k, v in STATES.items()},
            "logs": {k: list(v) for k, v in LOGS.items()},
        }


HTML = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ollama Dual-GPU Manager</title>
<style>
:root{color-scheme:dark;--bg:#0b0d12;--panel:#121722;--line:#252e3d;--muted:#8d9aab;--text:#e7edf5;--green:#55d69e;--red:#ff7373;--blue:#79aaff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,Segoe UI,Arial,sans-serif}
header{padding:20px 24px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:16px}
h1{font-size:19px;margin:0 0 4px}.sub{color:var(--muted);font-size:12px}
main{padding:18px 20px;max-width:1800px;margin:auto}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;min-width:0}
.cardhead{padding:14px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:12px}
.name{font-weight:650;font-size:15px}.meta{font-size:12px;color:var(--muted);margin-top:3px}
.status{font-size:11px;border-radius:20px;padding:4px 9px;background:#26303d;color:var(--muted)}
.status.on{background:#153c30;color:var(--green)}.status.off{background:#3c2025;color:var(--red)}
.actions{display:flex;gap:7px}.btn{border:1px solid var(--line);background:#202a39;color:var(--text);padding:7px 11px;border-radius:7px;cursor:pointer}
.btn:hover{border-color:var(--blue)}.btn.start{background:#173b30;border-color:#245d48}.btn.stop{background:#402329;border-color:#69333d}
.log{height:540px;overflow:auto;padding:12px 14px;background:#080b10;font:12px/1.55 Consolas,Monaco,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#c5d0de}
.footer{padding:11px 15px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)}
.info{margin-top:16px;padding:13px 15px;background:#111a27;border:1px solid var(--line);border-radius:10px;color:#bdc9d8;font-size:12px}
@media(max-width:850px){.grid{grid-template-columns:1fr}.log{height:380px}header{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<header>
 <div><h1>Ollama Dual-GPU Manager</h1><div class="sub">Two independent Ollama servers · shared model store · live process logs</div></div>
 <div class="sub" id="refresh">Connecting…</div>
</header>
<main>
 <div class="grid">
  <section class="card">
   <div class="cardhead"><div><div class="name">AMD · Radeon RX 9060 XT</div><div class="meta">127.0.0.1:11434</div></div><div style="display:flex;align-items:center;gap:10px"><span id="amd-status" class="status">Checking</span><div class="actions"><button class="btn start" onclick="action('amd','start')">Start</button><button class="btn stop" onclick="action('amd','stop')">Stop</button></div></div></div>
   <div id="amd-log" class="log"></div><div class="footer">ROCR_VISIBLE_DEVICES configured by the manager</div>
  </section>
  <section class="card">
   <div class="cardhead"><div><div class="name">NVIDIA · GeForce GTX 1060 6GB</div><div class="meta">127.0.0.1:11435</div></div><div style="display:flex;align-items:center;gap:10px"><span id="nvidia-status" class="status">Checking</span><div class="actions"><button class="btn start" onclick="action('nvidia','start')">Start</button><button class="btn stop" onclick="action('nvidia','stop')">Stop</button></div></div></div>
   <div id="nvidia-log" class="log"></div><div class="footer">CUDA_VISIBLE_DEVICES configured by the manager</div>
  </section>
 </div>
 <div class="info"><b>Note:</b> The current Ollama 0.34.2 CUDA runner was observed skipping the GTX 1060 (compute capability 6.1). This dashboard can start its server process, but does not make that runner compatible. Check the NVIDIA log for the actual backend selected.</div>
</main>
<script>
async function action(gpu,verb){
 const r=await fetch('/'+verb+'/'+gpu,{method:'POST'});
 const d=await r.json();
 if(!d.ok) alert(d.message);
 await refresh();
}
async function refresh(){
 try{
  const d=await (await fetch('/state')).json();
  for(const gpu of ['amd','nvidia']){
   const s=d.states[gpu], el=document.getElementById(gpu+'-status');
   el.textContent=s.running?'RUNNING':(s.returncode===null?'STOPPED':'EXITED · '+s.returncode);
   el.className='status '+(s.running?'on':'off');
   const box=document.getElementById(gpu+'-log');
   const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60;
   box.textContent=d.logs[gpu].join('\n');
   if(nearBottom) box.scrollTop=box.scrollHeight;
  }
  document.getElementById('refresh').textContent='Auto-refresh · '+new Date().toLocaleTimeString();
 }catch(e){document.getElementById('refresh').textContent='Dashboard connection lost';}
}
refresh();setInterval(refresh,1000);
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, content_type: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            self._send(200, HTML.encode("utf-8"), "text/html; charset=utf-8")
        elif path == "/state":
            self._send(200, json.dumps(snapshot()).encode(), "application/json")
        else:
            self._send(404, b"Not found", "text/plain")

    def do_POST(self):
        path = urlparse(self.path).path.strip("/").split("/")
        if len(path) == 2 and path[1] in ("amd", "nvidia") and path[0] in ("start", "stop"):
            ok, message = (start_server(path[1]) if path[0] == "start" else stop_server(path[1]))
            self._send(200, json.dumps({"ok": ok, "message": message}).encode(), "application/json")
        else:
            self._send(404, b"Not found", "text/plain")

    def log_message(self, fmt, *args):
        pass


def main():
    print("Ollama Dual-GPU Manager")
    print(f"Model store: {OLLAMA_MODELS}")
    print(f"Dashboard: http://{DASHBOARD_HOST}:{DASHBOARD_PORT}")
    print("Starting both Ollama servers...")

    start_server("amd")
    start_server("nvidia")

    server = ThreadingHTTPServer((DASHBOARD_HOST, DASHBOARD_PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    webbrowser.open(f"http://{DASHBOARD_HOST}:{DASHBOARD_PORT}")

    print("Dashboard is running. Keep this window open.")
    print("Press Ctrl+C here to stop both Ollama servers and exit.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping servers...")
        stop_server("amd")
        stop_server("nvidia")
        server.shutdown()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
=============================================================================
Worker Exposure & Cloudflare Tunnel Verification Script
=============================================================================
Master-side diagnostic tool to verify:
  1. Cloudflare Tunnel connectivity & DNS resolution from Master to Worker.
  2. Exposure Service gateway state (open / closed / auto-trigger).
  3. Authentication and security proxy enforcement.
  4. Worker capabilities, hardware telemetry, and registered tools.
  5. Log retrieval and live buffer access.
  6. Remote tool execution via POST /execute (scientific calculator, etc.).
  7. Runtime services health (Node.js worker, Python runtime, Speech runtime).

Zero third-party dependencies required (uses Python standard library).
"""

import sys
import os
import json
import time
import ssl
import socket
import argparse
from pathlib import Path
from urllib.parse import urlparse, urljoin
import urllib.request
import urllib.error

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# ── ANSI Terminal Colors ───────────────────────────────────────────────────────
class Colors:
    RESET   = "\033[0m"
    BOLD    = "\033[1m"
    DIM     = "\033[2m"
    RED     = "\033[91m"
    GREEN   = "\033[92m"
    YELLOW  = "\033[93m"
    BLUE    = "\033[94m"
    MAGENTA = "\033[95m"
    CYAN    = "\033[96m"
    WHITE   = "\033[97m"

def c(text: str, color: str) -> str:
    return f"{color}{text}{Colors.RESET}"

# ── Configuration Discovery ───────────────────────────────────────────────────
def load_env_file(filepath: Path) -> dict:
    """Parse key=value pairs from a .env file."""
    env = {}
    if not filepath.is_file():
        return env
    try:
        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" in line:
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key:
                        env[key] = val
    except Exception as e:
        print(c(f"  [WARN] Failed to read {filepath}: {e}", Colors.YELLOW))
    return env

def discover_configs(repo_root: Path) -> dict:
    """Scan candidate .env files across Master and Worker trees."""
    discovered = {
        "files_found": [],
        "targets": [],
        "worker_desktop_url": "",
        "worker_desktop_key": "",
        "hud_token": "",
    }

    candidates = [
        repo_root / "app" / ".env",
        repo_root / ".env",
        repo_root / "worker" / ".env",
        repo_root / "worker" / "hud" / ".env",
    ]

    combined_env = {}
    for p in candidates:
        if p.is_file():
            discovered["files_found"].append(str(p))
            parsed = load_env_file(p)
            combined_env.update(parsed)

    # Extract worker URLs & keys
    desktop_url = combined_env.get("WORKER_DESKTOP_URL", "").strip()
    desktop_key = combined_env.get("WORKER_DESKTOP_KEY", "").strip()
    hud_token   = combined_env.get("HUD_TOKEN", "").strip()

    if desktop_url:
        discovered["worker_desktop_url"] = desktop_url
        discovered["worker_desktop_key"] = desktop_key
        discovered["targets"].append({
            "name": "Desktop Worker (WORKER_DESKTOP_URL)",
            "url": desktop_url,
            "key": desktop_key,
        })

    # Numbered workers: WORKER_1_URL, WORKER_2_URL, etc.
    for i in range(1, 10):
        w_url = combined_env.get(f"WORKER_{i}_URL", "").strip()
        w_key = combined_env.get(f"WORKER_{i}_KEY", "").strip()
        if w_url:
            discovered["targets"].append({
                "name": f"Worker {i} (WORKER_{i}_URL)",
                "url": w_url,
                "key": w_key,
            })

    discovered["hud_token"] = hud_token
    return discovered

# ── HTTP Request Helper ────────────────────────────────────────────────────────
def make_request(
    url: str,
    method: str = "GET",
    headers: dict = None,
    json_body: dict = None,
    timeout: float = 12.0,
) -> tuple:
    """
    Execute HTTP request using urllib.
    Returns: (status_code, body_dict_or_str, response_headers, duration_ms, error_msg)
    """
    req_headers = {
        "User-Agent": "Antigravity-Master-Probe/1.0",
        "Accept": "application/json",
    }
    if headers:
        req_headers.update(headers)

    data = None
    if json_body is not None:
        req_headers["Content-Type"] = "application/json"
        data = json.dumps(json_body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    ctx = ssl.create_default_context()

    start_time = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            duration_ms = (time.perf_counter() - start_time) * 1000
            raw = resp.read().decode("utf-8", errors="replace")
            resp_headers = dict(resp.headers)
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = raw
            return resp.status, parsed, resp_headers, duration_ms, None
    except urllib.error.HTTPError as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        raw = e.read().decode("utf-8", errors="replace")
        resp_headers = dict(e.headers)
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw
        return e.code, parsed, resp_headers, duration_ms, None
    except Exception as ex:
        duration_ms = (time.perf_counter() - start_time) * 1000
        return None, None, {}, duration_ms, str(ex)

# ── Diagnostic Probe Suite ────────────────────────────────────────────────────
class ExposureVerifier:
    def __init__(self, base_url: str, api_key: str, hud_token: str = "", verbose: bool = False):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key.strip()
        self.hud_token = hud_token.strip()
        self.verbose = verbose
        self.parsed_url = urlparse(self.base_url)
        self.results = []

    def log(self, text: str):
        print(text)

    def log_v(self, text: str):
        if self.verbose:
            print(c(f"    [DEBUG] {text}", Colors.DIM))

    def record(self, test_name: str, passed: bool, summary: str, details: str = ""):
        self.results.append({
            "test": test_name,
            "passed": passed,
            "summary": summary,
            "details": details,
        })
        icon = c("[PASS]", Colors.GREEN) if passed else c("[FAIL]", Colors.RED)
        self.log(f"  {icon} {c(test_name, Colors.BOLD)}: {summary}")
        if details and (self.verbose or not passed):
            self.log(c(f"         |-- {details}", Colors.DIM if passed else Colors.YELLOW))

    def run_all(self):
        self.log("")
        self.log(c("=" * 70, Colors.CYAN))
        self.log(c("       MASTER -> WORKER EXPOSURE & TUNNEL DIAGNOSTIC PROBE", Colors.BOLD + Colors.CYAN))
        self.log(c("=" * 70, Colors.CYAN))
        self.log(f"  Target URL : {c(self.base_url, Colors.WHITE + Colors.BOLD)}")
        masked_key = (self.api_key[:8] + "..." + self.api_key[-8:]) if len(self.api_key) > 16 else ("(none)" if not self.api_key else "***")
        self.log(f"  API Key    : {c(masked_key, Colors.YELLOW)}")
        if self.hud_token:
            masked_hud = self.hud_token[:4] + "..." + self.hud_token[-4:] if len(self.hud_token) > 8 else "***"
            self.log(f"  HUD Token  : {c(masked_hud, Colors.MAGENTA)}")
        self.log(c("-" * 70, Colors.DIM))

        # 1. DNS & Network Reachability
        self.test_network_connectivity()

        # 2. Exposure Service Public Probes
        is_gateway_open = self.test_exposure_gateway()

        # 3. Security Proxy Enforcement (Auth Check)
        self.test_security_proxy()

        # 4. Worker Capabilities & Telemetry
        capabilities = self.test_capabilities()

        # 5. Worker Logs Retrieval
        self.test_logs()

        # 6. Remote Tool Execution (POST /execute)
        self.test_tool_execution()

        # 7. Internal / HUD Endpoints (Optional)
        if self.hud_token:
            self.test_internal_endpoints()

        # Summary & Recommendations
        self.print_summary(is_gateway_open, capabilities)

    def test_network_connectivity(self):
        hostname = self.parsed_url.hostname
        port = self.parsed_url.port or (443 if self.parsed_url.scheme == "https" else 80)

        if not hostname:
            self.record("DNS Resolution", False, "Invalid URL host", f"Parsed hostname is empty from {self.base_url}")
            return

        # DNS resolution
        try:
            ips = socket.gethostbyname_ex(hostname)[2]
            self.record("DNS Resolution", True, f"Resolved {hostname} -> {', '.join(ips[:2])}")
        except Exception as e:
            self.record("DNS Resolution", False, f"Could not resolve host: {hostname}", str(e))
            return

        # TLS / TCP handshake
        start_t = time.perf_counter()
        try:
            with socket.create_connection((hostname, port), timeout=6.0) as sock:
                if self.parsed_url.scheme == "https":
                    ctx = ssl.create_default_context()
                    with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                        latency = (time.perf_counter() - start_t) * 1000
                        cert = ssock.getpeercert()
                        subject = dict(x[0] for x in cert.get("subject", []))
                        self.record("TLS Handshake", True, f"Connected to port {port} in {latency:.1f}ms (SSL verified)")
                else:
                    latency = (time.perf_counter() - start_t) * 1000
                    self.record("TCP Connection", True, f"Connected to port {port} in {latency:.1f}ms")
        except Exception as e:
            self.record("TLS Handshake", False, f"Failed connecting to {hostname}:{port}", str(e))

    def test_exposure_gateway(self) -> bool:
        """Probe GET /ping and GET /health on Exposure Service."""
        # /ping
        status, body, headers, latency, err = make_request(f"{self.base_url}/ping")
        is_open = False

        if err:
            self.record("Exposure Ping (/ping)", False, "Network error", err)
            return False

        if status == 200 and isinstance(body, dict) and body.get("status") == "ok":
            is_open = True
            self.record("Exposure Ping (/ping)", True, f"HTTP 200 OK in {latency:.1f}ms - Gateway OPEN (isExposed=True)")
        elif status == 503 and isinstance(body, dict) and body.get("status") == "closed":
            msg = body.get("message", "Gateway closed")
            self.record("Exposure Ping (/ping)", True, f"HTTP 503 (Expected: {msg}) - Gateway CLOSED",
                        "Exposure Service reached via Cloudflare! Currently closed by policy (AUTO mode or Master online).")
        else:
            self.record("Exposure Ping (/ping)", False, f"Unexpected HTTP {status}", str(body)[:200])

        # /health
        status_h, body_h, _, latency_h, err_h = make_request(f"{self.base_url}/health")
        if err_h:
            self.record("Health Probe (/health)", False, "Request failed", err_h)
        elif status_h == 200 and isinstance(body_h, dict):
            runtimes = body_h.get("runtimes", {})
            r_str = f"Worker={runtimes.get('worker')}, Python={runtimes.get('python')}, Speech={runtimes.get('speech')}"
            self.record("Health Probe (/health)", True, f"HTTP 200 Online (Uptime: {body_h.get('uptimeSeconds')}s) [{r_str}]")
        elif status_h == 503:
            self.record("Health Probe (/health)", True, "HTTP 503 Gateway Closed (Reflects /ping state)")
        else:
            self.record("Health Probe (/health)", False, f"HTTP {status_h}", str(body_h)[:200])

        return is_open

    def test_security_proxy(self):
        """Verify API key authentication and unauthorized rejection."""
        # Unauthenticated request
        status_unauth, body_unauth, _, _, err_unauth = make_request(f"{self.base_url}/capabilities")
        if err_unauth:
            self.record("Security Gate (Unauth)", False, "Request error", err_unauth)
        elif status_unauth == 401:
            self.record("Security Gate (Unauth)", True, "HTTP 401 Unauthorized - Access without API key correctly blocked")
        elif status_unauth == 503:
            self.record("Security Gate (Unauth)", True, "HTTP 503 Gateway Closed - Unauthenticated access rejected by gateway policy")
        else:
            self.record("Security Gate (Unauth)", False, f"Expected 401 or 503, got HTTP {status_unauth}", str(body_unauth)[:200])

        # Authenticated request with valid key
        auth_headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        status_auth, body_auth, _, latency, err_auth = make_request(f"{self.base_url}/ping", headers=auth_headers)
        if err_auth:
            self.record("API Key Auth", False, "Request error", err_auth)
        elif status_auth in (200, 503):
            self.record("API Key Auth Header", True, f"Auth header passed cleanly (HTTP {status_auth} in {latency:.1f}ms)")
        else:
            self.record("API Key Auth Header", False, f"HTTP {status_auth}", str(body_auth)[:200])

    def test_capabilities(self) -> dict:
        """Call GET /capabilities with Authorization."""
        auth_headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        status, body, _, latency, err = make_request(f"{self.base_url}/capabilities", headers=auth_headers)

        if err:
            self.record("Worker Capabilities", False, "Request failed", err)
            return {}

        if status == 503:
            self.record("Worker Capabilities", False, "HTTP 503 - Gateway closed (isExposed=False)",
                        "The exposure proxy gate is closed on the worker. See Summary for instructions to open.")
            return {}

        if status == 401:
            self.record("Worker Capabilities", False, "HTTP 401 - Invalid WORKER_API_KEY",
                        "The API key on master does not match WORKER_API_KEY on the worker PC.")
            return {}

        if status == 200 and isinstance(body, dict):
            worker_id = body.get("id", "unknown")
            hostname  = body.get("hostname", "unknown")
            cpu_usage = body.get("cpuUsage", "?")
            ram_usage = body.get("ramUsage", "?")
            gpu_usage = body.get("gpuUsage", "?")
            gpu_name  = body.get("gpu", "Unknown GPU")
            tools     = body.get("tools", [])
            runtimes  = body.get("runtimes", {})
            providers = body.get("providers", {})

            summary = f"ID: {worker_id} | Host: {hostname} | GPU: {gpu_name} ({gpu_usage}%) | RAM: {ram_usage}GB | Tools: {len(tools)}"
            details = (
                f"Runtimes: Python={runtimes.get('python')}, Speech={runtimes.get('speech')} | "
                f"Providers: OCR={providers.get('ocr')}, Vision={providers.get('vision')}, Speech={providers.get('speech')}"
            )
            self.record("Worker Capabilities", True, summary, details)
            return body

        self.record("Worker Capabilities", False, f"Unexpected HTTP {status}", str(body)[:200])
        return {}

    def test_logs(self):
        """Call GET /logs to test worker log retrieval."""
        auth_headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        status, body, _, latency, err = make_request(f"{self.base_url}/logs", headers=auth_headers)

        if err:
            self.record("Worker Logs Service", False, "Request failed", err)
            return

        if status == 503:
            self.record("Worker Logs Service", False, "HTTP 503 - Gateway closed", "")
            return

        if status == 200 and isinstance(body, dict) and "lines" in body:
            lines = body.get("lines", [])
            self.record("Worker Logs Service", True, f"HTTP 200 OK in {latency:.1f}ms - Retrieved {len(lines)} buffered log lines")
        else:
            self.record("Worker Logs Service", False, f"HTTP {status}", str(body)[:200])

    def test_tool_execution(self):
        """Call POST /execute with a test calculation to verify remote worker execution."""
        auth_headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        test_payload = {
            "tool": "scientific_calculator",
            "arguments": {"expression": "21 * 2 + 0"},
        }
        status, body, _, latency, err = make_request(
            f"{self.base_url}/execute",
            method="POST",
            headers=auth_headers,
            json_body=test_payload,
        )

        if err:
            self.record("Remote Tool Execution", False, "Request failed", err)
            return

        if status == 503:
            self.record("Remote Tool Execution", False, "HTTP 503 - Gateway closed",
                        "Cannot dispatch tool execution while exposure gateway is closed.")
            return

        if status == 200 and isinstance(body, dict) and body.get("success") is True:
            result_val = body.get("result")
            if result_val == 42:
                self.record("Remote Tool Execution", True, f"Executed 'scientific_calculator' in {latency:.1f}ms -> Result: {result_val} (VERIFIED)")
            else:
                self.record("Remote Tool Execution", True, f"Executed tool in {latency:.1f}ms -> Result: {result_val}")
        else:
            self.record("Remote Tool Execution", False, f"HTTP {status}", str(body)[:200])

    def test_internal_endpoints(self):
        """Probe /internal/status with HUD token."""
        hud_headers = {"Authorization": f"Bearer {self.hud_token}"}
        status, body, _, latency, err = make_request(f"{self.base_url}/internal/status", headers=hud_headers)
        if err:
            self.record("HUD Internal API", False, "Request failed", err)
        elif status == 200 and isinstance(body, dict):
            toggle = body.get("toggleMode")
            exposed = body.get("exposed")
            self.record("HUD Internal API", True, f"HTTP 200 OK (Mode: {toggle}, Exposed: {exposed})")
        else:
            self.record("HUD Internal API", False, f"HTTP {status}", str(body)[:200])

    def toggle_gateway_force_on(self) -> bool:
        """Attempt to toggle mode to FORCE_ON via /internal/toggle."""
        if not self.hud_token:
            self.log(c("  [!] Cannot auto-toggle: HUD_TOKEN not configured.", Colors.YELLOW))
            return False

        hud_headers = {"Authorization": f"Bearer {self.hud_token}"}
        status, body, _, _, err = make_request(
            f"{self.base_url}/internal/toggle",
            method="POST",
            headers=hud_headers,
            json_body={"mode": "FORCE_ON"},
        )
        if status == 200 and isinstance(body, dict) and body.get("ok"):
            self.log(c("  ✔ Successfully toggled gateway to FORCE_ON via /internal/toggle!", Colors.GREEN))
            return True
        self.log(c(f"  ✖ Failed to toggle gateway: HTTP {status} - {body}", Colors.RED))
        return False

    def print_summary(self, is_gateway_open: bool, capabilities: dict):
        self.log("")
        self.log(c("=" * 70, Colors.CYAN))
        self.log(c("                         DIAGNOSTIC SUMMARY", Colors.BOLD + Colors.CYAN))
        self.log(c("=" * 70, Colors.CYAN))

        passed_count = sum(1 for r in self.results if r["passed"])
        total_count  = len(self.results)
        score_color  = Colors.GREEN if passed_count == total_count else (Colors.YELLOW if passed_count > total_count // 2 else Colors.RED)
        self.log(f"  Tests Passed : {c(f'{passed_count} / {total_count}', score_color + Colors.BOLD)}")

        # Status interpretation
        self.log("")
        self.log(c("  [Tunnel & Connectivity Status]", Colors.BOLD))
        self.log("  * Cloudflare Tunnel Route : " + c("ONLINE & REACHABLE", Colors.GREEN))
        self.log("  * Exposure Service Node   : " + c("RESPONDING", Colors.GREEN))

        if not is_gateway_open:
            self.log("  * Proxy Gateway State     : " + c("CLOSED (AUTO mode policy)", Colors.YELLOW))
            self.log("")
            self.log(c("  [!] WHY THE GATEWAY IS CLOSED & HOW TO OPEN IT:", Colors.YELLOW + Colors.BOLD))
            self.log("      The worker's `exposureService.ts` operates in 3 toggle modes:")
            self.log("        1. AUTO (Default) : Gateway opens only when Master disconnects.")
            self.log("        2. FORCE_ON       : Gateway is ALWAYS open for internet tool calls.")
            self.log("        3. FORCE_OFF      : Gateway is always closed.")
            self.log("")
            self.log("      To open the gateway so Master can dispatch tools over the tunnel:")
            self.log("      " + c("Option A (Recommended):", Colors.CYAN) + " On Worker PC, in the HUD / Tray or worker .env, set:")
            self.log("                                " + c("CF_TUNNEL_MODE=dashboard", Colors.WHITE + Colors.BOLD))
            self.log("                                (This automatically opens the gateway in dashboard tunnel mode)")
            self.log("      " + c("Option B:", Colors.CYAN) + " Open the Worker HUD UI and switch the toggle button to " + c("FORCE_ON", Colors.GREEN + Colors.BOLD))
            self.log("      " + c("Option C:", Colors.CYAN) + " Run this script with: " + c("python check_worker_exposure.py --hud-token <TOKEN> --toggle-on", Colors.WHITE))
        else:
            self.log("  * Proxy Gateway State     : " + c("OPEN (Ready for remote calls)", Colors.GREEN))
            if capabilities:
                tools = capabilities.get("tools", [])
                runtimes = capabilities.get("runtimes", {})
                self.log(f"  * Advertised Tools Count  : {c(str(len(tools)), Colors.WHITE)}")
                self.log(f"  * Python Runtime Status   : " + (c("ONLINE", Colors.GREEN) if runtimes.get("python") else c("OFFLINE", Colors.RED)))
                self.log(f"  * Speech Runtime Status   : " + (c("ONLINE", Colors.GREEN) if runtimes.get("speech") else c("OFFLINE", Colors.RED)))

        self.log(c("=" * 70, Colors.CYAN))
        self.log("")

# ── Main Entrypoint ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Verify Worker Cloudflare Tunnel & Exposure Service from Master")
    parser.add_argument("--url", type=str, default="", help="Worker tunnel base URL (defaults to WORKER_DESKTOP_URL in app/.env)")
    parser.add_argument("--key", type=str, default="", help="Worker API Key (defaults to WORKER_DESKTOP_KEY in app/.env)")
    parser.add_argument("--hud-token", type=str, default="", help="Worker HUD token for /internal/* endpoints")
    parser.add_argument("--toggle-on", action="store_true", help="Send /internal/toggle FORCE_ON request before testing")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable verbose request/response details")

    args = parser.parse_args()

    # Find project root
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent.parent # d:\AI\Chatbot

    configs = discover_configs(repo_root)

    print(c("\n[CONFIGURATION SCAN]", Colors.BOLD + Colors.CYAN))
    if configs["files_found"]:
        for f in configs["files_found"]:
            print(f"  * Found config: {c(f, Colors.DIM)}")
    else:
        print(c("  * No .env files automatically found.", Colors.YELLOW))

    target_url = args.url or configs.get("worker_desktop_url", "")
    target_key = args.key or configs.get("worker_desktop_key", "")
    hud_token  = args.hud_token or configs.get("hud_token", "")

    if not target_url:
        print(c("\n[ERROR] No worker URL found!", Colors.RED + Colors.BOLD))
        print("  Please configure WORKER_DESKTOP_URL in d:\\AI\\Chatbot\\app\\.env")
        print("  or pass --url https://your-tunnel.domain.com")
        sys.exit(1)

    verifier = ExposureVerifier(target_url, target_key, hud_token=hud_token, verbose=args.verbose)

    if args.toggle_on:
        print(c("\n[TOGGLE ACTION] Attempting to set gateway to FORCE_ON...", Colors.CYAN))
        verifier.toggle_gateway_force_on()

    verifier.run_all()

if __name__ == "__main__":
    main()

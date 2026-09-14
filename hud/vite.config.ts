import { defineConfig } from "vite";
import fs from "fs";
import path from "path";

// ── Load HUD_TOKEN from worker root .env (parent of hud/) ─────────────────────
// The token is injected server-side by the proxy so it never goes to the browser.
function loadParentEnv(): Record<string, string> {
    const envPath = path.join(__dirname, "../.env");
    if (!fs.existsSync(envPath)) return {};
    const content = fs.readFileSync(envPath, "utf-8");
    const result: Record<string, string> = {};
    for (const line of content.split(/\r?\n/)) {
        const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
        if (m) result[m[1].trim()] = m[2].trim();
    }
    return result;
}

const env       = loadParentEnv();
const HUD_TOKEN = env.HUD_TOKEN ?? "";
const EXPOSE_PORT = env.EXPOSE_PORT ?? "3443";

if (!HUD_TOKEN) {
    console.warn("[HUD] Warning: HUD_TOKEN not found in ../.env — /internal/* calls will fail auth");
} else {
    console.log("[HUD] HUD_TOKEN loaded from ../.env ✓");
}

export default defineConfig({
    root: ".",
    build: { outDir: "dist" },
    server: {
        port: 5173,
        proxy: {
            // All /internal/* calls get the HUD token injected automatically.
            // The browser JS never sees or sends the token.
            "/internal": {
                target: `http://localhost:${EXPOSE_PORT}`,
                changeOrigin: true,
                headers: {
                    Authorization: `Bearer ${HUD_TOKEN}`,
                },
            },
            // Worker log stream + snapshot
            "/logs": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
            // Worker ping (for runtime status)
            "/ping": {
                target: "http://localhost:3001",
                changeOrigin: true,
            },
        },
    },
});

import "dotenv/config";
import path from "path";
import { app, BrowserWindow, Tray, Menu, shell, nativeImage } from "electron";

// ── Config ────────────────────────────────────────────────────────────────────
const HUD_URL   = `http://localhost:${process.env.HUD_PORT ?? "5173"}`;
const HUD_TOKEN = process.env.HUD_TOKEN ?? "";
const EXPOSE_PORT = process.env.EXPOSE_PORT ?? "3443";
const INTERNAL_BASE = `http://localhost:${EXPOSE_PORT}`;

let tray: Tray | null = null;
let hudWindow: BrowserWindow | null = null;
let currentMode: "AUTO" | "FORCE_ON" | "FORCE_OFF" = "AUTO";
let isExposed = false;
let masterConnected = false;

// ── Icons ─────────────────────────────────────────────────────────────────────
function iconPath(name: string): string {
    return path.join(__dirname, "assets", name);
}

function getTrayIcon(): Electron.NativeImage {
    try {
        const name = isExposed ? "icon-active.ico" : "icon-idle.ico";
        return nativeImage.createFromPath(iconPath(name));
    } catch {
        // Fall back to empty image if icons not found yet
        return nativeImage.createEmpty();
    }
}

// ── Status polling ────────────────────────────────────────────────────────────
async function pollExposureStatus() {
    try {
        const res = await fetch(`${INTERNAL_BASE}/internal/status`, {
            headers: { Authorization: `Bearer ${HUD_TOKEN}` },
            signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) return;

        const s: {
            exposed: boolean;
            toggleMode: "AUTO" | "FORCE_ON" | "FORCE_OFF";
            masterConnected: boolean;
            tunnelUrl: string | null;
        } = await res.json();

        const changed = s.exposed !== isExposed || s.toggleMode !== currentMode || s.masterConnected !== masterConnected;
        isExposed       = s.exposed;
        currentMode     = s.toggleMode;
        masterConnected = s.masterConnected;

        if (changed) {
            console.log(`[TRAY] Status update — exposed:${isExposed} mode:${currentMode} master:${masterConnected}`);
            rebuildTray();
        }
    } catch {
        // exposure service might not be up yet — silently ignore
    }
}

async function sendToggle(mode: "AUTO" | "FORCE_ON" | "FORCE_OFF") {
    try {
        await fetch(`${INTERNAL_BASE}/internal/toggle`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${HUD_TOKEN}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ mode }),
        });
        console.log(`[TRAY] Sent toggle → ${mode}`);
        // Immediate optimistic update
        currentMode = mode;
        rebuildTray();
    } catch (err: any) {
        console.error("[TRAY] Toggle failed:", err?.message);
    }
}

// ── HUD window ────────────────────────────────────────────────────────────────
function openHud() {
    if (hudWindow && !hudWindow.isDestroyed()) {
        hudWindow.focus();
        return;
    }

    console.log("[TRAY] Opening HUD window →", HUD_URL);

    hudWindow = new BrowserWindow({
        width:           1440,
        height:          900,
        minWidth:        1100,
        minHeight:       700,
        title:           "Worker HUD",
        backgroundColor: "#080b10",
        darkTheme:       true,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    hudWindow.loadURL(HUD_URL);

    hudWindow.on("closed", () => {
        hudWindow = null;
    });
}

// ── Tray menu builder ─────────────────────────────────────────────────────────
function rebuildTray() {
    if (!tray) return;

    tray.setImage(getTrayIcon());

    const modeLabel = {
        AUTO:      `Internet: AUTO [${isExposed ? "Exposing" : "Local"}]`,
        FORCE_ON:  "Internet: FORCE ON ✓",
        FORCE_OFF: "Internet: FORCE OFF ✗",
    }[currentMode];

    const masterLabel = masterConnected ? "Master: Connected ●" : "Master: Offline ○";

    const contextMenu = Menu.buildFromTemplate([
        {
            label:   "● Worker HUD",
            click:   openHud,
            enabled: true,
        },
        { type: "separator" },
        {
            label:   modeLabel,
            enabled: false,
        },
        {
            label: "Set: AUTO",
            type:  "radio",
            checked: currentMode === "AUTO",
            click: () => sendToggle("AUTO"),
        },
        {
            label: "Set: Force ON",
            type:  "radio",
            checked: currentMode === "FORCE_ON",
            click: () => sendToggle("FORCE_ON"),
        },
        {
            label: "Set: Force OFF",
            type:  "radio",
            checked: currentMode === "FORCE_OFF",
            click: () => sendToggle("FORCE_OFF"),
        },
        { type: "separator" },
        {
            label:   masterLabel,
            enabled: false,
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => {
                console.log("[TRAY] Quit requested");
                app.quit();
            },
        },
    ]);

    tray.setContextMenu(contextMenu);
    tray.setToolTip(
        isExposed
            ? `Worker HUD — Internet EXPOSED (${currentMode})`
            : `Worker HUD — Local Only (${currentMode})`
    );
}

// ── Electron app lifecycle ────────────────────────────────────────────────────
app.on("ready", () => {
    console.log("[TRAY] Electron ready — creating tray icon");

    // Prevent dock icon on macOS
    if (process.platform === "darwin") app.dock?.hide();

    tray = new Tray(getTrayIcon());
    tray.setToolTip("Worker HUD");

    // Double-click opens HUD
    tray.on("double-click", openHud);

    rebuildTray();

    // Poll exposure status every 5s
    pollExposureStatus();
    setInterval(pollExposureStatus, 5000);

    console.log("[TRAY] System tray active");
});

// Don't quit when all windows close — stay in tray
app.on("window-all-closed", (e: Event) => {
    e.preventDefault();
});

app.on("before-quit", () => {
    console.log("[TRAY] App quitting");
});

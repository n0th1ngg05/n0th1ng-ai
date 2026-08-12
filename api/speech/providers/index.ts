import { RuntimeRegistry } from "../manager/runtimeRegistry.js";
import { ProviderManager } from "../manager/providerManager.js";

// NOTE: the 7 provider classes below (Kokoro, Whisper, Piper, XTTS,
// FishSpeech, Dia, Chatterbox) are imported LAZILY, inside
// registerSpeechProviders(), right where each is constructed.
//
// Each provider file pulls in its own manifest/config plus the shared
// base provider classes, and this speech/providers/ tree alone is 170K+
// across dozens of files. Importing all 7 eagerly here means every SSR
// load of boot.ts (which imports speechManager.ts -> providers/index.ts)
// has to walk and transform that entire fan-out just to define
// registerSpeechProviders, even though it isn't called until later.
// On a cold Vite SSR module-runner (especially on Windows, where
// per-file fetchModule round-trips are slower), that fan-out was enough
// to blow past Vite's 60s module-runner RPC timeout
// ("transport invoke timed out after 60000ms") while loading boot.ts.
//
// Dynamic import() defers each provider's resolution until
// registerSpeechProviders() actually runs (after the initial module
// graph has already settled), so none of them contribute to load-time
// cost anymore.
//
// All 7 providers are now registered IN PARALLEL via Promise.all so
// the total wait is bounded by the slowest single provider, not the
// sum of all of them. registerProvider/enableProvider are safe to
// call concurrently because they operate on independent Map keys.

async function registerOne(
    id: string,
    providerManager: ProviderManager,
    runtimeRegistry: RuntimeRegistry,
    factory: () => Promise<{ new(r: RuntimeRegistry): InstanceType<ReturnType<typeof factory> extends Promise<infer T> ? T : never> }>
): Promise<void> {
    // Intentionally left as a typed helper below; the real work is in
    // registerSpeechProviders where each branch is inlined for clarity.
    void id; void providerManager; void runtimeRegistry; void factory;
}
void registerOne; // suppress unused warning — see below

export async function registerSpeechProviders(
    providerManager: ProviderManager,
    runtimeRegistry: RuntimeRegistry
): Promise<void> {

    // All 7 providers are loaded and registered concurrently.
    // Each task: lazy-import the class, instantiate, register + enable.
    // If a provider is already registered (hot-reload / re-init), we
    // skip and log — same guard as the original sequential version.

    await Promise.all([

        // ── Kokoro (TTS) ─────────────────────────────────────────────
        (async () => {
            if (providerManager.getProvider("kokoro")) {
                console.log("[Speech] Kokoro already registered");
                return;
            }
            const { KokoroProvider } = await import("./kokoro/provider.js");
            const kokoro = new KokoroProvider(runtimeRegistry);
            await providerManager.registerProvider(kokoro);
            await providerManager.enableProvider(kokoro.id);
            console.log("[Speech] Kokoro registered");
        })(),

        // ── Whisper (STT) ────────────────────────────────────────────
        (async () => {
            if (providerManager.getProvider("whisper")) {
                console.log("[Speech] Whisper already registered");
                return;
            }
            const { WhisperProvider } = await import("./whisper/provider.js");
            const whisper = new WhisperProvider(runtimeRegistry);
            await providerManager.registerProvider(whisper);
            await providerManager.enableProvider(whisper.id);
            console.log("[Speech] Whisper registered");
        })(),

        // ── Piper (TTS) ──────────────────────────────────────────────
        (async () => {
            if (providerManager.getProvider("piper")) {
                console.log("[Speech] Piper already registered");
                return;
            }
            const { PiperProvider } = await import("./piper/provider.js");
            const piper = new PiperProvider(runtimeRegistry);
            await providerManager.registerProvider(piper);
            await providerManager.enableProvider(piper.id);
            console.log("[Speech] Piper registered");
        })(),

        // ── XTTS (TTS + voice cloning) ───────────────────────────────
        (async () => {
            if (providerManager.getProvider("xtts")) {
                console.log("[Speech] XTTS already registered");
                return;
            }
            const { XTTSProvider } = await import("./xtts/provider.js");
            const xtts = new XTTSProvider(runtimeRegistry);
            await providerManager.registerProvider(xtts);
            await providerManager.enableProvider(xtts.id);
            console.log("[Speech] XTTS registered");
        })(),

        // ── Fish Speech (TTS + voice cloning) ────────────────────────
        (async () => {
            if (providerManager.getProvider("fishspeech")) {
                console.log("[Speech] Fish Speech already registered");
                return;
            }
            const { FishSpeechProvider } = await import("./fishspeech/provider.js");
            const fishSpeech = new FishSpeechProvider(runtimeRegistry);
            await providerManager.registerProvider(fishSpeech);
            await providerManager.enableProvider(fishSpeech.id);
            console.log("[Speech] Fish Speech registered");
        })(),

        // ── Dia (TTS) ────────────────────────────────────────────────
        (async () => {
            if (providerManager.getProvider("dia")) {
                console.log("[Speech] Dia already registered");
                return;
            }
            const { DiaProvider } = await import("./dia/provider.js");
            const dia = new DiaProvider(runtimeRegistry);
            await providerManager.registerProvider(dia);
            await providerManager.enableProvider(dia.id);
            console.log("[Speech] Dia registered");
        })(),

        // ── Chatterbox (Hybrid: TTS + STT) ──────────────────────────
        (async () => {
            if (providerManager.getProvider("chatterbox")) {
                console.log("[Speech] Chatterbox already registered");
                return;
            }
            const { ChatterboxProvider } = await import("./chatterbox/provider.js");
            const chatterbox = new ChatterboxProvider(runtimeRegistry);
            await providerManager.registerProvider(chatterbox);
            await providerManager.enableProvider(chatterbox.id);
            console.log("[Speech] Chatterbox registered");
        })(),

    ]);

}
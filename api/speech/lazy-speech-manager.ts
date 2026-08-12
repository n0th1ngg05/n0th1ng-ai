/**
 * lazy-speech-manager.ts
 *
 * Provides a lazy getter for the SpeechManager singleton.
 *
 * WHY THIS EXISTS:
 * Vite's SSR module runner has a 60 s `fetchModule` RPC budget.
 * Instantiating `SpeechManager` as a top-level module export forces Node to
 * eagerly resolve and parse all 11 manager files the moment *any* file in
 * `api/speech/api/` is imported — even files unrelated to speech.
 * That chain of work reliably overruns the 60 s timeout.
 *
 * By deferring instantiation to the first call of `getSpeechManager()`,
 * the heavy work only happens inside a live request handler, never at
 * module-graph evaluation time.
 */

let _instance: import("./manager/speechManager").SpeechManager | null = null;

export async function getSpeechManager() {
  if (!_instance) {
    const { SpeechManager } = await import("./manager/speechManager");
    _instance = new SpeechManager();
  }
  return _instance;
}

/**
 * Called once by boot.ts / initializeSpeechSystem().
 * Creates the instance *and* runs initialize() so providers are ready.
 */
export async function initializeLazySpeechManager() {
  const mgr = await getSpeechManager();
  await mgr.initialize();
  return mgr;
}

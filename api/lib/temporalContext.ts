// lib/temporalContext.ts
//
// Local Ollama models have a training-data cutoff and no innate sense of
// "now" — left alone, they'll reason e.g. "my cutoff is 2024, the user says
// 2026, therefore that hasn't happened yet" and refuse or hallucinate
// instead of treating the date as real. The fix has two parts, both
// enforced here so every call site gets them identically:
//
//   1. Inject the actual current date/time/day/timezone into every prompt.
//   2. Explicitly tell the model that its cutoff is not evidence something
//      hasn't happened — otherwise (1) alone often isn't enough; small
//      models still pattern-match on "future-sounding" dates even with the
//      correct date sitting right in front of them.
//
// Synced to the DEVICE, not the server: the browser (or ESP32 client, for
// n0th1ng IoT) sends its IANA timezone name once per request, and this
// derives every displayed field (weekday, GMT offset, 12h/24h) from that,
// not from wherever the Node/Ollama process happens to be hosted. Falls
// back to server-local time only if the client genuinely didn't send one
// (older client build, direct API test, etc.) — better than crashing, but
// every call site should be passing a real timezone in normal operation.

const DEFAULT_TIMEZONE = "UTC";

export interface TemporalContextInput {
  // IANA zone name, e.g. "Asia/Kolkata", "America/New_York". Expected to
  // come from the client via Intl.DateTimeFormat().resolvedOptions().timeZone
  // — see the CLIENT SNIPPET at the bottom of this file for the one-liner
  // chat.js needs to add to every request body.
  timezone?: string | null;
}

/**
 * Returns the exact block to prepend to any prompt/system-message sent to
 * an LLM. Call this fresh per-request — never cache the string, since the
 * whole point is that it reflects the current moment.
 */
export function buildTemporalContext(input: TemporalContextInput = {}): string {
  const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
  const now = new Date();

  let formatted: string;
  let gmtOffset: string;

  try {
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(now);

    // Intl's "shortOffset" gives us "GMT+5:30" style directly — exactly
    // the format the user asked for, and it's DST-correct for zones that
    // observe it (unlike a hardcoded offset would be).
    const offsetPart = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName");
    gmtOffset = offsetPart?.value ?? "GMT+0:00";
  } catch (err) {
    // Invalid/unrecognized IANA zone name from a malformed client — fall
    // back to UTC rather than letting the whole prompt build throw.
    console.warn(`[TEMPORAL CONTEXT] Invalid timezone "${timezone}", falling back to UTC:`, err);
    formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: DEFAULT_TIMEZONE,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(now);
    gmtOffset = "GMT+0:00";
  }

  return `==================================================
CURRENT DATE & TIME
==================================================
${formatted} (${gmtOffset}, ${timezone})

Your training data has a knowledge cutoff before this date. Treat the date
above as real and current. Any event, release, or date at or before it has
already happened, even if you have no specific knowledge of it — not
knowing about something is not evidence it hasn't occurred. Do not reason
about "the future" relative to your training cutoff; reason relative to
the date above.
==================================================`;
}

/*
 * ── CLIENT SNIPPET (add to chat.js) ─────────────────────────────────────
 * Add this to the body of every fetch() that hits /api/chat, /api/chat/stream,
 * and /api/chat/agent-stream:
 *
 *   timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
 *
 * That reads the DEVICE's own timezone (whatever the OS/browser is set to),
 * not a hardcoded value — so it stays correct automatically if the user
 * travels or changes their system timezone, with zero manual sync logic
 * needed. For n0th1ng IoT (ESP32), send the equivalent IANA string if the
 * device knows it, or omit the field and let the server fall back to UTC.
 */
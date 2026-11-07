// api/lib/cutoffDetector.ts
//
// Detects when an LLM admits it cannot answer from its own knowledge base
// (due to knowledge cutoff, missing data, lack of real-time access, etc.)
// so the system can automatically fall back to live internet search.

export const KNOWLEDGE_CUTOFF_PATTERNS: RegExp[] = [
  /\bknowledge\s+cutoff\b/i,
  /\btraining\s+cutoff\b/i,
  /\bcutoff\s+(in|of|date)\b/i,
  /\bafter\s+my\s+(knowledge\s+cutoff|training\s+data|cutoff)\b/i,
  /\bbeyond\s+my\s+(knowledge\s+cutoff|training\s+data|cutoff|knowledge)\b/i,
  /\b(do\s+not|don'?t)\s+have\s+(any\s+)?(information|data|details|access)\s+(about|on|regarding)\b/i,
  /\b(do\s+not|don'?t)\s+have\s+access\s+to\s+(real-?time|live|current|the\s+internet|the\s+web)\b/i,
  /\b(do\s+not|don'?t)\s+have\s+(the\s+)?(ability|capability)\s+to\s+(browse|search|access)\b/i,
  /\b(cannot|unable\s+to)\s+(access|provide|retrieve)\s+(real-?time|current|live|up-to-date)\b/i,
  /\b(cannot|unable\s+to)\s+(browse|search)\s+the\s+(live\s+)?(internet|web)\b/i,
  /\bas\s+of\s+my\s+(last\s+update|training|cutoff)\b/i,
  /\b(not\s+in|outside\s+of)\s+my\s+training\s+data\b/i,
  /\bmy\s+training\s+data\s+(ended|ends|only\s+extends)\b/i,
  /\bmy\s+knowledge\s+(only\s+extends|ends|is\s+up\s+to)\b/i,
  /\b(do\s+not|don'?t)\s+know\s+the\s+(current|latest|recent)\b/i,
  /\bchecking\s+(recent|current)\s+news\s+sources\s+will\s+give\s+you\b/i,
  /\b(please\s+)?check\s+(recent|current|latest)\s+(news|sources|reports)\b/i,
  /\b(refer\s+to|consult)\s+(current|recent|latest)\s+(news|sources|a\s+search\s+engine)\b/i,
  /\bevents?\s+occurred\s+after\s+my\b/i,
  /\bmy\s+knowledge\s+is\s+limited\s+to\b/i,
  /\bI\s+cannot\s+browse\s+the\s+(live\s+)?internet\b/i,
  /\bI\s+do\s+not\s+have\s+the\s+ability\s+to\s+search\s+the\s+web\b/i,
  /\bknowledge\s+base\s+was\s+last\s+updated\b/i,
  /\b(information|events?)\s+(past|beyond|after)\s+(my\s+cutoff|\d{4})\b/i,
];

export function isKnowledgeCutoffRefusal(text: string): boolean {
  if (!text || text.length < 20) return false;
  return KNOWLEDGE_CUTOFF_PATTERNS.some((p) => p.test(text));
}

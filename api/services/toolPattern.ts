// ─────────────────────────────────────────────────────────────────────────────
// toolPattern.ts
//
// Stage 2 of the tool resolution cascade (see toolRouter.ts).
//
// This is a DELIBERATELY SEPARATE pattern set from `triggers` in tools.ts.
// `triggers` are loose keyword hints meant to bias an LLM's judgment — they
// overlap heavily across tools on purpose (e.g. "current" appears near both
// internet_search and research_query intent) because the LLM is expected to
// disambiguate using full context.
//
// Regex has no judgment. If we reused `triggers` as-is, near-identical phrases
// across tools would fire together on almost every message, and Stage 2 would
// send everything to Stage 3 anyway — defeating the point of having a cheap
// regex stage at all.
//
// So every pattern here is written to be as UNIQUE and ANCHORED as possible:
//   • Prefer whole-phrase matches over single words.
//   • Avoid single common words as standalone patterns (no bare "current",
//     "recent", "explain" etc.) — these are exactly what caused ambiguity
//     upstream in `triggers`.
//   • Where two tools are inherently confusable (the vision/document cluster,
//     internet_search vs research_query, knowledge_search vs file_search,
//     model_manager vs ollama_control), that pairing is registered explicitly
//     in CONFUSABLE_CLUSTERS so matchPatterns() can detect the collision and
//     hand it to Stage 3 instead of guessing.
// ─────────────────────────────────────────────────────────────────────────────

// ── Types ──────────────────────────────────────────────────────────────────

export interface PatternMatch {
  tool: string;
  /** The specific pattern(s) that fired, for logging/debugging. */
  matchedOn: string[];
}

export type PatternResolution =
  | { status: "none" }
  | { status: "clean"; matches: PatternMatch[] }
  | { status: "ambiguous"; matches: PatternMatch[]; reason: string };

// ── Pattern set ────────────────────────────────────────────────────────────
// Each tool maps to an array of RegExp. Patterns are case-insensitive.
// Kept as whole-phrase / multi-word anchors wherever possible so that two
// unrelated tools rarely both fire on the same message.

const TOOL_PATTERNS: Record<string, RegExp[]> = {

  // ── Knowledge / Files ────────────────────────────────────────────────────

  knowledge_search: [
    /\bin\s+my\s+(documents|files|notes|knowledge\s*base)\b/i,
    /\bmy\s+uploaded\s+files?\b/i,
    /\bsearch\s+(my|through\s+my|across\s+my)\s+(notes|documents|files|knowledge\s*base|library)\b/i,
    /\bfind\s+in\s+my\s+(project|notes|documents|files)\b/i,
    /\bacross\s+all\s+my\s+(files|documents|notes)\b/i,
    /\bwhat\s+do\s+my\s+(notes|documents|files)\s+say\b/i,
    /\bdo\s+i\s+have\s+(any(thing)?|a\s+(file|note|document))\s+(about|on|related\s+to)\b/i,
    /\blook\s+(through|across)\s+my\s+(notes|documents|files|knowledge\s*base)\b/i,
    /\bsearch\s+all\s+(my\s+)?(uploaded\s+)?(files|documents|notes)\b/i,
    /\bcheck\s+my\s+(notes|documents|files|knowledge\s*base)\s+for\b/i,
    /\bhave\s+i\s+(written|saved|uploaded|stored)\s+anything\s+(about|on)\b/i,
    /\bwhat('?s|\s+is)\s+in\s+my\s+(knowledge\s*base|notes|files|documents)\b/i,
    /\bfind\s+(that|the)\s+(note|document|file)\s+(about|on|where)\b/i,
    /\bpull\s+up\s+(my\s+)?(notes?|files?|documents?)\s+(on|about)\b/i,
    /\bsearch\s+my\s+(personal\s+)?(knowledge\s*base|vault|library)\b/i,
  ],

  file_search: [
    /\bin\s+(this|that)\s+file\b/i,
    /\binside\s+the\s+file\b/i,
    /\bsearch\s+(the|this|that)\s+(pdf|csv|document|file|spreadsheet)\b/i,
    /\bfind\s+in\s+(the|this|that)\s+document\b/i,
    /\bwithin\s+this\s+(file|document)\b/i,
    /\bin\s+the\s+file\s+i\s+(uploaded|attached|sent|gave\s+you)\b/i,
    /\bsearch\s+for\s+.+\s+in\s+(this|that|the)\s+(pdf|csv|doc|document|file)\b/i,
    /\bdoes\s+(this|that)\s+(file|document|pdf)\s+(mention|contain|say)\b/i,
    /\bfind\s+(the\s+)?(section|part|page)\s+(in|of)\s+(this|that)\s+(file|document|pdf)\b/i,
    /\blook\s+(inside|in)\s+(this|that)\s+(file|document|pdf|attachment)\b/i,
    /\bsearch\s+(the\s+)?attach(ed|ment)\b/i,
    /\bin\s+the\s+attached\s+(file|document|pdf|csv)\b/i,
  ],

  // ── Internet / Research ──────────────────────────────────────────────────

  internet_search: [
    /\bsearch\s+the\s+(web|internet|net)\b/i,
    /\bgoogle\s+(this|that|it|for\s+me|the|what)\b/i,
    /\blook\s+up\s+(the\s+)?(current|latest)?\s*(price|news|score|rate|stock)\b/i,
    /\bwhat('?s|\s+is)\s+the\s+(current\s+)?price\s+of\b/i,
    /\bwhat('?s|\s+is)\s+the\s+(current\s+)?weather\s+in\b/i,
    /\bwhat('?s|\s+is)\s+the\s+(current\s+)?(exchange\s+rate|conversion\s+rate)\b/i,
    /\blatest\s+news\s+(on|about)\b/i,
    /\bany\s+(recent|breaking)\s+news\s+(on|about)\b/i,
    /\bwhat('?s|\s+is)\s+happening\s+(right\s+now|today|currently)\b/i,
    /\bquick(ly)?\s+(search|look\s*up|check|google)\b/i,
    /\bwho\s+won\s+(the\s+)?.+\s+(game|match|election|award)\b/i,
    /\bwhat('?s|\s+is)\s+(today'?s|the\s+current)\s+date\b/i,
    /\bis\s+.+\s+(still\s+)?(open|closed)\s+(right\s+now|today)\b/i,
    /\bcheck\s+(the\s+)?(current\s+)?(price|weather|news|score|status)\s+of\b/i,
    /\bhow\s+much\s+(does|is)\s+.+\s+cost\s+(right\s+now|today|currently)\b/i,
    /\bfind\s+out\s+(what|who|when|where)\b.*\b(now|today|currently|recently)\b/i,
    /\bwhat\s+time\s+is\s+it\s+in\b/i,
    /\bcurrent\s+(stock|crypto|bitcoin|market)\s+price\b/i,
  ],

  research_query: [
    /\bdo\s+(a\s+)?(deep|detailed|comprehensive|thorough)\s+(dive|research|analysis)\b/i,
    /\bresearch\s+(this|that|the|on|into)\b/i,
    /\bcompare\s+.+\s+(vs\.?|versus|and|against)\s+/i,
    /\bcomprehensive\s+(breakdown|analysis|overview|summary)\b/i,
    /\bdetailed\s+(breakdown|comparison|analysis|review|report)\b/i,
    /\bin[\s-]depth\s+(look|analysis|breakdown|review)\b/i,
    /\b(specs|specifications)\s+(of|for)\b/i,
    /\bwrite\s+(a|me)\s+(a\s+)?review\s+of\b/i,
    /\binvestigate\s+(this|that|the)\b/i,
    /\bpros\s+and\s+cons\s+of\b/i,
    /\bwhich\s+(is|one\s+is)\s+better\s*[,:]?\s*.+\s+or\b/i,
    /\bgive\s+me\s+(a|an)\s+(overview|breakdown|rundown)\s+of\b/i,
    /\bwhat\s+are\s+the\s+differences?\s+between\b/i,
    /\bhelp\s+me\s+(decide|choose)\s+between\b/i,
    /\bput\s+together\s+a\s+(report|summary|comparison)\s+(on|about)\b/i,
    /\beverything\s+(you\s+can\s+find\s+)?about\b/i,
  ],

  url_reader: [
    /https?:\/\/\S+/i,
    /www\.\S+\.\S+/i,
    /\bread\s+this\s+(link|url|page|article)\b/i,
    /\bopen\s+this\s+(link|url|page)\b/i,
    /\bsummarize\s+this\s+(link|url|page|article)\b/i,
    /\bwhat\s+does\s+this\s+(link|page|article)\s+say\b/i,
    /\bcheck\s+out\s+this\s+(link|url|page)\b/i,
    /\bgo\s+to\s+this\s+(link|url|page|site)\b/i,
    /\bfetch\s+this\s+(link|url|page)\b/i,
  ],

  // ── Vision / Document (local Python runtime) ─────────────────────────────
  // These four are the most confusable cluster in the whole tool set — see
  // CONFUSABLE_CLUSTERS below. Patterns here still try to stay specific.

  local_vision_ocr: [
    /\bextract\s+(the\s+)?text\s+from\s+(this|the)\s+image\b/i,
    /\bocr\s+this\b/i,
    /\brun\s+ocr\s+on\b/i,
    /\bread\s+the\s+text\s+in\s+this\b/i,
    /\btranscribe\s+this\s+(image|screenshot|photo|picture)\b/i,
    /\bwhat\s+does\s+this\s+(say|text\s+say)\b/i,
    /\bread\s+this\s+(receipt|handwriting|id|form|label|sign)\b/i,
    /\bscan\s+this\s+document\b/i,
    /\bget\s+(the\s+)?text\s+(out\s+of|from)\s+this\s+(image|photo|screenshot)\b/i,
    /\btype\s+out\s+what\s+this\s+(says|image\s+says)\b/i,
    /\bconvert\s+this\s+(image|screenshot|photo)\s+to\s+text\b/i,
    /\bwhat\s+words?\s+(are|is)\s+(in|on)\s+this\s+(image|photo)\b/i,
    /\bread\s+(out\s+)?the\s+(text|words|writing)\s+on\s+this\b/i,
  ],

  layout_analyzer: [
    /\banalyze\s+the\s+layout\b/i,
    /\bdocument\s+structure\b/i,
    /\bdetect\s+tables?\s+in\s+this\s+image\b/i,
    /\bpage\s+layout\b/i,
    /\bfind\s+the\s+sections?\b/i,
    /\bidentify\s+the\s+regions?\b/i,
    /\bwhere\s+are\s+the\s+tables\b/i,
    /\bdetect\s+headings?\b/i,
    /\bhow\s+is\s+this\s+(document|page)\s+(structured|organized|laid\s+out)\b/i,
    /\bidentify\s+the\s+(headers?|columns?|paragraphs?)\s+in\s+this\b/i,
    /\bmap\s+out\s+the\s+layout\s+of\b/i,
    /\bbreak\s+down\s+the\s+(structure|layout)\s+of\s+this\s+(page|document|image)\b/i,
    /\bwhat\s+sections?\s+does\s+this\s+(document|page)\s+have\b/i,
  ],

  marker_pdf_pipeline: [
    /\bparse\s+this\s+pdf\b/i,
    /\bextract\s+(from|the)\s+pdf\b/i,
    /\bconvert\s+(this\s+)?pdf\s+to\s+markdown\b/i,
    /\bread\s+this\s+pdf\b/i,
    /\bpdf\s+table\s+of\s+contents\b/i,
    /\bextract\s+tables?\s+from\s+(the\s+)?pdf\b/i,
    /\bpdf\s+(structure|metadata)\b/i,
    /\.pdf\b/i,
    /\bopen\s+this\s+pdf\b/i,
    /\bwhat('?s|\s+is)\s+in\s+this\s+pdf\b/i,
    /\bsummarize\s+this\s+pdf\b/i,
    /\bgo\s+through\s+this\s+pdf\b/i,
    /\bprocess\s+this\s+pdf\b/i,
    /\bpull\s+(the\s+)?(text|data|tables?)\s+(out\s+of|from)\s+this\s+pdf\b/i,
    /\bconvert\s+(this\s+)?pdf\s+to\s+text\b/i,
  ],

  local_vision_analyzer: [
    /\bdescribe\s+this\s+image\b/i,
    /\bexplain\s+this\s+image\b/i,
    /\bwhat('?s|\s+is)\s+in\s+this\s+image\b/i,
    /\bwhat\s+does\s+this\s+image\s+show\b/i,
    /\bexplain\s+this\s+(diagram|chart|graph)\b/i,
    /\bwhat\s+objects?\s+(are\s+in|is\s+in)\b/i,
    /\bdescribe\s+the\s+scene\b/i,
    /\banalyze\s+this\s+screenshot\b/i,
    /\bwhat('?s|\s+is)\s+happening\s+in\s+this\s+image\b/i,
    /\bwhat\s+am\s+i\s+looking\s+at\b/i,
    /\bcan\s+you\s+(tell\s+me\s+about|describe|explain)\s+this\s+(image|picture|photo|screenshot)\b/i,
    /\bwhat\s+do\s+you\s+see\s+in\s+this\b/i,
    /\bidentify\s+what('?s|\s+is)\s+in\s+this\s+(image|photo|picture)\b/i,
    /\btell\s+me\s+about\s+this\s+(picture|photo|image)\b/i,
    /\banalyze\s+this\s+(image|photo|picture)\b/i,
    /\bwho\s+(is|are)\s+(in\s+)?this\s+(image|photo|picture)\b/i,
  ],

  // ── Memory ────────────────────────────────────────────────────────────────

  memory_store: [
    /\bremember\s+(that|this)\b/i,
    /\bkeep\s+(this|that)\s+in\s+mind\b/i,
    /\bi\s+want\s+you\s+to\s+know\b/i,
    /\bnote\s+that\b/i,
    /\bmemorize\s+(this|that)\b/i,
    /\bdon'?t\s+forget\s+that\b/i,
    /\bstore\s+this\b/i,
    /\bfor\s+future\s+reference\b/i,
    /\bjust\s+so\s+you\s+know\s+(going\s+forward|for\s+later)\b/i,
    /\bplease\s+remember\b/i,
    /\bsave\s+this\s+(fact|info|information|detail)\b/i,
    /\bkeep\s+track\s+that\b/i,
    /\bfrom\s+now\s+on\s*,?\s*(i|my)\b/i,
    /\bmy\s+\w+\s+is\s+\w+.{0,20}\bremember\b/i,
  ],

  memory_search: [
    /\bwhat\s+do\s+you\s+remember\s+(about\s+)?me\b/i,
    /\bdo\s+you\s+know\s+my\b/i,
    /\bwhat\s+have\s+i\s+told\s+you\b/i,
    /\brecall\s+(what|my)\b/i,
    /\bcheck\s+my\s+preferences\b/i,
    /\blook\s+up\s+my\s+(preferences|info|memory)\b/i,
    /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
    /\bdid\s+i\s+(tell|mention\s+to)\s+you\b/i,
    /\bwhat('?s|\s+is)\s+my\s+(favorite|preferred|usual)\b/i,
    /\bremind\s+me\s+what\s+(i|my)\b/i,
    /\bpull\s+up\s+what\s+you\s+know\s+about\s+me\b/i,
    /\bremember\s+what\s+(i|I)\s+(told|said)\s+you\b/i,
    /\bwhat\s+did\s+i\s+(tell|say\s+to)\s+you\s+about\b/i,
  ],

  memory_update: [
    /\bupdate\s+my\b/i,
    /\bmy\s+\w+\s+is\s+now\b/i,
    /\bi\s+switched\s+to\b/i,
    /\bi\s+now\s+use\b/i,
    /\breplace\s+my\b/i,
    /\bcorrect\s+that\s+memory\b/i,
    /\bchange\s+my\s+\w+\s+to\b/i,
    /\bactually\s*,?\s+my\s+\w+\s+is\b/i,
    /\bthat'?s\s+(wrong|outdated)\s*[,.]?\s+(my|it'?s\s+actually)\b/i,
    /\bupdate\s+that\s+(info|information|memory|detail)\b/i,
    /\bi'?ve\s+moved\s+to\b/i,
    /\bfix\s+what\s+you\s+have\s+(saved|stored)\s+about\s+my\b/i,
  ],

  memory_delete: [
    /\bforget\s+(that|about|my)\b/i,
    /\bforget\s+what\s+(i|I)\s+(told|said)\s+you\b/i,
    /\bdelete\s+(that\s+)?memory\b/i,
    /\bremove\s+(that\s+)?memory\b/i,
    /\berase\s+(that|my)\b/i,
    /\bclear\s+that\s+memory\b/i,
    /\bplease\s+forget\s+what\s+i\s+said\s+about\b/i,
    /\bstop\s+remembering\s+(that|my)\b/i,
    /\bdelete\s+what\s+you\s+know\s+about\s+my\b/i,
    /\bwipe\s+that\s+(memory|info|information)\b/i,
    /\btake\s+that\s+out\s+of\s+memory\b/i,
  ],

  // ── System / Compute ──────────────────────────────────────────────────────

  scientific_calculator: [
    /\bcalculate\s+.+/i,
    /\bcompute\s+.+/i,
    /\bwhat\s+is\s+\d+(\.\d+)?\s*[+\-*/^%]\s*\d+/i,
    /\bconvert\s+\d+(\.\d+)?\s*\w+\s+to\s+\w+/i,
    /\bsolve\s+(this|the)\s+equation\b/i,
    /\d+\s*%\s+of\s+\d+/i,
    /\bwhat('?s|\s+is)\s+the\s+square\s+root\s+of\b/i,
    /\bhow\s+much\s+is\s+\d+(\.\d+)?\s*[+\-*/^%]\s*\d+/i,
    /\bwork\s+out\s+\d+/i,
    /\bfigure\s+out\s+what\s+\d+.+equals?\b/i,
    /\bdo\s+the\s+math\s+(for|on)\b/i,
    /\bwhat('?s|\s+is)\s+\d+(\.\d+)?\s*(divided|multiplied)\s+by\s+\d+/i,
    /\bwhat('?s|\s+is)\s+the\s+(sum|product|average|mean)\s+of\b/i,
  ],

  system_monitor: [
    /\bcpu\s+usage\b/i,
    /\bram\s+usage\b/i,
    /\bgpu\s+usage\b/i,
    /\bvram\b/i,
    /\bsystem\s+stats\b/i,
    /\bsystem\s+statistics\b/i,
    /\bhardware\s+stats\b/i,
    /\bdisk\s+usage\b/i,
    /\btemperature\s+(of\s+)?(my\s+)?(cpu|gpu|system)\b/i,
    /\bhow'?s?\s+my\s+(system|machine|computer|pc)\s+(doing|running)\b/i,
    /\bmemory\s+usage\b/i,
    /\bhow\s+much\s+(ram|memory|disk|vram)\s+(am\s+i\s+using|is\s+(free|used|available))\b/i,
    /\bsystem\s+(health|load|resources)\b/i,
    /\bcheck\s+(my\s+)?(cpu|gpu|ram|disk|system)\s+(usage|status|health)\b/i,
  ],

  model_manager: [
    /\binstalled\s+models\b/i,
    /\bavailable\s+models\b/i,
    /\blist\s+(the\s+)?models\b/i,
    /\bwhat\s+models\s+(do\s+i\s+have|are\s+installed)\b/i,
    /\bmodel\s+sizes?\b/i,
    /\bwhat\s+models\s+(can|do)\s+i\s+use\b/i,
    /\bshow\s+me\s+(the\s+)?(installed|available)\s+models\b/i,
    /\bwhich\s+models\s+are\s+(installed|available|downloaded)\b/i,
    /\bmodels\s+on\s+(disk|this\s+machine|my\s+system)\b/i,
  ],

  ollama_control: [
    /\brunning\s+models\b/i,
    /\bloaded\s+models\b/i,
    /\bactive\s+models\b/i,
    /\bmodels\s+in\s+memory\b/i,
    /\bwhat('?s|\s+is)\s+(currently\s+)?running\b/i,
    /\bcurrently\s+loaded\b/i,
    /\bwhich\s+models?\s+(is|are)\s+(currently\s+)?(running|loaded|active)\b/i,
    /\bwhat('?s|\s+is)\s+using\s+(the\s+)?(gpu|vram)\s+right\s+now\b/i,
    /\bstop\s+(the\s+)?running\s+model\b/i,
    /\bunload\s+(the\s+)?model\b/i,
  ],

  sql_query: [
    /\bconversation\s+history\b/i,
    /\bhow\s+many\s+messages\b/i,
    /\bstored\s+files\b/i,
    /\bchat\s+history\b/i,
    /\bdatabase\s+stats?\b/i,
    /\bhow\s+many\s+\w+\s+are\s+stored\b/i,
    /\bhow\s+many\s+(conversations|chats|files|documents)\s+(do\s+i\s+have|are\s+there)\b/i,
    /\bshow\s+me\s+(the\s+)?database\s+(stats|statistics|info)\b/i,
    /\bhow\s+much\s+data\s+(is|has\s+been)\s+stored\b/i,
    /\bquery\s+the\s+database\b/i,
  ],

};

// ── Confusable clusters ───────────────────────────────────────────────────
// If two (or more) tools in the SAME cluster both fire on one message, that
// is treated as ambiguous even though each individual match was "clean" —
// these pairs are known to overlap in real phrasing and need real judgment
// (argument extraction, intent depth, file type) that regex can't provide.

const CONFUSABLE_CLUSTERS: string[][] = [

  // The vision/document quartet — near-impossible to fully separate by
  // phrasing alone (e.g. "read this document" could mean OCR or layout).
  [
    "local_vision_ocr",
    "layout_analyzer",
    "marker_pdf_pipeline",
    "local_vision_analyzer",
  ],

  // Depth-of-search pair — "research the latest price of X" legitimately
  // triggers both a quick-fact pattern and a research pattern.
  ["internet_search", "research_query"],

  // Local-content search pair — "search this file in my notes" territory.
  ["knowledge_search", "file_search"],

  // Installed vs running models — "what models do I have running" fires both.
  ["model_manager", "ollama_control"],

  // Memory read/write pair — "remember what I told you" can look like both
  // a store and a search depending on tense.
  ["memory_store", "memory_search"],

  // Memory write/overwrite pair — "update" vs "remember that X is now Y".
  ["memory_store", "memory_update"],

];

function findClusterFor(toolA: string, toolB: string): string[] | null {
  for (const cluster of CONFUSABLE_CLUSTERS) {
    if (cluster.includes(toolA) && cluster.includes(toolB)) return cluster;
  }
  return null;
}

// ── Core matcher ──────────────────────────────────────────────────────────

/**
 * Run the message through every tool's pattern set and collect raw matches
 * (tool name + which specific patterns fired). Does NOT yet apply cluster
 * ambiguity logic — see matchPatterns() below for the full resolution.
 */
function rawMatch(message: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  for (const [tool, patterns] of Object.entries(TOOL_PATTERNS)) {
    const hits: string[] = [];

    for (const pattern of patterns) {
      if (pattern.test(message)) {
        hits.push(pattern.source);
      }
    }

    if (hits.length > 0) {
      matches.push({ tool, matchedOn: hits });
    }
  }

  return matches;
}

/**
 * Stage 2 entry point.
 *
 * Returns:
 *   - { status: "none" }        → no patterns fired at all → Stage 3 handles
 *                                  tool selection from scratch.
 *   - { status: "clean", ... }  → one match per intent, no confusable-cluster
 *                                  collisions → use these matches directly.
 *   - { status: "ambiguous", .. } → two or more matched tools collide inside
 *                                  a known confusable cluster → hand off to
 *                                  Stage 3 with the raw matches attached so
 *                                  the small model has a head start instead
 *                                  of starting cold.
 */
export function matchPatterns(message: string): PatternResolution {
  const matches = rawMatch(message);

  if (matches.length === 0) {
    return { status: "none" };
  }

  if (matches.length === 1) {
    return { status: "clean", matches };
  }

  // Multiple tools matched — check whether any pair collides inside a
  // known confusable cluster. If so, the whole result is ambiguous.
  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      const cluster = findClusterFor(matches[i].tool, matches[j].tool);
      if (cluster) {
        return {
          status: "ambiguous",
          matches,
          reason:
            `'${matches[i].tool}' and '${matches[j].tool}' both matched and ` +
            `belong to the same confusable cluster [${cluster.join(", ")}].`,
        };
      }
    }
  }

  // Multiple tools matched but none of them are known to be confusable with
  // each other (e.g. a message that legitimately wants both internet_search
  // AND system_monitor). Treat as clean — these are independent, parallel
  // intents, not an ambiguous single intent.
  return { status: "clean", matches };
}

// ── Argument defaults for regex-resolved matches ─────────────────────────
// Regex can identify a tool but cannot extract structured arguments (a file
// path, a parsed expression, etc.). For tools whose primary argument is
// reasonably "the user's raw message" (query-shaped tools), we can supply a
// sane default. Tools requiring real extraction (image_path, pdf_path, key/
// value pairs) are NOT covered here — matchPatterns() callers must route
// those through Stage 3 for argument fill-in even if the tool name itself
// was resolved cleanly.

const RAW_MESSAGE_ARG: Record<string, string> = {
  knowledge_search: "query",
  file_search: "query",
  internet_search: "query",
  research_query: "query",
  memory_search: "query",
  sql_query: "query",
  scientific_calculator: "expression",
};

const URL_PATTERN = /https?:\/\/\S+/i;

/**
 * Best-effort argument builder for a clean regex match. Returns null if this
 * tool's arguments can't be reasonably derived from the raw message alone —
 * callers should treat null as "still needs Stage 3 for arguments."
 */
export function buildDefaultArguments(
  tool: string,
  message: string
): Record<string, string> | null {

  if (tool === "url_reader") {
    const found = message.match(URL_PATTERN);
    return found ? { url: found[0] } : null;
  }

  const argKey = RAW_MESSAGE_ARG[tool];
  if (!argKey) return null;

  return { [argKey]: message.trim() };
}
// api/services/intentClassifier.ts
//
// Tier 0 Fast-Path Intent Classifier.
// Categorizes incoming user prompts in <1ms without invoking heavy LLMs:
// 1. GREETING: Quick greetings ("Hi", "Hello", "Good morning")
// 2. CASUAL: Casual chit-chat / wellbeing / pleasantries ("How have you been?", "How's it going?", "Who are you?", "Tell me a joke")
// 3. GENERAL: Informational, intellectual, FAQ, and conceptual questions ("What is photosynthesis?", "Explain quantum computing", FAQs).
//    Directly integrates with Tier 0 Point 2: Semantic Response Caching!
// 4. RAG_QUERY: User specifically referencing uploaded attachments / selected knowledge files.
// 5. TOOL_TASK: Calculations, system monitor, internet search, OCR, SQL, memory operations, model controls.

export type IntentCategory =
  | "GREETING"
  | "CASUAL"
  | "GENERAL"
  | "RAG_QUERY"
  | "TOOL_TASK";

export interface IntentClassificationResult {
  category: IntentCategory;
  confidence: number;
  reason: string;
}

export interface IntentContextInput {
  hasAttachments?: boolean;
  hasSelectedFiles?: boolean;
  conversationContext?: string;
}

// ── Patterns ─────────────────────────────────────────────────────────────────

const GREETING_PATTERNS: RegExp[] = [
  /^\s*(hi|hey|hello|yo|sup|hiya|howdy)(\s+(there|everyone|all|friend|assistant|bot|folks))?[\s!.,]*$/i,
  /^\s*(good\s*(morning|afternoon|evening|day))(\s+(there|everyone|all))?[\s!.,]*$/i,
  /^\s*(greetings|salutations|welcome)[\s!.,]*$/i,
];

const CASUAL_PATTERNS: RegExp[] = [
  // Wellbeing / How are you variations
  /^\s*how\s*(are|r)\s*(you|u|ya)(\s+(doing|feeling|holding\s+up))?(\s+(today|now|lately))?[\s?!.,]*$/i,
  /^\s*how\s*(have\s*you\s*been|has\s*it\s*been)(\s+(doing|feeling))?(\s+(lately|recently|today))?[\s?!.,]*$/i,
  /^\s*how('?s|\s+is)\s*(it\s*going|everything|life|your\s*day|things)(\s+(today|with\s+you))?[\s?!.,]*$/i,
  /^\s*what'?s\s*up(\s+(with\s+you|today))?[\s?!.,]*$/i,
  /^\s*what\s*are\s*you\s*(doing|up\s*to)[\s?!.,]*$/i,

  // Identity / Capabilities / Persona
  /^\s*(who\s*are\s*you|what\s*(are|r)\s*(you|u)|what'?s\s*your\s*name)[\s?!.,]*$/i,
  /^\s*(tell\s*me\s*about\s*yourself|introduce\s*yourself)[\s?!.,]*$/i,
  /^\s*(what\s*can\s*you\s*do|what\s*are\s*your\s*capabilities)[\s?!.,]*$/i,

  // Pleasantries / Acknowledgements / Closings
  /^\s*(thanks|thank\s*you|thx|ty|cheers|appreciated?)(\s+(a\s+lot|so\s+much|very\s+much))?[\s!.,]*$/i,
  /^\s*(ok|okay|k|kk|cool|nice|great|got\s*it|sounds\s*good|alright|sure|fine|perfect)[\s!.,]*$/i,
  /^\s*(bye|goodbye|see\s*ya|see\s*you|later|take\s*care|good\s*night)(\s+(later|soon))?[\s!.,]*$/i,
  /^\s*(yes|no|yep|nope|yeah|nah|yup)[\s!.,]*$/i,
  /^\s*(lol|lmao|haha+|hehe+)[\s!.,]*$/i,
  /^\s*(tell\s*me\s*a\s*joke|make\s*me\s*laugh)[\s?!.,]*$/i,
];

// Tool indicators (Computation, System Monitoring, Web search, Memory, SQL, OCR)
const TOOL_PATTERNS: RegExp[] = [
  // Math / Calculations
  /^\s*[\d\(\)\.\+\-\*\/%^ ]+$/,
  /\b(calculate|compute|solve|conversion|convert)\b/i,
  /\b\d+(\.\d+)?\s*[\+\-\*\/^%]\s*\d+(\.\d+)?\b/,
  /\b(square\s*root|sqrt|sin|cos|tan|log|factorial)\b/i,

  // System Monitor / Hardware stats
  /\b(cpu|ram|memory|gpu|disk|vram|system\s+monitor|system\s+info|systeminformation|specs|running\s+processes)\b/i,

  // Internet Search / Live Info / Real-time Events
  /\b(search\s+(the\s+)?(web|internet|net)|google(\s+this|\s+that|\s+for|\s+what)?|browse\s+(online|the\s+web)|look\s+up\s+online|find\s+online)\b/i,
  /\b(current|currently|latest|recent|recently|today'?s?|tonight|now|right\s+now|this\s+(week|month|year)|newest|breaking|upcoming|ongoing)\b.*\b(election|midterm|vote|voting|results?|poll(s)?|president(ial)?|prime\s+minister|senate|congress|governor|news|headline(s)?|event(s)?|developments?|winner(s)?|score(s)?|game|match|standings|stock(s)?|price(s)?|rate(s)?|inflation|gdp|crypto|bitcoin|weather|temperature|forecast|outage|status|update(s)?|release(d)?|version|announcement(s)?|scandal|war|conflict)\b/i,
  /\b(election|midterm|vote|voting|results?|poll(s)?|president(ial)?|prime\s+minister|news|headline(s)?|event(s)?|developments?|winner(s)?|score(s)?|game|match|stock(s)?|price(s)?|crypto|bitcoin|weather|status|update(s)?)\b.*\b(current|currently|latest|recent|recently|today'?s?|now|right\s+now|this\s+(week|month|year)|newest|breaking)\b/i,
  /\b(midterm\s+election|election\s+results?|who\s+won\b|who\s+is\s+winning|who\s+is\s+(the\s+)?(current|now\s+the)\s+(president|prime\s+minister|ceo|leader|governor|champion|winner))\b/i,
  /\bwho\s+is\s+(the\s+)?(current\s+)?(president|prime\s+minister|ceo|leader|governor|mayor|chancellor|pope|king|queen)\s+of\b/i,
  /\b(who\s+won|who\s+is\s+winning|winner\s+of)\s+(the\s+)?(super\s*bowl|world\s*cup|champions\s*league|oscar(s)?|grammy(s)?|election|nba|fifa|olympics?)\b/i,
  /\b(what\s+do\s+you\s+think\s+about|what('?s|\s+is)\s+your\s+take\s+on)\s+(the\s+)?(current|latest|recent|upcoming|ongoing)\b/i,
  /\bwhat('?s|\s+is)\s+happening\s+(with|in|to|right\s+now|today|currently)\b/i,
  /\bwhat\s+happened\s+(to|with|in)\s+.+\s+(today|yesterday|recently|this\s+week|this\s+month|this\s+year)\b/i,
  /\b(is|has)\s+.+\s+(launched|released|died|resigned|stepped\s+down|canceled|cancelled|started)\s+(yet|recently|today)\b/i,
  /\b(latest|current|recent)\s+(status|version|release|specifications|specs|features)\s+(of|for)\b/i,
  /\b(any\s+)?(recent|breaking|latest)\s+(news|updates?|headlines?)\b/i,
  /\bcheck\s+(the\s+)?(current\s+)?(price|weather|news|score|status|update)\s+of\b/i,
  /\bhow\s+much\s+(does|is)\s+.+\s+(cost|worth)\s+(now|today|currently|right\s+now)\b/i,
  /\bwhat\s+is\s+the\s+(current\s+)?(weather|temperature|forecast)\s+in\b/i,
  /\bwhat\s+is\s+the\s+(current\s+)?price\s+of\b/i,

  // Model & Ollama Management
  /\b(ollama|list\s+models|show\s+models|unload\s+model|pull\s+model|loaded\s+models)\b/i,

  // Database / SQL
  /\b(sql|query\s+database|select\s+.*\s+from|database\s+table)\b/i,

  // Memory store / manage
  /\b(remember\s+(that|this)|forget\s+(that|this)|save\s+to\s+memory|delete\s+memory|update\s+memory)\b/i,

  // Vision / OCR / PDF extraction
  /\b(ocr|read\s+text\s+from\s+image|extract\s+text\s+from\s+(image|pdf)|analyze\s+(image|layout))\b/i,
];

// RAG indicators (referring specifically to files/documents/PDFs)
const RAG_EXPLICIT_PATTERNS: RegExp[] = [
  /\b(in|from|according\s+to|check|find\s+in|search\s+in)\s+(the|this|my|that)?\s*(uploaded\s+|attached\s+)?(document|pdf|file|attachment|cv|resume|paper|notes|contract|report)\b/i,
  /\b(summarize|read|search|extract\s+from)\s+(the|this|my|that)?\s*(uploaded\s+|attached\s+)?(document|pdf|file|attachment|cv|resume)\b/i,
  /\bwhat\s+does\s+(the|this|my|that)?\s*(uploaded\s+|attached\s+)?(document|pdf|file|attachment)\s+say\b/i,
  /\b(based\s+on\s+(the|my|that)?\s*(uploaded\s+|attached\s+)?(file|document|attachment|pdf))\b/i,
];

// General Intellectual / Conceptual / Informational questions
const GENERAL_QUESTION_PATTERNS: RegExp[] = [
  /\b(what\s+is|what\s+are|what\s+does\s+.*\s+mean)\b/i,
  /\b(how\s+does|how\s+do|how\s+can|how\s+is)\b/i,
  /\b(why\s+is|why\s+are|why\s+does|why\s+do)\b/i,
  /\b(explain|describe|clarify|elaborate\s+on)\b/i,
  /\b(difference\s+between|compare\s+.*\s+and)\b/i,
  /\b(tell\s+me\s+about|teach\s+me|overview\s+of|history\s+of)\b/i,
  /\b(give\s+me\s+(tips|advice|ideas|examples|a\s+summary|reasons))\b/i,
  /\b(can\s+you\s+write|draft|generate|help\s+me\s+with)\b/i,
];

/**
 * Fast-path intent classification running in <1ms without LLM prefill.
 */
export function classifyIntent(
  prompt: string,
  context: IntentContextInput = {}
): IntentClassificationResult {
  const trimmed = prompt.trim();

  if (!trimmed) {
    return { category: "CASUAL", confidence: 1.0, reason: "Empty prompt" };
  }

  // 1. Check GREETING
  if (GREETING_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      category: "GREETING",
      confidence: 0.99,
      reason: "Matched fast greeting pattern",
    };
  }

  // 2. Check CASUAL (Wellbeing, identity, basic small talk)
  if (CASUAL_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      category: "CASUAL",
      confidence: 0.98,
      reason: "Matched casual conversation pattern",
    };
  }

  // 3. Check RAG_QUERY (explicit document query or attachments presence)
  if (RAG_EXPLICIT_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      category: "RAG_QUERY",
      confidence: 0.95,
      reason: "Matched explicit document reference pattern",
    };
  }

  // If attachments or selected files are present and user asks question about them
  if (
    (context.hasAttachments || context.hasSelectedFiles) &&
    /\b(file|document|pdf|this|image|it|text)\b/i.test(trimmed)
  ) {
    return {
      category: "RAG_QUERY",
      confidence: 0.9,
      reason: "Attachments present with contextual reference",
    };
  }

  // 4. Check TOOL_TASK
  if (TOOL_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      category: "TOOL_TASK",
      confidence: 0.92,
      reason: "Matched tool execution keyword/pattern",
    };
  }

  // 5. Check GENERAL (Intellectual, FAQ, conceptual knowledge)
  if (GENERAL_QUESTION_PATTERNS.some((p) => p.test(trimmed))) {
    return {
      category: "GENERAL",
      confidence: 0.9,
      reason: "Matched intellectual/conceptual question pattern",
    };
  }

  // Fallback heuristic:
  // If short and conversational without file/tool triggers -> CASUAL or GENERAL
  if (trimmed.length < 50 && !trimmed.includes("?")) {
    return {
      category: "CASUAL",
      confidence: 0.75,
      reason: "Short non-question fallback",
    };
  }

  // Default substantive query without tool triggers -> GENERAL
  return {
    category: "GENERAL",
    confidence: 0.8,
    reason: "Substantive knowledge question fallback",
  };
}

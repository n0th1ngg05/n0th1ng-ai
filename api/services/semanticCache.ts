// api/services/semanticCache.ts
//
// Tier 0 Point 2: Semantic Response Caching
// Provides sub-50ms TTFT for FAQs, Common Chit-Chat, and Intellectual / General queries.
// Uses a 2-tier lookup:
//   Tier A: Normalized Exact Match (<0.1ms)
//   Tier B: Vector Cosine Similarity Match (~15-30ms)

import { generateEmbedding } from "./embeddingService";

export interface SemanticCacheEntry {
  prompt: string;
  normalized: string;
  response: string;
  category: "GREETING" | "CASUAL" | "GENERAL";
  embedding?: number[];
  createdAt: number;
  hits: number;
}

function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

class SemanticResponseCache {
  private cache: Map<string, SemanticCacheEntry> = new Map();
  private maxEntries: number = 1000;
  private similarityThreshold: number = 0.94;

  constructor() {
    this.seedCommonGreetings();
  }

  private seedCommonGreetings() {
    const seeds: Array<{ prompt: string; response: string; category: "GREETING" | "CASUAL" }> = [
      {
        prompt: "hi",
        response: "Hello! How can I help you today?",
        category: "GREETING",
      },
      {
        prompt: "hello",
        response: "Hello! Great to see you. What are we working on today?",
        category: "GREETING",
      },
      {
        prompt: "hey",
        response: "Hey there! How can I assist you?",
        category: "GREETING",
      },
      {
        prompt: "how are you",
        response: "I'm doing well, thank you! Ready to help you with whatever you need. How are you doing?",
        category: "CASUAL",
      },
      {
        prompt: "how have you been",
        response: "I've been doing well, thank you for asking! Ready and at your service. How have things been with you?",
        category: "CASUAL",
      },
      {
        prompt: "how is it going",
        response: "Everything is running smoothly! How is your day going?",
        category: "CASUAL",
      },
      {
        prompt: "who are you",
        response: "I'm your local AI assistant, equipped with advanced reasoning, tools, and streaming capabilities. How can I help you today?",
        category: "CASUAL",
      },
      {
        prompt: "what is your name",
        response: "I am your AI assistant. You can call me whatever you'd like!",
        category: "CASUAL",
      },
      {
        prompt: "thank you",
        response: "You're very welcome! Let me know if there's anything else you need.",
        category: "CASUAL",
      },
      {
        prompt: "thanks",
        response: "Happy to help! Let me know if you need anything else.",
        category: "CASUAL",
      },
    ];

    for (const seed of seeds) {
      const normalized = normalizePrompt(seed.prompt);
      this.cache.set(normalized, {
        prompt: seed.prompt,
        normalized,
        response: seed.response,
        category: seed.category,
        createdAt: Date.now(),
        hits: 0,
      });
    }
  }

  /**
   * Fast lookup: checks normalized exact match first (<0.1ms), then vector similarity (~20ms).
   */
  async get(
    prompt: string,
    category: "GREETING" | "CASUAL" | "GENERAL"
  ): Promise<SemanticCacheEntry | null> {
    const normalized = normalizePrompt(prompt);

    // 1. Exact match on normalized prompt
    const exactMatch = this.cache.get(normalized);
    if (exactMatch) {
      exactMatch.hits++;
      console.log(`[SEMANTIC CACHE] Exact match hit for: "${prompt}" (hits=${exactMatch.hits})`);
      return exactMatch;
    }

    // 2. For GENERAL (or longer casual queries), attempt vector semantic match
    if (category === "GENERAL" || normalized.split(" ").length > 3) {
      try {
        const queryEmbedding = await generateEmbedding(prompt).catch(() => null);
        if (queryEmbedding && Array.isArray(queryEmbedding)) {
          let bestMatch: SemanticCacheEntry | null = null;
          let bestScore = -1;

          for (const entry of this.cache.values()) {
            if (entry.embedding && Array.isArray(entry.embedding)) {
              const score = cosineSimilarity(queryEmbedding, entry.embedding);
              if (score > bestScore) {
                bestScore = score;
                bestMatch = entry;
              }
            }
          }

          if (bestMatch && bestScore >= this.similarityThreshold) {
            bestMatch.hits++;
            console.log(
              `[SEMANTIC CACHE] Vector hit! Query: "${prompt}" matched: "${bestMatch.prompt}" (score=${bestScore.toFixed(3)})`
            );
            return bestMatch;
          }
        }
      } catch (err) {
        console.warn("[SEMANTIC CACHE] Vector similarity check bypassed:", err);
      }
    }

    return null;
  }

  /**
   * Stores a generated response in the semantic cache.
   */
  async set(
    prompt: string,
    response: string,
    category: "GREETING" | "CASUAL" | "GENERAL"
  ): Promise<void> {
    if (!prompt.trim() || !response.trim()) return;

    // Do not cache overly long code blocks or system errors
    if (response.startsWith("Error:") || response.length > 8000) return;

    const normalized = normalizePrompt(prompt);

    // Evict oldest if cache exceeded
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    let embedding: number[] | undefined;
    // Generate embedding in background for GENERAL queries so future lookups match semantically
    if (category === "GENERAL") {
      try {
        embedding = await generateEmbedding(prompt).catch(() => undefined);
      } catch {
        // Safe to ignore embedding generation failures
      }
    }

    this.cache.set(normalized, {
      prompt,
      normalized,
      response,
      category,
      embedding,
      createdAt: Date.now(),
      hits: 0,
    });

    console.log(`[SEMANTIC CACHE] Cached entry for: "${prompt}" [${category}]`);
  }

  clear(): void {
    this.cache.clear();
    this.seedCommonGreetings();
  }

  size(): number {
    return this.cache.size;
  }
}

export const semanticCache = new SemanticResponseCache();

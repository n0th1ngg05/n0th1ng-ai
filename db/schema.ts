import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  longtext,
  timestamp,
  bigint,
  int,
  float,
  json,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  role: mysqlEnum("role", ["admin", "user"]).default("admin"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const folders = mysqlTable("folders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const conversations = mysqlTable("conversations", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 255 }),
  summary: text("summary"),
  summarizedMessageCount: int("summarized_message_count").notNull().default(0),
  modelId: varchar("model_id", { length: 100 }).notNull(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).references(() => users.id),
  folderId: bigint("folder_id", { mode: "number", unsigned: true }).references(() => folders.id),
  isPinned: boolean("is_pinned").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const messages = mysqlTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: bigint("conversation_id", { mode: "number", unsigned: true })
    .references(() => conversations.id),
  role: mysqlEnum("role", ["user", "assistant", "system"]).notNull(),
  content: text("content").notNull(),
  // Model's reasoning/thinking trace for this message. Populated for BOTH
  // regular chat (/api/chat/stream's { thinking } tokens) and extended/agent
  // mode (services/agentLoop.ts's per-round thinking, concatenated across
  // rounds) — previously streamed live to the browser but never persisted
  // anywhere, so conversation history reloads always showed it as empty.
  // longtext because reasoning-model traces (deepseek-r1, lfm2.5-thinking,
  // etc.) can run well past a normal text column's practical size.
  thinking: longtext("thinking"),
  // True when this message was produced by the extended-thinking / agent
  // loop (services/agentLoop.ts) rather than the single-shot /api/chat/stream
  // flow. Lets the frontend know whether to expect an associated set of rows
  // in message_tool_calls when re-rendering this message from history, and
  // whether to render the round-by-round UI at all versus the plain
  // thinking-box UI used for regular messages.
  isExtended: boolean("is_extended").default(false),
  // The post-loop synthesis pass output (see synthesizeExecutionSummary in
  // services/agentLoop.ts) — a longer recap of the whole extended-thinking
  // session generated AFTER the loop's own (intentionally terse) final
  // answer. Null for regular messages and for extended messages where the
  // synthesis pass hasn't run yet or failed. Named executionSummary (not
  // "summary") to avoid any confusion with conversations.summary, which is
  // an unrelated rolling summary of the whole conversation used for context
  // compaction — this is a summary of one message's tool-execution run.
  executionSummary: longtext("execution_summary"),
  tokensUsed: int("tokens_used").default(0),
  responseTime: int("response_time"),
  createdAt: timestamp("created_at").defaultNow(),
});

// One row per tool call made during an extended-thinking (agent loop)
// message. A single assistant message can have any number of these (N tool
// calls across however many rounds the loop took), so this is a proper
// child table rather than a JSON blob on `messages` — keeps each call
// independently queryable (e.g. "every internet_search call ever made")
// and avoids repeatedly rewriting one huge JSON column as rounds accumulate.
//
// Maps directly onto the AgentEvent stream from services/agentLoop.ts:
// a { round }...{ tool_call }...{ tool_result } sequence becomes one row
// here, keyed to whichever `messages.id` the overall assistant response
// ends up saved as.
export const messageToolCalls = mysqlTable("message_tool_calls", {
  id: serial("id").primaryKey(),
  messageId: bigint("message_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => messages.id),
  // Which round of the agent loop this call happened in (agentLoop.ts's
  // `round` counter). Not unique alone — a single round can occasionally
  // resolve more than one tool call (see agentLoop.ts's routerTools loop) —
  // so ordering for display should be (round, id) together, not round alone.
  round: int("round").notNull(),
  // The atomic instruction text the main model emitted for this round,
  // before the 3-stage router resolved it to a concrete tool + arguments
  // (agentLoop.ts's `instruction` variable). Useful for debugging routing
  // decisions after the fact, same as the console logs already do live.
  instruction: text("instruction"),
  tool: varchar("tool", { length: 100 }).notNull(),
  arguments: json("arguments"),
  // longtext, not text: tool results (internet_search especially) were
  // observed in production logs running 10-11k+ chars per call, and a
  // multi-round session's total easily exceeds a plain text column's
  // comfortable size.
  result: longtext("result"),
  success: boolean("success").notNull().default(true),
  error: text("error"),
  // This round's thinking/reasoning trace specifically (distinct from
  // messages.thinking, which holds the overall/final trace for the whole
  // message) — lets history reconstruction show what the router or main
  // model was "thinking" at each individual step, matching the live
  // per-round thinking boxes chat.js already renders during streaming.
  thinking: longtext("thinking"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiModels = mysqlTable("ai_models", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  size: varchar("size", { length: 50 }),
  quantization: varchar("quantization", { length: 50 }),
  contextLength: int("context_length"),
  status: mysqlEnum("status", ["active", "idle", "loading", "error"]).default("idle"),
  memoryUsage: bigint("memory_usage", { mode: "number" }).default(0),
  vramUsage: bigint("vram_usage", { mode: "number" }).default(0),
  tokenSpeed: float("token_speed").default(0),
  lastUsed: timestamp("last_used"),
  isInstalled: boolean("is_installed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const systemSnapshots = mysqlTable("system_snapshots", {
  id: serial("id").primaryKey(),
  cpuUsage: float("cpu_usage").notNull(),
  cpuTemp: float("cpu_temp"),
  ramUsage: float("ram_usage").notNull(),
  ramTotal: bigint("ram_total", { mode: "number" }),
  gpuUsage: float("gpu_usage"),
  gpuTemp: float("gpu_temp"),
  vramUsage: float("vram_usage"),
  vramTotal: bigint("vram_total", { mode: "number" }),
  storageUsage: float("storage_usage"),
  networkRx: bigint("network_rx", { mode: "number" }),
  networkTx: bigint("network_tx", { mode: "number" }),
  networkRxSpeed: float("network_rx_speed"),
  networkTxSpeed: float("network_tx_speed"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const services = mysqlTable("services", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  displayName: varchar("display_name", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["running", "stopped", "error"]).default("stopped"),
  uptime: bigint("uptime", { mode: "number" }),
  version: varchar("version", { length: 50 }),
  lastChecked: timestamp("last_checked").defaultNow(),
});

export const generatedImages = mysqlTable("generated_images", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  negativePrompt:
    text("negative_prompt"),
  // Stable provider id from api/services/providers.ts (e.g.
  // "flux1-schnell", "flux2-klein"). Separate from modelUsed - provider
  // is the machine-readable key used to re-look-up defaults/JSON path;
  // modelUsed stays the human-readable label already shown in the UI.
  provider: varchar(
    "provider",
    { length: 100 }
  ),
  modelUsed: varchar(
    "model_used",
    { length: 255 }
  ),
  resolution: varchar(
    "resolution",
    { length: 50 }
  ),
  steps: int("steps"),
  cfg: float("cfg"),
  denoise: float(
    "denoise"
  ),
  batchSize: int(
    "batch_size"
  ),
  sampler: varchar(
    "sampler",
    { length: 100 }
  ),
  scheduler: varchar(
    "scheduler",
    { length: 100 }
  ),
  seed: bigint(
    "seed",
    {
      mode: "number",
    }
  ),
  generationTime: int(
    "generation_time"
  ),
  gpuUsage: float(
    "gpu_usage"
  ),
  vramUsage: float(
    "vram_usage"
  ),
  imageUrl: varchar(
    "image_url",
    { length: 500 }
  ),
  createdAt: timestamp(
    "created_at"
  ).defaultNow(),
});

// FramesX — video generation jobs (LTX-Video via ComfyUI).
// Mirrors generated_images' flat-column shape so nothing needs a join to
// redisplay a past job, plus video-only fields (frameRate/length/fps) and a
// `scenes` JSON snapshot of the full per-scene LLM breakdown + per-scene
// settings, so a page reload can fully reconstruct what was actually run —
// not just the final merged file.
export const generatedVideos = mysqlTable("generated_videos", {
  id: serial("id").primaryKey(),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negative_prompt"),
  // Stable provider id from api/services/providers.ts (e.g.
  // "ltx-2b-0.9.8-distilled", "wan2.1-1.3b-t2v"). See generatedImages'
  // `provider` column comment for the provider/modelUsed distinction.
  provider: varchar("provider", { length: 100 }),
  modelUsed: varchar("model_used", { length: 255 }),
  resolution: varchar("resolution", { length: 50 }),
  steps: int("steps"),
  cfg: float("cfg"),
  sampler: varchar("sampler", { length: 100 }),
  scheduler: varchar("scheduler", { length: 100 }),
  seed: bigint("seed", { mode: "number" }),

  // Video-specific, not present on generated_images
  frameRate: int("frame_rate"),
  length: int("length"),
  fps: int("fps"),
  durationSeconds: float("duration_seconds"),
  format: mysqlEnum("format", ["webp", "mp4"]).default("webp"),

  // Multi-scene generation (LLM-planned breakdown of a long prompt into
  // consecutive scenes). sceneCount stays null/1 for a single-scene job.
  sceneCount: int("scene_count").default(1),
  scenes: json("scenes"),
  planningModel: varchar("planning_model", { length: 100 }),

  generationTime: int("generation_time"),
  gpuUsage: float("gpu_usage"),
  vramUsage: float("vram_usage"),
  videoUrl: varchar("video_url", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const fileFolders = mysqlTable("file_folders", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  parentId: bigint("parent_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow(),
});

export const files = mysqlTable("files", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  path: varchar("path", { length: 500 }).notNull(),
  size: bigint("size", { mode: "number" }),
  mimeType: varchar("mime_type", { length: 100 }),
  folderId: bigint("folder_id", { mode: "number", unsigned: true }).references(() => fileFolders.id),
  isIndexed: boolean("is_indexed").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const chatAttachments = mysqlTable("chat_attachments", {
  id: serial("id").primaryKey(),

  conversationId: bigint("conversation_id", {
    mode: "number",
    unsigned: true,
  }).notNull(),

  messageId: bigint("message_id", {
    mode: "number",
    unsigned: true,
  }),

  originalName: varchar("original_name", {
    length: 255,
  }).notNull(),

  storedName: varchar("stored_name", {
    length: 255,
  }).notNull(),

  path: varchar("path", {
    length: 500,
  }).notNull(),

  mimeType: varchar("mime_type", {
    length: 150,
  }).notNull(),

  size: bigint("size", {
    mode: "number",
    unsigned: true,
  }).notNull(),

  extractedText: text("extracted_text"),

  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

export const researchCollections = mysqlTable("research_collections", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const researchDocuments = mysqlTable("research_documents", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content"),
  source: varchar("source", { length: 500 }),
  collectionId: bigint("collection_id", { mode: "number", unsigned: true })
    .references(() => researchCollections.id),
  isBookmarked: boolean("is_bookmarked").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const knowledgeEntries = mysqlTable("knowledge_entries", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  sourceType: mysqlEnum("source_type", ["conversation", "research", "file", "manual"]),
  tags: json("tags"),
  relevanceScore: float("relevance_score"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const workflows = mysqlTable("workflows", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  nodes: json("nodes").notNull(),
  edges: json("edges").notNull(),
  isTemplate: boolean("is_template").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const activityLogs = mysqlTable("activity_logs", {
  id: serial("id").primaryKey(),
  action: varchar("action", { length: 255 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }),
  entityId: bigint("entity_id", { mode: "number" }),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const fileContents =
  mysqlTable(
    "file_contents",
    {
      id: serial("id")
        .primaryKey(),

      fileId: bigint(
        "file_id",
        {
          mode: "number",
          unsigned: true,
        }
      ).references(
        () => files.id
      ),

      content:
        text("content")
          .notNull(),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),
    }
  );

  export const knowledgeChunks =
  mysqlTable(
    "knowledge_chunks",
    {
      id: serial("id")
        .primaryKey(),

      fileId: bigint(
        "file_id",
        {
          mode: "number",
          unsigned: true,
        }
      ).references(
        () => files.id
      ),

      chunkIndex:
        int("chunk_index")
          .notNull(),

      content:
        text(
          "content",
          {
            length: "long",
          }
        ).notNull(),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),
    }
  );

export const chunkEmbeddings =
  mysqlTable(
    "chunk_embeddings",
    {
      id: serial("id")
        .primaryKey(),

      chunkId: bigint(
        "chunk_id",
        {
          mode: "number",
        }
      ).references(
        () => knowledgeChunks.id
      ),

      embedding:
        json("embedding")
          .notNull(),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),
    }
  );

export const memories =
  mysqlTable(
    "memories",
    {
      id: serial("id")
        .primaryKey(),

      category:
        varchar(
          "category",
          { length: 100 }
        ),

      key:
        varchar(
          "memory_key",
          { length: 255 }
        ).notNull(),

      value:
        text(
          "memory_value"
        ).notNull(),

      importance:
        float(
          "importance"
        ).default(1),

      source:
        varchar(
          "source",
          { length: 255 }
        ),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),

      updatedAt:
        timestamp(
          "updated_at"
        ).defaultNow(),
    }
  );

export const memoryChunks =
  mysqlTable(
    "memory_chunks",
    {
      id: serial("id")
        .primaryKey(),

      memoryId:
        int("memory_id")
          .notNull()
          .references(
            () => memories.id
          ),

      content:
        text(
          "content",
          {
            length: "long",
          }
        ).notNull(),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),
    }
  );

export const memoryChunkEmbeddings =
  mysqlTable(
    "memory_chunk_embeddings",
    {
      id: serial("id")
        .primaryKey(),

      chunkId:
        int("chunk_id")
          .notNull()
          .references(
            () => memoryChunks.id
          ),

      embedding:
        json("embedding")
          .notNull(),

      createdAt:
        timestamp(
          "created_at"
        ).defaultNow(),
    }
  );

export const chatAttachmentChunks = mysqlTable(
  "chat_attachment_chunks",
  {

    id: serial("id").primaryKey(),

    attachmentId: bigint("attachment_id", {
      mode: "number",
      unsigned: true,
    }).notNull(),

    chunkIndex: int("chunk_index")
      .notNull(),

    content: text("content")
      .notNull(),

    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),

  }
);

export const chatAttachmentEmbeddings = mysqlTable(
  "chat_attachment_embeddings",
  {

    id: serial("id").primaryKey(),

    chunkId: bigint("chunk_id", {
      mode: "number",
      unsigned: true,
    }).notNull(),

    embedding: json("embedding")
      .$type<number[]>()
      .notNull(),

  }
);

export const voiceConversations = mysqlTable("voice_conversations", {
    id: varchar("id", { length: 36 }).primaryKey(),

    title: varchar("title", { length: 255 }),

    modelId: varchar("model_id", { length: 100 }).notNull(),

    mode: mysqlEnum("mode", [
        "tts",
        "stt",
        "voice"
    ]).notNull(),

    providerId: varchar("provider_id", { length: 100 }),

    speechModelId: varchar("speech_model_id", { length: 100 }),

    voiceId: varchar("voice_id", { length: 100 }),

    summary: text("summary"),

    summarizedMessageCount: int("summarized_message_count").notNull().default(0),

    createdAt: timestamp("created_at").defaultNow(),

    updatedAt: timestamp("updated_at").defaultNow(),
});

export const voiceMessages = mysqlTable("voice_messages", {

    id: varchar("id", { length: 36 }).primaryKey(),

    conversationId:

        varchar("conversation_id", {

            length: 36,

        })

        .references(() => voiceConversations.id),

    role:

        mysqlEnum(

            "role",

            [

                "user",

                "assistant",

                "system"

            ]

        ).notNull(),

    content:

        longtext("content"),

    audio:

        longtext("audio"),

    providerId:

        varchar(

            "provider_id",

            { length:100 }

        ),

    speechModelId:

        varchar(

            "speech_model_id",

            { length:100 }

        ),

    voiceId:

        varchar(

            "voice_id",

            { length:100 }

        ),

    duration:

        float("duration"),

    tokensUsed:

        int("tokens_used").default(0),

    responseTime:

        int("response_time"),

    createdAt:

        timestamp("created_at").defaultNow(),

});
// Stores the LangGraph document_analysis pipeline output (summary,
// entities, keywords, topics, metadata) per file. One row per file — a
// re-run of analysis updates the existing row rather than inserting a
// new one, so `fileId` is unique. `status` tracks pipeline progress and
// mirrors the node names streamed over SSE by /api/files/:id/analyze-stream
// (see api/boot.ts), so the frontend can resume/poll if it misses events.
export const documentAnalysis = mysqlTable("document_analysis", {
  id: serial("id").primaryKey(),
  fileId: bigint("file_id", { mode: "number", unsigned: true })
    .notNull()
    .unique()
    .references(() => files.id),
  summary: text("summary"),
  entities: json("entities"),
  keywords: json("keywords"),
  topics: json("topics"),
  language: varchar("language", { length: 50 }),
  documentType: varchar("document_type", { length: 100 }),
  confidence: float("confidence"),
  status: mysqlEnum("status", [
    "pending",
    "ingesting",
    "summarizing",
    "extracting",
    "synthesizing",
    "complete",
    "error",
  ]).default("pending"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

//forge
export const forgeSessions = mysqlTable("forge_sessions", {
  id: varchar("id", { length: 36 }).primaryKey(),
  goal: text("goal").notNull(),
  stackProfileId: varchar("stack_profile_id", { length: 64 }).notNull(),
  // Free-text language/framework, only meaningful when stackProfileId is
  // 'general' — e.g. "Go with the standard library", "C with CMake", "Rust
  // + Actix". Null for the four dedicated profiles.
  customStack: text("custom_stack"),
  // Which Ollama model this session runs on — chosen per-session from the
  // frontend's model dropdown (forge.listModels), not a hardcoded constant.
  modelId: varchar("model_id", { length: 128 }).notNull(),
  workspacePath: varchar("workspace_path", { length: 512 }).notNull(),
  // Real free port allocated at session creation (db.findFreePort) — NOT a
  // hardcoded stack-profile default. Prevents this session's dev server from
  // colliding with anything else already running on the host.
  allocatedPort: int("allocated_port").notNull(),
  status: mysqlEnum("status", ["planning", "running", "paused", "blocked", "done", "failed"])
    .notNull()
    .default("planning"),
  // NOTE: no .default({}) here on purpose — object/array literal defaults on
  // MySQL json() columns are what broke `drizzle-kit push` for this table in
  // the first place (it can't reliably emit valid SQL for a JSON DEFAULT
  // expression). The three forge tables were created via a hand-written raw
  // SQL migration instead (forge_migration.sql) with plain `JSON NOT NULL`
  // and no column default; forge/db.ts's createSession always supplies `{}`
  // explicitly on insert, so the column is never actually left to a default.
  sharedContracts: json("shared_contracts").notNull(),
  iterationCount: int("iteration_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const forgeTaskNodes = mysqlTable("forge_task_nodes", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sessionId: varchar("session_id", { length: 36 }).notNull(),
  parentId: varchar("parent_id", { length: 36 }),
  description: text("description").notNull(),
  acceptanceCriteria: text("acceptance_criteria").notNull(),
  status: mysqlEnum("status", ["pending", "in_progress", "done", "failed", "blocked"])
    .notNull()
    .default("pending"),
  // Same reasoning as sharedContracts above — no .default([]) on the JSON
  // column. forge/db.ts's createTaskNode always supplies `[]` explicitly.
  dependsOn: json("depends_on").notNull(),
  attempts: int("attempts").notNull().default(0),
  lastError: text("last_error"),
  isIntegrationCheck: boolean("is_integration_check").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const forgeIterations = mysqlTable("forge_iterations", {
  id: varchar("id", { length: 36 }).primaryKey(),
  sessionId: varchar("session_id", { length: 36 }).notNull(),
  taskId: varchar("task_id", { length: 36 }).notNull(),
  phase: mysqlEnum("phase", ["think", "act", "evaluate"]).notNull(),
  input: text("input").notNull(),
  output: text("output").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

//forgex
// ForgeX bridges to the REAL Claude Code CLI as a subprocess (see
// forgex/processManager.ts), pointed at a local Ollama model via
// ANTHROPIC_BASE_URL — it does not reimplement an agent loop the way Forge's
// tables above track a task tree. These two tables are correspondingly
// simpler: one row per session, one row per line of subprocess output.
export const forgexSessions = mysqlTable("forgex_sessions", {
    id: varchar("id", { length: 36 }).primaryKey(),
    goal: text("goal").notNull(),
    modelId: varchar("model_id", { length: 128 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 512 }).notNull(),
    status: mysqlEnum("status", ["starting", "running", "idle", "exited", "failed"])
        .notNull()
        .default("starting"),
    pid: int("pid"),
    exitCode: int("exit_code"),
    // Claude Code's own session UUID (from stream-json's init event), needed
    // to pass --resume <id> on every turn after the first so context carries
    // across turns despite each turn being its own process (headless mode).
    claudeSessionId: varchar("claude_session_id", { length: 128 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const forgexOutput = mysqlTable("forgex_output", {
    id: varchar("id", { length: 36 }).primaryKey(),
    sessionId: varchar("session_id", { length: 36 }).notNull(),
    stream: mysqlEnum("stream", ["stdout", "stderr", "system"]).notNull(),
    text: text("text").notNull(),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
});
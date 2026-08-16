# n0th1ng AI — Personal Intelligence Workstation

> **You Imagine, We Render.**

n0th1ng AI is a fully self-hosted, privacy-first, personal artificial intelligence workstation. It is not a SaaS product, not a subscription service, and not a cloud tool. It is an entire intelligence operating environment that runs entirely on your own machine — your hardware, your models, your data, your rules.

Built from the ground up as a unified platform, n0th1ng AI integrates large language models, image generation, cinematic video generation, speech intelligence, autonomous coding agents, document intelligence, real-time system monitoring, and a personal memory system — all under one roof, all local, all private.

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [High-Level Architecture](#high-level-architecture)
3. [Module Overview](#module-overview)
4. [Tech Stack](#tech-stack)
5. [Database Schema](#database-schema)
6. [Backend API](#backend-api)
7. [Chatspace](#chatspace)
8. [Image Studio](#image-studio)
9. [FramesX](#framesx)
10. [Voice Studio](#voice-studio)
11. [Forge](#forge)
12. [ForgeX](#forgex)
13. [Files and Document Intelligence](#files-and-document-intelligence)
14. [Knowledge Base and RAG](#knowledge-base-and-rag)
15. [Monitor](#monitor)
16. [Persona Studio](#persona-studio)
17. [Python Runtime](#python-runtime)
18. [Speech Runtime](#speech-runtime)
19. [Memory System](#memory-system)
20. [Distributed Cluster Mode](#distributed-cluster-mode)
21. [Frontend Architecture](#frontend-architecture)
22. [Environment Variables](#environment-variables)
23. [Installation and Setup](#installation-and-setup)
24. [Running the Project](#running-the-project)
25. [Project Structure](#project-structure)

---

## Philosophy

Most AI tools are built around the idea of access. You access their models, you access their servers, your data passes through their infrastructure. n0th1ng AI is built around the opposite idea: **ownership**.

Every component runs locally:
- Models are served by Ollama on your own GPU or CPU
- Image generation runs through ComfyUI on your own hardware
- Video generation runs through LTX-Video and Wan2.1 locally
- Speech synthesis and recognition run through dedicated local Python runtimes
- All data is stored in your own MySQL database
- No data ever leaves your machine unless you explicitly configure an external provider

The distance between intention and creation should collapse to zero. Every thought should have a render path. That is the design goal of n0th1ng AI.

---

## High-Level Architecture

The application is structured as a central Hono Node.js server that bridges all subsystems:

- **Browser** — multi-page plain HTML/CSS/JS frontend
- **Hono API Server** (`api/boot.ts`) — tRPC routers, REST endpoints, SSE streams, WebSocket handlers, file upload, auth middleware
- **MySQL Database** — all persistent state via Drizzle ORM
- **Ollama** — local LLM serving
- **ComfyUI** — image and video generation
- **Python Runtimes** — OCR, vision analysis, speech, PDF parsing

The server runs on Node.js and is served locally on port 3000.

---

## Module Overview

| Module | Description | Status |
|--------|-------------|--------|
| Chatspace | Multi-model AI conversation with tool use, RAG, memory, and agent mode | Live |
| Image Studio | Text-to-image generation via ComfyUI with 10+ providers | Live |
| FramesX | Multi-scene cinematic video generation via LTX-Video and Wan2.1 | Live |
| Voice Studio | Local TTS/STT with 7+ providers, voice conversations with memory | Live |
| Forge | Autonomous multi-task build agent with plan/act/evaluate loop | Live |
| ForgeX | Advanced agentic coding via Claude Code CLI bridged to local Ollama | Live |
| Files | Document library with OCR, PDF parsing, LangGraph analysis pipeline | Live |
| Knowledge Base | RAG-powered knowledge store with semantic search and embeddings | Live |
| Monitor | Real-time system telemetry: CPU, GPU, VRAM, RAM, network, services | Live |
| Persona Studio | NVIDIA Moshi real-time voice-to-voice AI persona conversations | Live |
| Robotics | Planned embodied AI layer | 2026 |
| Settings | System configuration, model management, provider configuration | Live |

---

## Tech Stack

### Core Runtime

| Layer | Technology |
|-------|------------|
| Server Framework | Hono v4 — ultra-fast HTTP framework for Node.js |
| API Layer | tRPC v11 — end-to-end typesafe RPC |
| ORM | Drizzle ORM v0.45 — fully typesafe SQL ORM |
| Database | MySQL via mysql2 |
| Language | TypeScript 5.9 strict mode throughout |
| Build Tool | Vite 7 (frontend) + esbuild (backend bundle) |
| Runtime | Node.js ESM |

### Frontend

| Layer | Technology |
|-------|------------|
| Architecture | Multi-page application — plain HTML, CSS, vanilla JS per module |
| Styling | Custom CSS design system with glassmorphism, aurora gradients, micro-animations |
| Fonts | Inter Tight, JetBrains Mono via Google Fonts |
| Animations | CSS keyframes, GSAP for advanced animations |
| 3D | Three.js in the robotics module |

### AI and Model Layer

| Component | Technology |
|-----------|------------|
| LLM Serving | Ollama — local model server supporting LLaMA, Qwen, DeepSeek, Mistral, and more |
| Cloud LLMs | OpenRouter — optional cloud model bridge (supports extended-thinking models like Claude 3.7 Sonnet) |
| Image Generation | ComfyUI — node-based generation pipeline |
| Video Generation | LTX-Video 2B distilled and Wan2.1 1.3B T2V via ComfyUI |
| Embeddings | Ollama embedding models such as nomic-embed-text and mxbai-embed-large |
| Web Search | Tavily API |
| Web Scraping | Firecrawl |

### Python Runtimes

| Runtime | Purpose |
|---------|--------|
| python-runtime | OCR via Tesseract, PaddleOCR, Surya, EasyOCR; PDF parsing via marker-pdf; Vision via Florence-2, InternVL, MiniCPM, Qwen3VL; LangGraph document analysis |
| speech-runtime | TTS and STT local inference — Kokoro, Chatterbox, XTTS, Piper, FishSpeech, Dia, Whisper |
| personaplex-runtime | NVIDIA Moshi real-time voice-to-voice streaming via WebSocket |

---

## Database Schema

The entire application state is stored in MySQL via Drizzle ORM. The schema in `db/schema.ts` defines over 30 tables.

### Core Tables

| Table | Purpose |
|-------|---------|
| users | User accounts with admin and user roles |
| conversations | Chat conversation sessions with model binding, folder organization, pin state |
| messages | Individual chat messages with thinking (reasoning trace), is_extended (agent mode flag), execution_summary (post-loop synthesis) |
| message_tool_calls | Per-round tool call records for agent loop sessions including tool name, arguments, result, success, and per-round thinking trace |
| folders | Conversation folder hierarchy |

### Generation Tables

| Table | Purpose |
|-------|---------|
| ai_models | Registered Ollama models with VRAM usage, token speed, status |
| generated_images | Image generation history — prompt, provider, model, resolution, steps, CFG, sampler, scheduler, seed, generation time, GPU and VRAM usage |
| generated_videos | Video generation history — same as images plus frame rate, scene count, LLM planning model, multi-scene JSON snapshot |

### File and Knowledge Tables

| Table | Purpose |
|-------|---------|
| files | Uploaded file registry |
| file_folders | File folder hierarchy with nesting |
| file_contents | Extracted raw text content per file |
| knowledge_chunks | Chunked text segments for RAG |
| chunk_embeddings | Vector embeddings per chunk stored as JSON float arrays |
| knowledge_entries | Curated knowledge base entries with tags and relevance scores |
| document_analysis | LangGraph pipeline output per file including summary, entities, keywords, topics, pipeline status |
| chat_attachments | Per-conversation file uploads with extracted text |
| chat_attachment_chunks | Chunked attachment text for per-conversation RAG |
| chat_attachment_embeddings | Embeddings for attachment chunks |

### Voice Tables

| Table | Purpose |
|-------|---------|
| voice_conversations | Voice conversation sessions with TTS/STT/voice mode, provider, model, voice ID |
| voice_messages | Individual voice messages with base64 audio, duration, provider details |

### Memory Tables

| Table | Purpose |
|-------|---------|
| memories | Persistent memory entries with category, key, value, importance score, source |
| memory_chunks | Chunked memory content |
| memory_chunk_embeddings | Semantic embeddings for memory search |

### Research and Workflow Tables

| Table | Purpose |
|-------|---------|
| research_collections | Research project containers |
| research_documents | Individual research documents with source URLs and bookmarks |
| workflows | Saved automation workflows as node/edge graph JSON |
| activity_logs | System-wide audit trail |
| system_snapshots | Time-series hardware telemetry snapshots for CPU, GPU, RAM, VRAM, network |
| services | Tracked background services including Ollama, ComfyUI, Python runtimes |

### Forge Tables

| Table | Purpose |
|-------|---------|
| forge_sessions | Autonomous build sessions with goal, stack profile, model, workspace path, allocated port |
| forge_task_nodes | Hierarchical task tree with parent/child tasks, acceptance criteria, dependency graph |
| forge_iterations | Per-round think/act/evaluate log for each task node |
| forgex_sessions | ForgeX sessions bridging Claude Code CLI subprocess to local Ollama |
| forgex_output | Line-by-line subprocess output capture for stdout, stderr, and system events |

---

## Backend API

The backend in `api/boot.ts` is a 2,500+ line Hono application exposing both tRPC and raw HTTP endpoints.

### tRPC Routers

| Router | Responsibilities |
|--------|-----------------|
| chat.ts | Conversation and message queries |
| conversation.ts | Full conversation management — create, delete, rename, pin, move to folder |
| message.ts | Message CRUD, tool call retrieval, thinking trace access |
| image.ts | Generated image history, deletion, metadata queries |
| video.ts | Generated video history and management |
| file.ts | File library CRUD, folder management, indexing status |
| fileContent.ts | File content retrieval |
| knowledge.ts | Knowledge entry management |
| model.ts | AI model registry with install status, VRAM and performance stats |
| system.ts | System service status, system snapshots history |
| activity.ts | Activity log queries |
| workflow.ts | Workflow save, load, delete |
| research.ts | Research collection and document management |
| cluster.ts | Distributed worker node registration and management |
| providers.ts | Image and video provider listing |
| runtime.ts | Python runtime status |
| personaplex.ts | PersonaPlex session management and WebSocket proxy |

### REST and SSE Endpoints

| Endpoint | Description |
|----------|-------------|
| POST /api/chat/stream | Main LLM streaming with thinking, RAG injection, memory context |
| POST /api/chat/stream/extended | Agent loop mode with full tool use and multi-round reasoning |
| POST /api/generate/image | Triggers ComfyUI image generation job |
| GET /api/generate/image/stream/:jobId | SSE stream for image generation progress |
| POST /api/generate/video | Triggers FramesX video generation |
| GET /api/generate/video/stream/:jobId | SSE stream for video generation progress |
| POST /api/upload | File upload to knowledge base |
| POST /api/chat-upload | File upload within a conversation |
| GET /api/files/:id/analyze-stream | SSE stream for LangGraph document analysis |
| POST /api/voice/tts | Text-to-speech synthesis |
| POST /api/voice/stt | Speech-to-text transcription |
| POST /api/voice/conversation | Full voice conversation turn: STT then LLM then TTS |
| WS /api/forge/stream | WebSocket stream for Forge autonomous agent |
| WS /api/forgex/stream | WebSocket stream for ForgeX Claude Code sessions |
| GET /api/monitor/... | Real-time system metrics |
| POST /api/cluster/register | Worker node self-registration |

---

## Chatspace

Chatspace is the primary intelligence interface — far more than a simple chat box.

### Standard Chat

Every conversation is bound to an Ollama model at creation time. Messages stream in real-time via SSE. The system maintains:

- **Rolling conversation context** via `services/contextWindow.ts` — intelligently manages the context window, truncating old messages while preserving the most relevant history
- **Conversation summarization** via `services/conversationSummary.ts` — when conversations grow long, old messages are summarized and compressed, with the summary injected as context on subsequent turns
- **Thinking and reasoning traces** — for models with native chain-of-thought support such as Qwen3 and Qwen3.5, the reasoning trace is captured live, stored in `messages.thinking`, and rehydrated from the database on conversation reload

### Memory System Integration

Every chat turn automatically:
1. Searches the semantic memory store for relevant memories via cosine similarity
2. Injects relevant memories into the system prompt context
3. After each assistant response, runs a background memory extraction pass to identify and store new memorable information including names, preferences, facts, and relationships

### RAG — Retrieval-Augmented Generation

When files have been indexed in the knowledge base:
1. The user query is embedded using the selected Ollama embedding model
2. Cosine similarity search runs across all chunk_embeddings
3. The top-K most relevant chunks are retrieved
4. They are injected into the prompt context before sending to the LLM

Chat attachments uploaded within a conversation receive their own per-attachment RAG pipeline, isolated from the global knowledge base.

### Agent Loop — Extended Mode

Extended mode activates `services/agentLoop.ts` — a full autonomous multi-round agent.

Round structure:
1. Main model receives conversation history plus tool definitions and emits a single instruction
2. The instruction passes through a 3-stage routing pipeline in `services/toolRouter.ts` that pattern-matches against 30+ tool signatures
3. The tool is executed via `services/toolExecutor.ts`
4. The result is fed back into the next round
5. The loop continues until the model emits a final answer

Available tools in agent mode include:
- internet_search — Tavily web search
- read_url — Firecrawl URL scraping
- search_knowledge — semantic search over the knowledge base
- store_memory and search_memory — persistent memory read and write
- run_python — Python code execution via the python-runtime
- analyze_image — vision model inference
- generate_image — ComfyUI image generation
- list_files and read_file — file system access
- run_sql_query — direct database queries
- get_system_info — hardware telemetry
- And 20+ more tools

After the loop completes, `synthesizeExecutionSummary()` runs — a separate LLM call generating a comprehensive session summary stored in `messages.execution_summary`.

All tool calls, round-by-round thinking traces, and results are persisted to `message_tool_calls` for perfect session replay from history.

### OpenRouter Bridge

If an OpenRouter-compatible model ID is detected via `services/openRouter.ts`, chat is transparently routed to the OpenRouter API — giving access to GPT-4, Claude, Gemini, and hundreds of cloud models through the same interface.

---

## Image Studio

Image Studio provides a full-featured text-to-image interface backed by ComfyUI.

### Providers

Ten or more generation providers are supported, each with its own pre-configured ComfyUI workflow JSON:

| Provider | Model |
|----------|-------|
| FLUX.1 Schnell | Fast FLUX generation |
| FLUX.2 Klein | Higher quality FLUX |
| SDXL Base | Stable Diffusion XL |
| SD 1.5 | Classic Stable Diffusion |
| Juggernaut XL | Photorealistic SDXL |
| DreamShaper | Creative SDXL |
| Pony Diffusion | Stylized generations |
| And more | Configurable |

### Generation Parameters

- Resolution: Custom width by height presets from 512x512 to 2048x2048
- Steps: Denoising step count
- CFG Scale: Classifier-free guidance strength
- Sampler and Scheduler: Full selection including Euler, DPM++, DDIM, and others
- Seed: Deterministic generation with seed control
- Batch Size: Multi-image generation
- Negative Prompt: Exclusion prompt support
- Denoise: Inpainting and img2img denoising strength

### Generation Pipeline

1. User submits generation request to POST /api/generate/image
2. Server creates a job in the generationJobs in-memory Map
3. The appropriate ComfyUI workflow JSON is parameter-injected
4. The workflow is submitted to ComfyUI's /prompt API
5. A polling loop tracks queue position and progress
6. Events are emitted to the SSE stream
7. On completion, the image is saved and the record persisted to generated_images

All generation parameters are stored for every image, enabling complete reproduction of any past generation.

---

## FramesX

FramesX is the video generation module, supporting multi-scene cinematic workflows.

### Models

| Model | Description |
|-------|-------------|
| LTX-Video 2B distilled | Fast 2B parameter video generation |
| Wan2.1 1.3B T2V | Text-to-video, compact and fast |

### Multi-Scene Generation

1. User provides a long-form cinematic prompt
2. A planning LLM breaks the prompt into a structured scene breakdown — each scene with its own sub-prompt, duration, mood, and visual style
3. Each scene is generated as a separate video clip with independent parameters
4. Clips are concatenated into a final video
5. The full scene plan JSON is stored in generated_videos.scenes for complete session reproducibility

### Progress Streaming

FramesX streams granular progress events via SSE:
- planning — LLM scene breakdown in progress
- scene_start — individual scene generation beginning
- progress — per-scene ComfyUI step progress
- scene_done — individual scene complete
- concatenating — merging scene clips
- done or error — final states

---

## Voice Studio

Voice Studio provides a complete local speech intelligence layer.

### TTS Providers

| Provider | Description |
|----------|-------------|
| Kokoro | High-quality neural TTS with multiple voices |
| Chatterbox | Expressive TTS with emotion control |
| XTTS v2 | Coqui XTTS with voice cloning capability |
| Piper | Fast, lightweight TTS |
| FishSpeech | Natural-sounding TTS |
| Dia | Dialogue-optimized TTS |

### STT Providers

| Provider | Description |
|----------|-------------|
| Whisper | OpenAI Whisper running locally with multiple model sizes |

### Voice Conversation Mode

Full voice conversation sessions work as follows:
1. User speaks and WAV audio is captured in the browser
2. Audio is sent to /api/voice/stt
3. Backend passes audio to the speech-runtime STT provider
4. Transcription is sent to the selected Ollama LLM
5. LLM response is sent to the speech-runtime TTS provider
6. Generated audio WAV is returned to the browser for playback

Voice conversations maintain their own rolling memory and summary system. Every exchange is stored in voice_conversations and voice_messages with base64-encoded audio for history playback.

---

## Forge

Forge is n0th1ng AI's autonomous coding agent. Given a goal and a tech stack, it builds software without human intervention.

### Stack Profiles

- Node.js with Express — REST API server
- React with Vite — Frontend application
- Full-Stack — Express backend with React frontend
- Python with FastAPI — Python API server
- General — Any language or framework via free-text specification

### The Think, Act, Evaluate Loop

For each task, Forge runs a tight three-phase iteration loop.

Think phase: The model receives the task description, acceptance criteria, codebase structure, shared contracts, and previous context. It produces a structured implementation plan.

Act phase: The model writes or modifies actual source files. File operations execute via the filesystem. The dev server starts if not running.

Evaluate phase: The model inspects results — console output, server response — and decides whether the task passes its acceptance criteria or needs another iteration.

### Task Tree

A Forge session builds a hierarchical task dependency tree:
- Tasks can depend on other tasks
- Integration check tasks verify component interoperability
- Failed tasks retry with additional context
- The session tracks iterationCount across all tasks

### Workspace Management

Each Forge session:
1. Creates an isolated workspace directory
2. Allocates a free TCP port via actual port scanning — no hardcoded defaults
3. Spawns a dev server within the workspace
4. Stores the workspace path in the session record

All sessions, task trees, and per-round iterations are fully persisted to the database.

---

## ForgeX

ForgeX bridges Claude Code CLI to local Ollama models instead of implementing its own agent loop.

### How It Works

1. Sets ANTHROPIC_BASE_URL to point at the local Ollama endpoint
2. Spawns claude as a subprocess in headless stream-json mode
3. Captures all subprocess output line-by-line: stdout, stderr, system events
4. Streams it to the browser via WebSocket in real-time
5. On subsequent turns, passes --resume with the claudeSessionId so context carries across turns

This gives you the full power of Claude Code's agentic loop — file editing, shell execution, web search, code analysis — running against your local Ollama model with no API costs.

Sessions are stored in forgex_sessions, all output line-by-line in forgex_output, and sessions can be resumed across browser restarts.

---

## Files and Document Intelligence

### Supported File Types

- PDF — via pdf-parse in JavaScript and marker-pdf in Python for high-fidelity extraction
- Word .docx — via mammoth
- Text files — direct ingestion
- Images — OCR via Tesseract.js or Surya, PaddleOCR, EasyOCR in Python

### Processing Pipeline

When a file is uploaded:
1. Text is extracted based on MIME type
2. Content is stored in file_contents
3. Text is chunked into overlapping segments
4. Each chunk is embedded via the selected Ollama embedding model
5. Embeddings are stored in chunk_embeddings
6. The file is marked is_indexed true

### LangGraph Document Analysis

Each file can run through a deep analysis pipeline:
1. ingesting — text extraction and preprocessing
2. summarizing — LLM generates a comprehensive summary
3. extracting — entity extraction for people, organizations, locations, dates
4. synthesizing — keyword and topic extraction, language detection, document type classification
5. complete — results written to document_analysis table

### OCR Providers

| Provider | Description |
|----------|-------------|
| Tesseract | Classic OCR with good general coverage |
| Surya | State-of-the-art neural OCR with excellent accuracy |
| PaddleOCR | Strong multilingual support, fast |
| EasyOCR | Easy-to-use with good accuracy |

---

## Knowledge Base and RAG

### Architecture

- Storage: MySQL tables for knowledge_entries, knowledge_chunks, chunk_embeddings
- Embeddings: Any Ollama embedding model
- Search: Cosine similarity over stored embedding vectors

### Semantic Search

`services/semanticSearch.ts` implements vector search:
1. Embeds the query using the active embedding model
2. Loads all chunk_embeddings from the database
3. Computes cosine similarity between the query vector and each stored vector
4. Returns the top-K chunks ranked by similarity score

`services/rag.ts` builds a formatted RAG context block from retrieved chunks, injected into the system prompt before each LLM call.

`services/backfillEmbeddings.ts` can retroactively embed any files indexed before an embedding model was configured.

---

## Monitor

### Hardware Metrics

| Metric | Source |
|--------|--------|
| CPU usage percent | systeminformation |
| CPU temperature Celsius | systeminformation |
| RAM usage and total | systeminformation |
| GPU usage percent | systeminformation |
| GPU temperature Celsius | systeminformation |
| VRAM usage and total | systeminformation |
| Storage usage | systeminformation |
| Network Rx and Tx rates | systeminformation |

Using ps-list and pidusage, Monitor also tracks all running processes with CPU and memory usage, Ollama model processes specifically, and Python runtime processes.

`services/telemetry.ts` runs a background collector that polls metrics and writes time-series snapshots to system_snapshots, enabling historical charts in the Monitor UI.

---

## Persona Studio

Persona Studio provides real-time, low-latency voice-to-voice AI persona conversations using NVIDIA's Moshi architecture.

Moshi is a real-time speech-to-speech LLM developed by Kyutai. Unlike TTS/STT pipelines that work in serial, Moshi processes audio in a fully streaming fashion — enabling natural real-time conversation with sub-second latency.

### Architecture

- personaplex-runtime/ — integrated Moshi server
- The runtime exposes a WebSocket endpoint streaming audio chunks bidirectionally
- The Hono backend via api/routers/personaplex.ts acts as a session manager and WebSocket proxy
- The browser connects via WebSocket and streams raw PCM audio

---

## Python Runtime

A FastAPI sidecar service handling all Python-dependent AI workloads.

### Services Exposed

| Route | Description |
|-------|-------------|
| POST /analyze | Full document analysis pipeline via LangGraph |
| POST /ocr | OCR on an image or document |
| POST /vision/analyze | Vision model inference |
| POST /pdf/parse | High-fidelity PDF parsing via marker-pdf |
| GET /models | List available vision and OCR models |
| GET /health | Health check and capability report |

### Key Dependencies

- FastAPI and Uvicorn — ASGI web server
- LangGraph — document analysis pipeline orchestration
- marker-pdf — state-of-the-art PDF-to-markdown conversion
- Surya OCR — neural OCR engine
- PaddleOCR — multilingual OCR
- EasyOCR — accessible OCR
- Tesseract — classic OCR fallback
- Transformers from HuggingFace — vision model inference for Florence-2, InternVL, MiniCPM, Qwen3VL
- OpenCV — image preprocessing
- CUDA support via PaddlePaddle GPU and PyTorch

### Setup

```bash
cd python-runtime
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001
```

---

## Speech Runtime

A standalone FastAPI service for speech synthesis and recognition.

### Architecture

- speech-runtime/main.py — FastAPI entry point
- speech-runtime/providers/ — one module per TTS/STT provider
- speech-runtime/inference/ — inference pipelines for streaming, batching, STT, TTS, voice chat
- speech-runtime/api/ — route handlers
- speech-runtime/utils/ — shared utilities for model downloader, checksum verification, path management

### Provider Interface

Each provider follows a common interface:
- load_model() — lazy model loading with VRAM management
- synthesize(text, voice_id, params) — TTS inference
- transcribe(audio_bytes) — STT inference for Whisper
- list_voices() — available voice enumeration

Models are downloaded on first use, verified via checksum, and VRAM is managed by unloading inactive models.

### Setup

```bash
cd speech-runtime
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python launcher.py
```

---

## Memory System

n0th1ng AI maintains a persistent, semantically searchable memory system.

### Memory Store

`services/memory.ts` provides:
- memoryStore(key, value, category, importance) — write a memory
- memorySearch(query, topK) — semantic search over memories
- getAllMemories() — retrieve all stored memories

### Memory Schema

Each memory entry has:
- category — type classification such as person, preference, fact, relationship
- key — short identifier
- value — full memory content
- importance — float score from 0 to 1 for prioritization
- source — which conversation produced this memory

Memories are chunked and embedded just like knowledge base files. At query time, cosine similarity is computed against all memory_chunk_embeddings to find the most contextually relevant memories.

### Automatic Memory Extraction

After every LLM response, a background job runs a memory extraction prompt — asking the model to identify any memorable information in the exchange and writing it to the memory store.

---

## Distributed Cluster Mode

n0th1ng AI supports a distributed architecture where multiple machines serve as inference workers.

### Architecture

- One machine runs the primary Hono server
- Additional machines run as worker nodes
- Workers register via POST /api/cluster/register
- Workers send heartbeats to stay active
- The primary tracks worker health via removeOfflineWorkers()

### Worker Registration

Each worker provides:
- Node ID and display name
- Available capabilities such as Ollama URL and ComfyUI URL
- Hardware specs including VRAM and RAM

`services/clusterMetricsHistory.ts` records per-worker performance metrics over time, enabling monitoring of the entire cluster from the primary Monitor dashboard.

---

## Frontend Architecture

The frontend is a multi-page application built with plain HTML, CSS, and vanilla JavaScript — one index.html per module under frontend/.

### Design System

Built from scratch in frontend/assets/:
- nav.css — Global navigation styles with glassmorphism navbar and mobile drawer
- nav.js — Navigation behavior including scroll effects, mobile drawer, and dropdown menus
- page-transitions.css — Cross-page transition animations
- page-transitions.js — Transition orchestration

### Visual Language

- Color palette: Aurora gradient system with deep purples, electric blues, warm golds
- Glass effects: Backdrop-filter glassmorphism with glass, glass-liquid, glass-strong utility classes
- Typography: Inter Tight for UI text, JetBrains Mono for code and labels
- Animations: CSS keyframe animations, GSAP for complex sequences, Intersection Observer for scroll-reveal
- Dark theme: System-wide dark mode only — no light mode toggle

---

## Environment Variables

Create a .env file in the project root based on .env.example:

```env
# Application
APP_ID=your_app_id
APP_SECRET=your_jwt_secret

# Database
DATABASE_URL=mysql://user:password@localhost:3306/n0th1ng_ai
```

### Optional External Integrations Configured in Settings UI

| Integration | Purpose |
|-------------|---------|
| Tavily API Key | Web search in agent mode |
| Firecrawl API Key | URL scraping in agent mode |
| OpenRouter API Key | Cloud model access |
| Ollama URL | Default is http://localhost:11434 |
| ComfyUI URL | Default is http://localhost:8188 |

---

## Installation and Setup

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 22 or higher | Main application server |
| npm | 10 or higher | Package management |
| MySQL | 8 or higher | Database |
| Ollama | Latest | Local LLM serving |
| Python | 3.10 - 3.12 | Python runtimes (PersonaPlex specifically requires <= 3.12 for pre-built wheels) |
| CUDA | 12 or higher, optional | GPU acceleration |
| ComfyUI | Latest, optional | Image and video generation |

### Step 1: Clone the Repository

```bash
git clone https://github.com/n0th1ngg05/n0th1ng-ai.git
cd n0th1ng-ai
```

### Step 2: Install Node Dependencies

```bash
npm install
```

### Step 3: Configure Environment

```bash
copy .env.example .env
# Edit .env with your database URL and app credentials
```

### Step 4: Set Up the Database

```bash
npm run db:push
```

### Step 5: Set Up the Python Runtime — Optional, for OCR, Vision, Document Analysis

```bash
cd python-runtime
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Step 6: Set Up the Speech Runtime — Optional, for TTS and STT

```bash
cd speech-runtime
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Step 7: Set Up the PersonaPlex Runtime — Optional, for Persona Studio

PersonaPlex uses NVIDIA Moshi and requires **Python 3.12 max** (3.13+ will fail to build `sentencepiece`).
If your default `python` is 3.12, the UI's automatic setup will work. If not, set it up manually:

```bash
cd personaplex-runtime
python3.12 -m venv venv
venv\Scripts\activate
python -m pip install --upgrade pip
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install "numpy>=1.26,<2.2" "sentencepiece==0.2" "sphn>=0.1.4,<0.2" "safetensors>=0.4.0,<0.5" "huggingface-hub>=0.24,<0.25" "einops==0.7" "sounddevice==0.5" "aiohttp>=3.10.5,<3.11" accelerate
pip install -e moshi/
```

### Step 8: Install and Configure Ollama

```bash
# Install Ollama from https://ollama.com
ollama pull qwen3:8b
ollama pull nomic-embed-text
```

### Step 9: Set Up ComfyUI — Optional, for image and video generation

Follow the ComfyUI installation guide at https://github.com/comfyanonymous/ComfyUI and run it on http://localhost:8188.

---

## Running the Project

### Main Application

```bash
npm run dev
```

Available at http://localhost:3000.

### Python Runtime — separate terminal

```bash
cd python-runtime
.venv\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### Speech Runtime — separate terminal

```bash
cd speech-runtime
.venv\Scripts\activate
python launcher.py
```

### PersonaPlex Runtime — separate terminal, optional

```bash
cd personaplex-runtime
# Follow personaplex-runtime/README.md for setup
```

### ComfyUI — separate terminal, optional

```bash
python main.py --listen 0.0.0.0 --port 8188
```

### Production Build

```bash
npm run build
npm run start
```

---

## Project Structure

```
n0th1ng-ai/
├── api/                          # Hono backend
│   ├── boot.ts                   # Main server, 2500+ lines
│   ├── router.ts                 # tRPC root router
│   ├── context.ts                # tRPC context builder
│   ├── middleware.ts             # Auth middleware
│   ├── routers/                  # tRPC procedure routers, 17 files
│   ├── services/                 # Business logic, 50+ service files
│   │   ├── agentLoop.ts          # Autonomous agent loop engine
│   │   ├── toolRouter.ts         # 3-stage tool routing pipeline
│   │   ├── toolExecutor.ts       # Tool execution runtime
│   │   ├── toolPattern.ts        # Tool pattern matching
│   │   ├── comfy.ts              # ComfyUI integration
│   │   ├── framesx.ts            # FramesX video generation
│   │   ├── companion.ts          # Companion service
│   │   ├── memory.ts             # Persistent memory store
│   │   ├── semanticSearch.ts     # Vector similarity search
│   │   ├── rag.ts                # RAG context builder
│   │   ├── contextWindow.ts      # Context window management
│   │   ├── conversationSummary.ts # Auto-summarization
│   │   ├── telemetry.ts          # System metrics collection
│   │   ├── cluster.ts            # Distributed worker management
│   │   ├── openRouter.ts         # OpenRouter cloud bridge
│   │   └── ...
│   ├── speech/                   # Speech subsystem
│   ├── forge/                    # Forge agent routes
│   ├── forgex/                   # ForgeX routes
│   ├── queries/                  # Database query helpers
│   └── lib/                      # Shared utilities
│
├── db/
│   ├── schema.ts                 # Full database schema, 850 lines, 30+ tables
│   ├── relations.ts              # Drizzle ORM relations
│   ├── seed.ts                   # Database seed data
│   └── migrations/               # SQL migration files
│
├── frontend/                     # Multi-page frontend
│   ├── assets/                   # Global design system
│   ├── chatspace/                # Chat interface
│   ├── studio/                   # Image Studio
│   ├── framesx/                  # FramesX video generation
│   ├── voice/                    # Voice Studio
│   ├── forge/                    # Forge agent UI
│   ├── forgex/                   # ForgeX UI
│   ├── files/                    # File library
│   ├── monitor/                  # System monitor
│   ├── personastudio/            # Persona Studio
│   ├── robotics/                 # Robotics
│   ├── settings/                 # Settings panel
│   └── model/                    # Model manager
│
├── python-runtime/               # Python FastAPI sidecar
│   ├── app/
│   │   ├── providers/            # OCR, vision, PDF, layout providers
│   │   ├── tools/                # LangGraph analysis tools
│   │   ├── routes/               # API route handlers
│   │   └── managers/             # Runtime managers
│   └── requirements.txt
│
├── speech-runtime/               # Python speech sidecar
│   ├── providers/                # TTS and STT provider implementations
│   ├── inference/                # Inference pipelines
│   ├── api/                      # FastAPI routes
│   └── utils/                    # Shared utilities
│
├── personaplex-runtime/          # Moshi voice-to-voice runtime
├── contracts/                    # Shared TypeScript type contracts
├── shared/                       # Shared utilities
├── index.html                    # Home page entry point
├── vite.config.ts                # Vite configuration
├── drizzle.config.ts             # Drizzle ORM configuration
├── tailwind.config.js            # Tailwind configuration
├── tsconfig.json                 # TypeScript configuration
├── package.json                  # Node.js dependencies
└── .env.example                  # Environment variable template
```

---

## License

Built by n0th1ng Studios.

*You Imagine, We Render.*

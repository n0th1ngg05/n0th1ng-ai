import { getDb } from "../api/queries/connection";
import {
  users,
  folders,
  conversations,
  messages,
  aiModels,
  systemSnapshots,
  services,
  generatedImages,
  fileFolders,
  files,
  researchCollections,
  researchDocuments,
  knowledgeEntries,
  workflows,
  activityLogs,
} from "./schema";

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // Seed users
  await db.insert(users).values([
    {
      email: "founder@n0th1ng.ai",
      name: "Founder",
      avatarUrl: "/avatar.jpg",
      role: "admin",
    },
  ]);

  // Seed AI models
  await db.insert(aiModels).values([
    {
      name: "qwen2.5-coder:14b",
      displayName: "Qwen 2.5 Coder",
      size: "8.7 GB",
      quantization: "Q4_K_M",
      contextLength: 32768,
      status: "active",
      memoryUsage: 9437184000,
      vramUsage: 8589934592,
      tokenSpeed: 42.5,
      lastUsed: new Date(),
      isInstalled: true,
    },
    {
      name: "llama3.1:70b",
      displayName: "Llama 3.1 70B",
      size: "39.6 GB",
      quantization: "Q4_K_M",
      contextLength: 131072,
      status: "idle",
      memoryUsage: 0,
      vramUsage: 0,
      tokenSpeed: 0,
      isInstalled: true,
    },
    {
      name: "mistral-nemo:12b",
      displayName: "Mistral Nemo",
      size: "7.1 GB",
      quantization: "Q4_0",
      contextLength: 128000,
      status: "idle",
      memoryUsage: 0,
      vramUsage: 0,
      tokenSpeed: 0,
      lastUsed: new Date(Date.now() - 86400000),
      isInstalled: true,
    },
    {
      name: "deepseek-coder:33b",
      displayName: "DeepSeek Coder",
      size: "18.4 GB",
      quantization: "Q4_K_S",
      contextLength: 16384,
      status: "idle",
      memoryUsage: 0,
      vramUsage: 0,
      tokenSpeed: 0,
      isInstalled: true,
    },
    {
      name: "codellama:34b",
      displayName: "CodeLlama 34B",
      size: "19.1 GB",
      quantization: "Q4_K_M",
      contextLength: 16384,
      status: "error",
      memoryUsage: 0,
      vramUsage: 0,
      tokenSpeed: 0,
      isInstalled: true,
    },
  ]);

  // Seed folders
  await db.insert(folders).values([
    { name: "Engineering", userId: 1 },
    { name: "Research", userId: 1 },
    { name: "Creative", userId: 1 },
  ]);

  // Seed conversations
  await db.insert(conversations).values([
    {
      title: "Architecture Design Review",
      modelId: "qwen2.5-coder:14b",
      userId: 1,
      folderId: 1,
      isPinned: true,
      createdAt: new Date(Date.now() - 3600000),
      updatedAt: new Date(),
    },
    {
      title: "React Performance Analysis",
      modelId: "qwen2.5-coder:14b",
      userId: 1,
      folderId: 1,
      isPinned: false,
      createdAt: new Date(Date.now() - 7200000),
      updatedAt: new Date(Date.now() - 3600000),
    },
    {
      title: "Neural Network Concepts",
      modelId: "llama3.1:70b",
      userId: 1,
      folderId: 2,
      isPinned: false,
      createdAt: new Date(Date.now() - 86400000),
      updatedAt: new Date(Date.now() - 43200000),
    },
  ]);

  // Seed messages
  await db.insert(messages).values([
    {
      conversationId: 1,
      role: "user",
      content: "Can you review this system architecture for our AI operating system? I'm particularly concerned about the real-time data pipeline between the telemetry service and the frontend.",
      tokensUsed: 32,
      createdAt: new Date(Date.now() - 3600000),
    },
    {
      conversationId: 1,
      role: "assistant",
      content: "Looking at your architecture, the telemetry pipeline is well-structured. I recommend using WebSockets with a fallback to Server-Sent Events for the real-time data stream. Consider implementing a buffer layer with Redis for handling burst traffic, and use protocol buffers for serialization to reduce bandwidth by ~60%.",
      tokensUsed: 68,
      responseTime: 2340,
      createdAt: new Date(Date.now() - 3597000),
    },
    {
      conversationId: 1,
      role: "user",
      content: "What about the memory management for the model orchestration layer? We're seeing OOM kills when loading larger models.",
      tokensUsed: 24,
      createdAt: new Date(Date.now() - 3500000),
    },
    {
      conversationId: 1,
      role: "assistant",
      content: "For the model orchestration layer, implement a priority-based memory scheduler. Use memory mapping (mmap) for model weights instead of loading entirely into RAM. Set up a LRU cache with configurable eviction policies. Monitor via `nvidia-smi` pynvml bindings and implement graceful degradation - offload to CPU when VRAM exceeds 85%.",
      tokensUsed: 72,
      responseTime: 1890,
      createdAt: new Date(Date.now() - 3497000),
    },
    {
      conversationId: 2,
      role: "user",
      content: "Analyze the performance bottlenecks in this React component tree.",
      tokensUsed: 12,
      createdAt: new Date(Date.now() - 7200000),
    },
    {
      conversationId: 2,
      role: "assistant",
      content: "I've identified three key bottlenecks: 1) The re-render cascade in the sidebar component - memoize with React.memo and useMemo. 2) Excessive context updates - split contexts by domain. 3) Large list virtualization missing - implement windowing for lists over 50 items. Expected improvement: 40-60% reduction in render time.",
      tokensUsed: 65,
      responseTime: 1560,
      createdAt: new Date(Date.now() - 7197000),
    },
    {
      conversationId: 3,
      role: "user",
      content: "Explain transformer architecture and attention mechanisms in simple terms.",
      tokensUsed: 12,
      createdAt: new Date(Date.now() - 86400000),
    },
    {
      conversationId: 3,
      role: "assistant",
      content: "Transformers are like a group of experts reading a document together. Each expert (attention head) focuses on different relationships between words. Self-attention lets each word 'look' at every other word to understand context. Multi-head attention uses multiple experts simultaneously, then combines their insights. The feed-forward layers add non-linear transformations, like each expert refining their understanding.",
      tokensUsed: 68,
      responseTime: 3120,
      createdAt: new Date(Date.now() - 86397000),
    },
  ]);

  // Seed services
  await db.insert(services).values([
    {
      name: "ollama",
      displayName: "Ollama",
      status: "running",
      uptime: 172800,
      version: "0.3.13",
      lastChecked: new Date(),
    },
    {
      name: "comfyui",
      displayName: "ComfyUI",
      status: "running",
      uptime: 86400,
      version: "0.2.4",
      lastChecked: new Date(),
    },
    {
      name: "docker",
      displayName: "Docker",
      status: "running",
      uptime: 345600,
      version: "27.2.0",
      lastChecked: new Date(),
    },
    {
      name: "postgresql",
      displayName: "PostgreSQL",
      status: "running",
      uptime: 604800,
      version: "16.4",
      lastChecked: new Date(),
    },
  ]);

  // Seed generated images
  await db.insert(generatedImages).values([
    {
      prompt: "A breathtaking ethereal digital artwork of a crystalline neural network floating in a misty violet void",
      negativePrompt: "blurry, low quality, distorted, ugly",
      modelUsed: "SDXL",
      resolution: "1024x1024",
      steps: 40,
      sampler: "DPM++ 2M Karras",
      seed: 420691337,
      generationTime: 8240,
      gpuUsage: 98.2,
      vramUsage: 12.4,
      imageUrl: "/sample-art-1.jpg",
      createdAt: new Date(Date.now() - 86400000),
    },
    {
      prompt: "A stunning digital landscape of a futuristic city at twilight rendered in deep violet and indigo tones",
      negativePrompt: "blurry, low quality, distorted, text, watermark",
      modelUsed: "SDXL",
      resolution: "1024x1024",
      steps: 35,
      sampler: "Euler a",
      seed: 133742069,
      generationTime: 6780,
      gpuUsage: 96.8,
      vramUsage: 12.1,
      imageUrl: "/sample-art-2.jpg",
      createdAt: new Date(Date.now() - 43200000),
    },
  ]);

  // Seed file folders
  await db.insert(fileFolders).values([
    { name: "Projects" },
    { name: "Datasets" },
    { name: "Models" },
  ]);

  // Seed files
  await db.insert(files).values([
    {
      name: "architecture-v2.md",
      path: "/Projects/architecture-v2.md",
      size: 24576,
      mimeType: "text/markdown",
      folderId: 1,
      isIndexed: true,
      createdAt: new Date(Date.now() - 86400000),
    },
    {
      name: "training-data.csv",
      path: "/Datasets/training-data.csv",
      size: 104857600,
      mimeType: "text/csv",
      folderId: 2,
      isIndexed: true,
      createdAt: new Date(Date.now() - 172800000),
    },
    {
      name: "fine-tuned-qwen.gguf",
      path: "/Models/fine-tuned-qwen.gguf",
      size: 8576192300,
      mimeType: "application/octet-stream",
      folderId: 3,
      isIndexed: false,
      createdAt: new Date(Date.now() - 259200000),
    },
    {
      name: "prompts-library.json",
      path: "/Projects/prompts-library.json",
      size: 51200,
      mimeType: "application/json",
      folderId: 1,
      isIndexed: true,
      createdAt: new Date(Date.now() - 43200000),
    },
    {
      name: "evaluation-results.xlsx",
      path: "/Datasets/evaluation-results.xlsx",
      size: 1048576,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      folderId: 2,
      isIndexed: false,
      createdAt: new Date(Date.now() - 345600000),
    },
    {
      name: "llama-3.1-70b-q4.gguf",
      path: "/Models/llama-3.1-70b-q4.gguf",
      size: 39513699123,
      mimeType: "application/octet-stream",
      folderId: 3,
      isIndexed: false,
      createdAt: new Date(Date.now() - 604800000),
    },
  ]);

  // Seed research collections
  await db.insert(researchCollections).values([
    { name: "AI Architecture Papers", description: "Collection of papers on modern AI system architectures" },
    { name: "Multimodal Models", description: "Research on vision-language and multimodal AI systems" },
  ]);

  // Seed research documents
  await db.insert(researchDocuments).values([
    {
      title: "Attention Is All You Need",
      content: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
      source: "https://arxiv.org/abs/1706.03762",
      collectionId: 1,
      isBookmarked: true,
    },
    {
      title: "LLaMA: Open and Efficient Foundation Language Models",
      content: "We introduce LLaMA, a collection of foundation language models ranging from 7B to 65B parameters. We train our models on trillions of tokens, and show that it is possible to train state-of-the-art models using publicly available datasets exclusively.",
      source: "https://arxiv.org/abs/2302.13971",
      collectionId: 1,
      isBookmarked: true,
    },
    {
      title: "GPT-4V(ision) System Card",
      content: "We introduce GPT-4V(ision), the multimodal extension of GPT-4 that can process both text and image inputs. The system demonstrates remarkable capabilities in visual understanding, reasoning, and description.",
      source: "https://openai.com/research/gpt-4v-system-card",
      collectionId: 2,
      isBookmarked: false,
    },
    {
      title: "Multimodal Foundation Models: From Specialists to General-Purpose Assistants",
      content: "This survey paper provides a comprehensive review of multimodal foundation models, covering their architectures, training strategies, and applications across vision, language, and audio modalities.",
      source: "https://arxiv.org/abs/2309.10020",
      collectionId: 2,
      isBookmarked: true,
    },
  ]);

  // Seed knowledge entries
  await db.insert(knowledgeEntries).values([
    {
      title: "React Performance Optimization Patterns",
      content: "Key patterns for optimizing React applications: 1) Use React.memo for pure components 2) Implement useMemo for expensive computations 3) Virtualize long lists with react-window 4) Split code with React.lazy and Suspense 5) Use proper key props to avoid unnecessary re-renders",
      sourceType: "conversation",
      tags: ["react", "performance", "frontend"],
      relevanceScore: 0.95,
    },
    {
      title: "Transformer Architecture Deep Dive",
      content: "Transformers use self-attention mechanisms to process sequences in parallel. Key components: Multi-Head Attention, Position-wise Feed-Forward Networks, Layer Normalization, and Residual Connections. The attention mechanism computes Query, Key, and Value matrices to determine relevance between tokens.",
      sourceType: "research",
      tags: ["transformers", "nlp", "deep-learning"],
      relevanceScore: 0.92,
    },
    {
      title: "Model Quantization Techniques",
      content: "Quantization reduces model precision to decrease memory usage and improve inference speed. Common methods: INT8, INT4, GPTQ, AWQ, and GGUF formats. Q4_K_M offers the best balance between quality and size for most use cases.",
      sourceType: "manual",
      tags: ["quantization", "optimization", "llm"],
      relevanceScore: 0.88,
    },
    {
      title: "ComfyUI Workflow Best Practices",
      content: "Best practices for ComfyUI workflows: 1) Use model-specific VAE for best results 2) Set appropriate CFG scale (7-9 for SDXL) 3) Use DPM++ 2M Karras sampler for quality 4) Implement ControlNet for precise composition control 5) Use upscaling pipelines for high-resolution outputs",
      sourceType: "manual",
      tags: ["comfyui", "image-generation", "workflows"],
      relevanceScore: 0.85,
    },
    {
      title: "System Architecture: Real-time Telemetry Pipeline",
      content: "The telemetry pipeline uses WebSockets for real-time data streaming with Redis as a buffer layer. Protocol Buffers reduce bandwidth by 60%. The system monitors CPU, GPU, RAM, and VRAM via pynvml bindings, with data aggregated every 2 seconds and historical data stored in PostgreSQL.",
      sourceType: "conversation",
      tags: ["architecture", "telemetry", "backend"],
      relevanceScore: 0.91,
    },
  ]);

  // Seed workflows
  await db.insert(workflows).values([
    {
      name: "Image Generation Pipeline",
      description: "Complete pipeline from prompt to final upscaled image",
      nodes: JSON.stringify([
        { id: "1", type: "prompt", label: "Prompt Input" },
        { id: "2", type: "model", label: "SDXL Base" },
        { id: "3", type: "upscale", label: "4x Upscale" },
        { id: "4", type: "output", label: "Save Output" },
      ]),
      edges: JSON.stringify([
        { from: "1", to: "2" },
        { from: "2", to: "3" },
        { from: "3", to: "4" },
      ]),
      isTemplate: true,
    },
    {
      name: "Document Analysis",
      description: "Automated document ingestion and analysis workflow",
      nodes: JSON.stringify([
        { id: "1", type: "input", label: "PDF Upload" },
        { id: "2", type: "ocr", label: "OCR Processing" },
        { id: "3", type: "analysis", label: "AI Analysis" },
        { id: "4", type: "storage", label: "Store Results" },
      ]),
      edges: JSON.stringify([
        { from: "1", to: "2" },
        { from: "2", to: "3" },
        { from: "3", to: "4" },
      ]),
      isTemplate: false,
    },
  ]);

  // Seed activity logs
  await db.insert(activityLogs).values([
    { action: "Model loaded", entityType: "model", entityId: 1, metadata: JSON.stringify({ model: "qwen2.5-coder:14b" }) },
    { action: "Conversation created", entityType: "conversation", entityId: 1, metadata: JSON.stringify({ title: "Architecture Design Review" }) },
    { action: "Image generated", entityType: "image", entityId: 1, metadata: JSON.stringify({ prompt: "Crystalline neural network...", resolution: "1024x1024" }) },
    { action: "Service started", entityType: "service", entityId: 1, metadata: JSON.stringify({ service: "ollama" }) },
    { action: "Document added", entityType: "research", entityId: 1, metadata: JSON.stringify({ title: "Attention Is All You Need" }) },
    { action: "Knowledge entry created", entityType: "knowledge", entityId: 1, metadata: JSON.stringify({ title: "React Performance Optimization" }) },
    { action: "File uploaded", entityType: "file", entityId: 1, metadata: JSON.stringify({ name: "architecture-v2.md", size: "24KB" }) },
    { action: "Workflow created", entityType: "workflow", entityId: 1, metadata: JSON.stringify({ name: "Image Generation Pipeline" }) },
    { action: "Conversation created", entityType: "conversation", entityId: 2, metadata: JSON.stringify({ title: "React Performance Analysis" }) },
    { action: "Image generated", entityType: "image", entityId: 2, metadata: JSON.stringify({ prompt: "Futuristic cityscape...", resolution: "1024x1024" }) },
    { action: "Service started", entityType: "service", entityId: 2, metadata: JSON.stringify({ service: "comfyui" }) },
    { action: "Document added", entityType: "research", entityId: 2, metadata: JSON.stringify({ title: "LLaMA: Open and Efficient Foundation Language Models" }) },
    { action: "File uploaded", entityType: "file", entityId: 2, metadata: JSON.stringify({ name: "training-data.csv", size: "100MB" }) },
    { action: "Model benchmarked", entityType: "model", entityId: 1, metadata: JSON.stringify({ model: "qwen2.5-coder:14b", score: 42.5 }) },
    { action: "Knowledge entry created", entityType: "knowledge", entityId: 2, metadata: JSON.stringify({ title: "Transformer Architecture Deep Dive" }) },
  ]);

  // Seed system snapshots (last 60 minutes, one per minute)
  const snapshots = [];
  for (let i = 60; i >= 0; i--) {
    snapshots.push({
      cpuUsage: 25 + Math.sin(i * 0.2) * 15 + Math.random() * 10,
      cpuTemp: 45 + Math.sin(i * 0.15) * 8 + Math.random() * 5,
      ramUsage: 62 + Math.sin(i * 0.1) * 8 + Math.random() * 5,
      ramTotal: 34359738368,
      gpuUsage: 75 + Math.sin(i * 0.25) * 20 + Math.random() * 10,
      gpuTemp: 68 + Math.sin(i * 0.2) * 10 + Math.random() * 5,
      vramUsage: 10.2 + Math.sin(i * 0.15) * 2 + Math.random() * 0.5,
      vramTotal: 25769803776,
      storageUsage: 72.4 + Math.random() * 0.1,
      networkRx: 1048576 + Math.random() * 524288,
      networkTx: 2097152 + Math.random() * 1048576,
      createdAt: new Date(Date.now() - i * 60000),
    });
  }
  await db.insert(systemSnapshots).values(snapshots);

  console.log("Seed complete!");
}

seed().catch(console.error);

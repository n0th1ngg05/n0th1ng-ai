import { createRouter, publicQuery } from "./middleware";
import { modelRouter } from "./routers/model";
import { chatRouter } from "./routers/chat";
import { conversationRouter } from "./routers/conversation";
import { messageRouter } from "./routers/message";
import { systemRouter } from "./routers/system";
import { imageRouter } from "./routers/image";
import { videoRouter } from "./routers/video";
import { fileRouter } from "./routers/file";
import { researchRouter } from "./routers/research";
import { knowledgeRouter } from "./routers/knowledge";
import { workflowRouter } from "./routers/workflow";
import { activityRouter } from "./routers/activity";
import { fileContentRouter } from "./routers/fileContent";
import { speechRouter } from "./speech";
import { forgeRouter } from "./forge/router";
import { forgexRouter } from "./forgex/router";
import { providersRouter } from "./routers/providers";
import { runtimeRouter } from "./routers/runtime";
import { clusterRouter } from "./routers/cluster";
import { personaplexRouter } from "./routers/personaplex";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  model: modelRouter,
  chat: chatRouter,
  conversation: conversationRouter,
  message: messageRouter,
  system: systemRouter,
  image: imageRouter,
  video: videoRouter,
  file: fileRouter,
  research: researchRouter,
  knowledge: knowledgeRouter,
  workflow: workflowRouter,
  activity: activityRouter,
  fileContent: fileContentRouter,
  speech: speechRouter,
  forge: forgeRouter,
  forgex: forgexRouter,
  providers: providersRouter,
  runtime: runtimeRouter,
  cluster: clusterRouter,
  personaplex: personaplexRouter,
});

export type AppRouter = typeof appRouter;
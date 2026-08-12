import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { systemSnapshots } from "@db/schema";
import { desc, gte } from "drizzle-orm";
import si from "systeminformation";
import psList from "ps-list";
import pidusage from "pidusage";

export const systemRouter = createRouter({
  currentStats: publicQuery.query(async () => {
  const db = getDb();

  const latest =
    await db.query.systemSnapshots.findFirst({
      orderBy: [desc(systemSnapshots.createdAt)],
    });
    console.log(latest);

  return latest;
}),
  history: publicQuery
    .input(z.object({ range: z.enum(["1h", "24h", "7d"]) }))
    .query(async ({ input }) => {
      const db = getDb();
      const minutes = input.range === "1h" ? 60 : input.range === "24h" ? 1440 : 10080;
      const since = new Date(Date.now() - minutes * 60000);
      return db.query.systemSnapshots.findMany({
        where: gte(systemSnapshots.createdAt, since),
        orderBy: [systemSnapshots.createdAt],
        limit: input.range === "1h" ? 60 : input.range === "24h" ? 288 : 168,
      });
    }),
    storage: publicQuery.query(async () => {
  const disks = await si.fsSize();

  return disks.map((disk) => ({
    filesystem: disk.fs,
    mount: disk.mount,
    total: disk.size,
    used: disk.used,
    available: disk.available,
    usagePercent: disk.use,
  }));
}),

  services: publicQuery.query(async () => {
    const db = getDb();
    return db.query.services.findMany();
  }),
  serviceHealth: publicQuery.query(async () => {
  const processes = await psList();

  const findService = (keywords: string[]) => {
    return processes.some((p) =>
      keywords.some((keyword) =>
        p.name.toLowerCase().includes(keyword)
      )
    );
  };
  

  return [
    {
      name: "Ollama",
      status: findService(["ollama"])
        ? "running"
        : "stopped",
    },
    {
      name: "MySQL",
      status: findService([
        "mysqld",
        "mysql",
      ])
        ? "running"
        : "stopped",
    },
    {
      name: "Node Backend",
      status: findService(["node"])
        ? "running"
        : "stopped",
    },
    {
      name: "ComfyUI",
      status: findService(["comfyui"])
        ? "running"
        : "stopped",
    },
  ];
}),

  processes: publicQuery.query(async () => {
  const processes = await psList();

  const interestingProcesses = processes
    .filter((p) =>
      [
        "ollama",
        "node",
        "python",
        "python3",
        "mysqld",
        "mysql",
        "comfyui",
        "docker",
      ].some((name) =>
        p.name.toLowerCase().includes(name)
      )
    )
    .slice(0, 25);

  const result = await Promise.all(
    interestingProcesses.map(async (proc) => {
      try {
        const stats = await pidusage(proc.pid);

        return {
          pid: proc.pid,
          name: proc.name,
          cpu: Number(stats.cpu.toFixed(1)),
          memory: Math.round(
            stats.memory / 1024 / 1024
          ),
          status: "running",
        };
      } catch {
        return null;
      }
    })
  );

  return result.filter(Boolean);
}),

});

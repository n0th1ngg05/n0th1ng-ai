import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

import type { Plugin } from "vite"

// Dev only. Two problems with devServer({ exclude: non-/api }):
//  1) Hono's boot (DB, runtimes, poller...) was lazily loaded on the first /api request,
//     so nothing started until a page made an API call. -> load it as soon as Vite listens.
//  2) HTML pages were served by Vite directly and never passed through Hono's auth gate,
//     so / opened without login. -> run page navigations through the gate first.
function n0th1ngDevBoot(): Plugin {
  const ENTRY = "/api/boot.ts"
  return {
    name: "n0th1ng-dev-boot",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        server.ssrLoadModule(ENTRY).catch((err) => {
          server.ssrFixStacktrace(err as Error)
          console.error("[dev-boot] Failed to start API:", err)
        })
      })

      server.middlewares.use(async (req, res, next) => {
        try {
          const url = req.url || "/"
          const accept = String(req.headers.accept || "")
          const pathname = url.split("?")[0]
          const isPageNav =
            (req.method === "GET" || req.method === "HEAD") &&
            accept.includes("text/html") &&
            !pathname.startsWith("/api/") &&
            !pathname.startsWith("/@") &&
            !pathname.startsWith("/node_modules/")
          if (!isPageNav) return next()

          const mod: any = await server.ssrLoadModule(ENTRY)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
            else if (v !== undefined) headers.set(k, String(v))
          }
          const probe = await mod.default.fetch(
            new Request(`http://${req.headers.host || "localhost:3000"}${url}`, {
              method: req.method,
              headers,
              redirect: "manual",
            }),
          )
          // Gate said "not signed in": relay its redirect/401. Anything else (404 = not an API route) -> Vite serves the page.
          if (probe.status === 401 || (probe.status >= 300 && probe.status < 400)) {
            res.statusCode = probe.status
            probe.headers.forEach((value: string, key: string) => {
              if (key.toLowerCase() !== "set-cookie") res.setHeader(key, value)
            })
            const cookies = (probe.headers as any).getSetCookie?.() ?? []
            if (cookies.length) res.setHeader("set-cookie", cookies)
            res.end(await probe.text())
            return
          }
          next()
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

const WATCH_IGNORED: (string | RegExp)[] = [
  /\.wrangler/,
  /\.mf/,
  "**/python-runtime/**",
  "**/speech-runtime/**",
  "**/personaplex-runtime/**",
  "**/.venv/**",
  "**/venv/**",
  "**/transfer/**",
  "**/PPT/**",
  "**/uploads/**",
  "**/storage/**",
  "**/data/**",
  "**/public/generated/**",
  "**/public/video/**",
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    n0th1ngDevBoot(),
    devServer({
      entry: "api/boot.ts",
      exclude: [/^\/(?!api\/).*$/],
      ignoreWatching: WATCH_IGNORED,
    }),
    inspectAttr(),
    react(),
  ],
  server: {
    port: 3000,
    watch: {
      ignored: WATCH_IGNORED,
    },
  },
  optimizeDeps: {
    entries: ["index.html", "frontend/**/*.html"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});

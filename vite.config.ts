import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

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

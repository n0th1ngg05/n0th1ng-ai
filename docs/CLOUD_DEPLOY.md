# Cloud deploy (Oracle Always Free VM)

One switch: `CLOUD_MODE=true` in `.env`. Template: `.env-cloud.example`.

## What CLOUD_MODE changes
- NODE_ENV defaults to production; startup validates APP_SECRET, DATABASE_URL, PRODUCTION_ORIGIN.
- Speech/Python sidecars, companion service, Forge/ForgeX are OFF (override with ENABLE_LOCAL_RUNTIMES / ENABLE_COMPANION / ENABLE_FORGE).
- LLM router: if Ollama (`OLLAMA_BASE_URL`) is unreachable, or fails mid-request with a connection error or HTTP >= 502, chat falls back to `openrouter:LLM_FALLBACK_MODEL`.
- Embeddings use `OLLAMA_EMBED_URL` (default: the `ollama-embed` compose profile).
- Image/video generation (ComfyUI) needs a reachable `COMFYUI_URL`; unavailable otherwise.

## First deploy on the VM
```
sudo apt install -y docker.io docker-compose-v2 git
git clone <repo> n0th1ng && cd n0th1ng
cp .env-cloud.example .env && nano .env
docker compose --profile embeddings up -d --build
docker compose exec ollama-embed ollama pull nomic-embed-text
docker compose logs -f app
```
Set the master password BEFORE exposing the app publicly (`/api/auth/setup` is open until set), e.g. via `ssh -L 3000:127.0.0.1:3000` first.

## Tunnel (needs a domain on Cloudflare)
Put the tunnel token in `CLOUDFLARE_TUNNEL_TOKEN`, point the public hostname to `http://app:3000`, then `docker compose --profile tunnel up -d`.

## Update
`git pull && docker compose up -d --build`

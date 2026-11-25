# Cloud Deployment Guide (Oracle Always Free VM, Docker)

This guide reproduces the setup that is running today: n0th1ng AI as a headless, always-on server in Docker on an Oracle Cloud Always Free Ampere A1 VM (Ubuntu 24.04, aarch64, 2 OCPU / 12 GB). It is controlled by one switch, `CLOUD_MODE=true`. See the README section "Cloud Mode & Docker Deployment" for what the switch changes.

Status: image build, migrations, boot, master-password setup and login (through an SSH tunnel) are verified. The OpenRouter fallback under real failure, embeddings in the container, the Cloudflare Access PIN flow (the tunnel itself works), the GPU worker and reboot recovery are **not yet verified**.

## 1. Architecture

```
Browser ──(SSH tunnel today / Cloudflare tunnel later)──▶ 127.0.0.1:3000  app (Hono, serves API + frontend, same origin)
                                                            │
                                 ┌──────────────────────────┼──────────────────────────┐
                                 ▼                          ▼                          ▼
                          db (MySQL 8.4)        Ollama (embeddings, optional)   OpenRouter / GPU worker (chat)
```

- One repo, one branch (`main`). The frontend is served by the same Hono server, so there is no separate frontend deployment.
- Deploy by `git pull` and `docker compose up -d --build` on the VM.
- Nothing is exposed publicly by default: the app is bound to `127.0.0.1` and no Oracle ingress ports are opened.

## 2. VM prerequisites

```bash
sudo apt update && sudo apt upgrade -y && sudo reboot
# after reconnecting:
sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu     # then log out/in (or `newgrp docker`)
docker run --rm hello-world
```

## 3. Get the code

```bash
mkdir -p ~/n0th1ng && cd ~/n0th1ng
git clone https://github.com/n0th1ngg05/n0th1ng-ai.git
cd n0th1ng-ai
```
For a private repo use a fine-grained GitHub token (Contents: read-only, single repository) as the password. Never commit `.env`.

## 4. Configure `.env`

```bash
cp .env-cloud.example .env && chmod 600 .env
```

Generate secrets (keep them on the VM only):
```bash
openssl rand -hex 32   # APP_SECRET
openssl rand -hex 16   # MARIADB_ROOT_PASSWORD, MARIADB_PASSWORD (hex is safe inside DATABASE_URL)
```

| Variable | Value |
|---|---|
| `CLOUD_MODE` | `true` |
| `APP_ID` | any short name |
| `APP_SECRET` | generated |
| `DATABASE_URL` | `mysql://n0th1ng:<MARIADB_PASSWORD>@db:3306/n0th1ng` (password must match `MARIADB_PASSWORD`) |
| `MARIADB_ROOT_PASSWORD`, `MARIADB_PASSWORD`, `MARIADB_DATABASE`, `MARIADB_USER` | used by the `db` container (names are legacy; the container is MySQL 8.4) |
| `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` | required in production |
| `OPENROUTER_API_KEY` | needed for the chat fallback |
| `PRODUCTION_ORIGIN`, `ALLOWED_ORIGINS`, `WEBAUTHN_ORIGIN` | `http://localhost:3000` while using an SSH tunnel; the real `https://` origin later |
| `WEBAUTHN_RP_ID` | `localhost` now; the bare domain later |
| `CF_ACCESS_REQUIRED` | `false` until Cloudflare Access is set up |
| `OLLAMA_BASE_URL` | blank until a worker or VM Ollama is connected (chat then uses the OpenRouter fallback) |
| `OLLAMA_EMBED_URL` | `http://ollama-embed:11434` when using the `embeddings` profile |
| `OLLAMA_AUX_URL`, `TOOL_ROUTER_MODEL` | `http://ollama-embed:11434` and `lfm2.5-thinking:1.2b`: the small helper model for the tool router (yes/no gate and Stage 3), kept separate from chat so chat can go to a worker or OpenRouter |
| `WORKER_DESKTOP_URL`, `WORKER_DESKTOP_KEY` | blank until the GPU worker is connected |
| `CLOUDFLARE_TUNNEL_TOKEN` | blank until the tunnel is created |

## 5. Build and start

```bash
docker compose --profile embeddings up -d --build
docker compose ps
docker compose logs --tail=40 app
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/auth/status   # expect 200
```
Healthy startup logs `[migrate] Migrations applied.`, a `[CLOUD] ...` summary line, `[Boot] Database connection initialized.` and `Server running on http://localhost:3000/`. The warning about `CF_ACCESS_REQUIRED` and a disabled worker poller are expected at this stage.

The `embeddings` profile also starts a one-shot `ollama-models` container that pulls `nomic-embed-text` (memory/RAG) and the tool-router model into the `ollama` volume, then exits. Watch it with `docker compose logs -f ollama-models`; it skips models already downloaded.

## 6. Reach it and set the master password

From your PC:
```
ssh -i <key> -L 3000:127.0.0.1:3000 ubuntu@<VM-public-IP>
```
Then open `http://localhost:3000` (stop any local `npm run dev` first). **Set the master password immediately:** `/api/auth/setup` is public until a password exists. Forgot it? `npm run auth:reset` is the break-glass tool (see the README runbook), but it needs `tsx`, a dev dependency that is **not in the Docker image**, and the database port is not published. Recovering a lost password in this container setup is therefore not yet solved; keep the password safe until a recovery path (for example a one-off container with dev dependencies) is added.

## 7. Updating

On your PC: commit and push to `main`. On the VM:
```bash
cd ~/n0th1ng/n0th1ng-ai && git pull
docker compose --profile embeddings up -d --build
docker image prune -f
```
`docker compose down -v` deletes the database and all volumes. Use it only to reset from scratch.

## 8. Optional: native Ollama on the VM

Lets you pull and test models from the shell (the VM is CPU-only; a 1.2B model such as `lfm2.5-thinking:1.2b-q4_K_M` should run at usable but modest speed, measure with `ollama run <model> --verbose`).

1. Install: `curl -fsSL https://ollama.com/install.sh | sh`.
2. Listen on the Docker bridge only: `sudo systemctl edit ollama` and add `Environment="OLLAMA_HOST=172.17.0.1:11434"`, then `sudo systemctl restart ollama`. Never bind it to `0.0.0.0` (no authentication).
3. Create `docker-compose.override.yml` (VM only, untracked) with `services: app: extra_hosts: ["host.docker.internal:host-gateway"]`.
4. In `.env`: `OLLAMA_BASE_URL=http://host.docker.internal:11434` and `OLLAMA_EMBED_URL` the same; start without the `embeddings` profile.
5. If the container cannot connect, an iptables rule allowing `172.17.0.0/16` to port 11434 may be needed.

## 9. Going public with Cloudflare (ai.nothingstudios.co.in)

The tunnel part below was done and works (site loads and is usable). Access enforcement was configured in the dashboard and `.env`; the end-to-end PIN flow is not yet confirmed.

**Phase 1 - tunnel**
1. Cloudflare dashboard -> Zero Trust -> Networks -> Tunnels -> create a *Cloudflared* tunnel. On the install page choose the **Docker** tab and copy only the token (do not run the Windows command; the connector runs on the VM).
2. Put the token in the VM's `.env` as `CLOUDFLARE_TUNNEL_TOKEN` (never commit or paste it anywhere).
3. Add a public hostname (Routes): subdomain `ai`, domain `nothingstudios.co.in`, service `http://app:3000`. Cloudflare creates the DNS record.
4. In `.env`: `PRODUCTION_ORIGIN`, `ALLOWED_ORIGINS` and `WEBAUTHN_ORIGIN` = `https://ai.nothingstudios.co.in`; keep `CF_ACCESS_REQUIRED=false` for now.
5. `docker compose --profile embeddings --profile tunnel up -d --build`, then `docker compose logs tunnel` (should show registered connections) and open the URL.

**Phase 2 - Access**
1. Zero Trust -> Access -> Applications -> Add -> Self-hosted: hostname `ai.nothingstudios.co.in`, name `n0th1ng AI`.
2. Create a policy `Owner`: action *Allow*, include *Emails* = your address; leave identity providers on (One-time PIN is the default).
3. Copy the application's **AUD tag**; the team domain is under Zero Trust -> Settings (`<team>.cloudflareaccess.com`).
4. `.env`: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `CF_ACCESS_REQUIRED=true`; then `docker compose up -d app`.
5. Test in a private window: Cloudflare asks for the email and PIN first, then the app's own login appears. A 403 `CF_ACCESS_REQUIRED` JSON error means the AUD/team domain do not match; set `CF_ACCESS_REQUIRED=false` to get back in while debugging.

Workers and API clients cannot answer the PIN: give them a Cloudflare service token (`CF_ACCESS_SERVICE_CLIENT_ID` / `CF_ACCESS_SERVICE_CLIENT_SECRET`) or use the worker pre-shared keys. Also set `WEBAUTHN_RP_ID` to the real domain before registering passkeys.

## 10. Connecting the GPU worker (planned)

Set `WORKER_DESKTOP_URL` and `WORKER_DESKTOP_KEY` (keys come from `npm run worker:keys`) and point `OLLAMA_BASE_URL` at the worker's Ollama through its tunnel. Chat is routed to the worker when reachable and to OpenRouter otherwise. Failover has not yet been tested end to end.

## 11. Maintenance

- **Disk:** every build leaves old images and build cache. Check with `docker system df`; reclaim with `docker image prune -a -f` and `docker builder prune -f` (or `docker builder prune -f --keep-storage 3GB`).
- **Backups (not set up yet):** the database lives in the `dbdata` volume. A nightly `mysqldump` copied off the VM is recommended, for example `docker compose exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" n0th1ng' | gzip > backup.sql.gz`.
- **Oracle idle reclamation:** Always Free instances can be reclaimed when CPU, network and memory (A1) all stay under 20% at the 95th percentile for 7 days. Keep the MySQL buffer pool large (the compose file sets 3 GB) so memory use stays above the threshold.
- **Billing:** set a budget alert in Oracle Cost Analysis.

## 12. Troubleshooting (issues hit during the first deployment)

| Symptom | Cause and fix |
|---|---|
| Build fails with `nested-comment` in `index.html` | An HTML comment nested inside another; Vite's parser rejects it. Fixed. |
| Build fails: `Could not resolve "../storage/...Storage.js"` | `.gitignore` had `storage/`, which also ignored `api/speech/storage/`. Fixed by anchoring to `/storage/`, `/uploads/`, `/data/`. |
| Build fails: no matching export `emitProfileCreated` etc. | Missing helper functions in `api/speech/events/speechEvents.ts`. Added. |
| `No file .../0000_colorful_crystal.sql found` | `.gitignore` had `db/migrations/*.sql`. Removed; migrations must be committed. |
| `ER_PARSE_ERROR ... serial AUTO_INCREMENT` | MariaDB cannot run the generated migrations. Use MySQL 8 (the compose default now). Reset the volume with `down -v` after switching engines. |
| `ER_FK_INCOMPATIBLE_COLUMNS` on `chunk_embeddings` | Three foreign-key columns were `int`/`bigint` while their parents are `bigint unsigned`. Fixed in `db/schema.ts` and migration `0002`. A failed migration leaves half-created tables (MySQL DDL does not roll back); then `down -v` and retry. |
| `Identifier 'createRequire' has already been declared` | The bundle banner clashed with a bundled dependency. Banner now aliases the import. |
| `permission denied ... docker.sock` | Group change not active yet: `newgrp docker` or reconnect. |
| Log floods with the same migration error | The container restart loop repeats it; read only the first error and use `docker compose logs --tail=40 app`. |
| Log repeats `Error: spawn ps ENOENT` | The slim Node image has no `ps`; telemetry and the system monitor spawn it. The runtime stage of the `Dockerfile` now installs `procps`. Rebuild with `--build`. |
| `403 CF_ACCESS_REQUIRED` after the Cloudflare PIN | `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` does not match the Access application. Fix them, or set `CF_ACCESS_REQUIRED=false` temporarily. |
| Tunnel shows healthy but the site gives 502/1033 | The hostname route is missing or points to `localhost`; it must be `http://app:3000`. |

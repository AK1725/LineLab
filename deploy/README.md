# Deploying a public LineLab demo

This is the whole stack from `docker-compose.yml` behind [Caddy](https://caddyserver.com/), which obtains HTTPS certificates automatically. Only ports 80 and 443 are published. Postgres, Redis, the API, vision and the sandboxed compiler stay on internal networks.

1. Get a Linux VM with Docker (Compose v2.24 or later), at least 2 vCPU, 4 GB RAM and 20 GB disk. Point a DNS name at it.
2. Copy `deploy/demo.env.example` to `.env` in the repository root and fill it in:
   - `DEMO_DOMAIN`, the DNS name;
   - `AUTH_SECRET`, from `openssl rand -hex 32`;
   - `POSTGRES_PASSWORD`;
   - optionally `ANTHROPIC_API_KEY`, and the GitHub OAuth app keys for sign-in.
3. Start the stack:

   ```bash
   docker compose -f docker-compose.yml -f deploy/compose.demo.yml --profile apps up -d --build
   ```

4. Open `https://<DEMO_DOMAIN>`.

Notes:

- The AI debugger and photo detection call the Anthropic API with the server's key, so they cost money. The demo override lowers the per-IP limits (3 debugger sessions and 5 photo analyses per hour); adjust them in `.env`. Users can always use their own key instead.
- Email sign-in links are sent by SMTP: set `SMTP_URL` and `MAIL_FROM`. The API checks the connection at startup and logs a warning if it fails. Without `SMTP_URL`, the links only appear in the API log.
- For GitHub sign-in, create an OAuth app whose callback is `https://<DEMO_DOMAIN>/api/auth/github/callback`.
- Back up the `postgres-data` volume: it holds the gallery and the shared fix knowledge base.

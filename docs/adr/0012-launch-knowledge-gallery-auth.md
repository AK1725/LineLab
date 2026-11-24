# 0012. Launch: knowledge base, gallery and sign-in, offline, i18n, accessibility

- Status: accepted
- Date: 2026-11-24

## Context

Phase 11 asks for:

- a pgvector fix knowledge base with an opt-in privacy model;
- a synthetic bug-injection data generator;
- a gallery with fork and share;
- auth;
- a BOM and cost report;
- learn-mode tutorials;
- an offline PWA;
- i18n scaffolding;
- an accessibility pass;
- the README and a demo deployment config.

Acceptance: Lighthouse ≥ 90 (performance, accessibility, best practices) on the home and run pages; no critical axe issues; `docker compose up` runs the full product on a clean machine following the README alone.

## Decisions

1. **The knowledge base stores only what's needed to help someone else.** That is a diff, a diagnosis, symptoms and the board/driver/sensor ids: never the sketch, never who sent it. A fix is stored only when the user ticks "Share this fix" (off by default).
   - It lives in Postgres + pgvector (Drizzle, HNSW cosine index), one row per diff, with confirmations counted.
   - Synthetic cases are labelled `synthetic` everywhere, rank below user-confirmed ones, and are presented to the agent as "verified in simulation only".
2. **Embeddings: bge-small-en-v1.5 on ONNX Runtime (fastembed) in the vision service, not PyTorch.** BLUEPRINT §5.9 suggests bge-small via sentence-transformers, which would put PyTorch in the image. fastembed runs the same model on ONNX Runtime.
   - It adds about 65 MB of model, downloaded when the image is built, so it runs offline. There is no PyTorch.
   - It produces 384-dimension vectors, the size the database column already holds.
   - The API calls `POST /embed` (`EMBEDDINGS_URL`): queries and stored cases are embedded the way bge expects.
   - Every row records its model, and on startup the store re-embeds rows from a different model, so switching is automatic.
   - Without the service, a dependency-free word-hashing embedder is used, with a warning.
   - Tested: a paraphrase that shares no words with the stored case ("my bot wobbles side to side" against "Kp is too high … oscillates") is not found by word-hashing, and is found after re-embedding with bge.
3. **Synthetic seed by mutation, kept only when LineLab detects it** (`inject-bugs`):
   - 11 mutation operators (gains, delays, inverted motor or steering, sensor order, speed, line-lost handling, wrong pin) run on the known-good sketch over 3 tracks.
   - A mutant is kept only if the simulator and detectors find a new failure.
   - The fix is the reverse diff to the verified original.
   - Each case groups one mutation's symptoms from every track where it was detected.
   - Result: 9 cases (2 of the 11 operators, Kd = 0 and a 15 ms delay, weren't detected on these tracks) in `examples/knowledge/seed.json`, loaded into an empty base (`LINELAB_KB_SEED`).
4. **Sign-in is built in, not Auth.js.** Auth.js v5 (the version for Next 16) is still a beta, and what's needed is small and lives in the API:
   - HMAC-signed session cookies (HttpOnly, SameSite=Lax, Secure over HTTPS);
   - GitHub OAuth (state cookie, code exchange);
   - email magic links (hashed one-time tokens, 15 minutes, per-IP and per-address limits);
   - same-site redirects only.

   Emails go through a `Mailer` interface:
   - **SMTP** via nodemailer (`SMTP_URL`, `MAIL_FROM`; any provider), with the connection checked at startup;
   - **log**, which writes the link to the server log, for self-hosting without a mail server.

   Development-only link return (`LINELAB_AUTH_DEV_LINKS=1`) is refused in production.

5. **Guest-first gallery.** Designs stay in the browser (IndexedDB) and never need an account. Publishing needs sign-in and sends only the design JSON.
   - Items are public or unlisted (link only), versioned, and deletable by the author.
   - A fork is a local copy (counted on the server); publishing it records its parent.
6. **Offline without a framework.** A hand-written service worker:
   - precaches the shell pages and the assets they reference;
   - serves hashed assets cache-first;
   - serves pages network-first, with the cached copy offline;
   - never caches `/api/`.

   Because simulation, emulation and designs run in the browser, the studio works offline after one visit.

7. **i18n scaffolding without a library.** A typed message catalogue with a `useT()` hook and per-key English fallback, plus a footer language switcher that sets `<html lang>`. The navigation, home page and footer are translated (English, Spanish). next-intl can replace it once routing by locale is wanted; the catalogue shape carries over.
8. **Accessibility is measured in tests.** axe-core runs in Playwright (WCAG 2.1 A/AA) on 10 pages, the editor, a finished run and dark mode, with no critical or serious issues allowed. Lighthouse runs on the home page and on the run page with a real saved design (one browser context, so the measured page isn't "Design not found"), mobile and desktop.
   - Contrast fixes: the light-theme accent moved from #0f9d74 (3.4:1 with white) to #087a5a (5.3:1).
9. **Demo deployment** is the same compose file with an override:
   - Caddy (automatic HTTPS) is the only published service;
   - required secrets, with no defaults;
   - lower AI rate limits;
   - restart policies.

## Consequences

- nodemailer (MIT-0, about 1.8 MB) is a runtime dependency of the API only. The ONNX runtime and the bge model are in the vision image only. Nothing is added to the browser bundle.
- Retrieval uses meaning when the vision service runs. A deployment without it still works, matching words, and says so in the log.
- Lighthouse measures page load. The 3D scene and a running simulation are heavier, but they load on demand.

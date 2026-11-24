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
2. **Embeddings: a dependency-free hashing embedder for now.** BLUEPRINT §5.9 suggests bge-small via sentence-transformers. That needs PyTorch and a model download (hundreds of MB) in the vision image, which CLAUDE.md says to ask about first.
   - Signed feature hashing of words, identifier parts and word pairs is deterministic and good enough to retrieve the right bug class from short symptom text (tested on the seed set).
   - The `Embedder` interface and the model id stored with each row let a neural embedder replace it; rows are then re-embedded.
3. **Synthetic seed by mutation, kept only when LineLab detects it** (`inject-bugs`):
   - 11 mutation operators (gains, delays, inverted motor or steering, sensor order, speed, line-lost handling, wrong pin) run on the known-good sketch over 3 tracks.
   - A mutant is kept only if the simulator and detectors find a new failure.
   - The fix is the reverse diff to the verified original.
   - Each case groups one mutation's symptoms from every track where it was detected.
   - Result: 9 cases (2 of the 11 operators, Kd = 0 and a 15 ms delay, weren't detected on these tracks) in `examples/knowledge/seed.json`, loaded into an empty base (`LINELAB_KB_SEED`).
4. **Sign-in is built in, not Auth.js.** Auth.js v5 (the version for Next 16) is still a beta, and with nodemailer it would add more than 3 MB of runtime dependencies, which CLAUDE.md asks to avoid without approval. What's needed is small and lives in the API:
   - HMAC-signed session cookies (HttpOnly, SameSite=Lax, Secure over HTTPS);
   - GitHub OAuth (state cookie, code exchange);
   - email magic links (hashed one-time tokens, 15 minutes, per-IP and per-address limits);
   - same-site redirects only.

   Emails go through a `Mailer` interface. The built-in mailer writes the link to the server log, which works for self-hosting; an SMTP mailer is "coming soon". Development-only link return (`LINELAB_AUTH_DEV_LINKS=1`) is refused in production.

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

- No SMTP: on a public demo, use GitHub sign-in, or read email links from the log.
- The hashing embedder matches words, not meaning. Paraphrases with no shared words won't match until a neural embedder is plugged in.
- Lighthouse measures page load. The 3D scene and a running simulation are heavier, but they load on demand.

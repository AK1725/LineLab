# @linelab/compiler

Sandboxed firmware compile service (arduino-cli / PlatformIO / emscripten).

**Status:** placeholder — implemented in **Phase 6** of [`docs/BUILD_PLAN.md`](../../docs/BUILD_PLAN.md).

The Phase 6 service runs in its own Docker image (arduino-cli, PlatformIO cores, emscripten). It has **no network access at runtime**, CPU/memory/time limits, a non-root user and a fresh temp directory per job. It is not in `docker-compose.yml` yet because nothing real exists to run.

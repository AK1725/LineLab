# 0003. Toolchain versions at project start

- Status: accepted
- Date: 2026-11-23

## Context

The blueprint was written against "Next.js 15, TypeScript strict, ESLint". By Phase 0, newer major versions existed and some combinations were incompatible.

## Decision

| Tool             | Version             | Why not the newest / why not the blueprint's                                                                                                                                          |
| ---------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js          | **16.4**            | Current stable. 15.x is a backport line; starting a new project on it would mean an early forced upgrade.                                                                             |
| React            | 19.3                | Matches Next 16.                                                                                                                                                                      |
| TypeScript       | **6.0**             | 7.0 (native port) is out, but `typescript-eslint` 8.x supports only `<6.1`. Type-aware linting matters more than compiler speed right now. Revisit when typescript-eslint supports 7. |
| ESLint           | **9.39**            | ESLint 10 is out, but `eslint-plugin-react` (used by `eslint-config-next`) supports only up to 9.                                                                                     |
| Zod              | 4.6                 | Uses Zod 4's built-in `z.toJSONSchema`, so no `zod-to-json-schema` dependency.                                                                                                        |
| Vitest           | 5.1                 | Current.                                                                                                                                                                              |
| Playwright       | **1.63.0** (pinned) | Matches the browser build preinstalled in the cloud dev container. CI installs its own matching browser.                                                                              |
| Python           | **≥ 3.12**          | Blueprint said 3.12. Tested on 3.13.                                                                                                                                                  |
| Test HTTP client | `httpx2`            | Starlette deprecated `httpx` for its TestClient. Tests treat warnings as errors.                                                                                                      |

All versions are pinned exactly in `package.json` (no `^`). Updates go through Dependabot PRs (`.github/dependabot.yml`).

## Consequences

- `CLAUDE.md` says Next.js 16.
- When typescript-eslint and eslint-plugin-react support the newer majors, a new ADR moves TypeScript to 7 and ESLint to 10.

# @linelab/compiler

The sandboxed firmware compile service. `POST /compile` with `{ board, files }` (see `CompileRequest` in `@linelab/schema`) returns either a `FirmwareArtifact` or diagnostics with file, line and column.

- **AVR boards (Uno, Nano, Pro Mini)**: `arduino-cli compile`. Returns the Intel HEX, the DWARF line table, and the symbol table with variable types from DWARF. The binary runs cycle-accurately in the simulator.
- **Other boards**: `clang++ --target=wasm32` against [`@linelab/lfr-hal`](../../packages/lfr-hal). Returns a WebAssembly module that runs on the approximate HAL tier.

Sandbox ([ADR 0007](../../docs/adr/0007-firmware-runtime.md)):

- no network (internal-only Docker network; toolchains are baked into the image);
- 1 GB memory and 2 CPUs, read-only root, no capabilities, non-root;
- per job: a fresh temporary directory, a clean environment, `prlimit` and a 60 s timeout.

```bash
docker compose --profile apps up -d --build compiler
```

```bash
apps/compiler/scripts/sandbox-check.sh   # proves the limits from inside the container
```

Local development needs `arduino-cli` with `arduino:avr` installed (`ARDUINO_CLI`, `ARDUINO_DATA_DIR`) and clang with the wasm32 target:

```bash
pnpm --filter @linelab/compiler dev
```

```bash
pnpm --filter @linelab/compiler examples:build   # rebuild examples/firmware/*/*.artifact.json
```

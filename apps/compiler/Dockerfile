# Build from the repo root:  docker build -f apps/compiler/Dockerfile .
# The image carries every toolchain (arduino-cli + arduino:avr, clang/lld for the HAL), so it runs
# with no internet access at all. docker-compose puts it on an internal-only network and caps it
# at 1 GB of memory and 2 CPUs; each job also gets prlimit limits and a 60 s timeout.
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @linelab/compiler... \
 && pnpm --filter @linelab/compiler... build \
 && pnpm deploy --filter @linelab/compiler --prod --legacy /out

FROM node:22-bookworm-slim
ARG ARDUINO_CLI_VERSION=1.3.1
ARG ARDUINO_AVR_VERSION=1.8.8
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl clang lld clang-tidy cppcheck util-linux \
 && curl -fsSL "https://downloads.arduino.cc/arduino-cli/arduino-cli_${ARDUINO_CLI_VERSION}_Linux_64bit.tar.gz" | tar xz -C /usr/local/bin arduino-cli \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
ENV ARDUINO_DATA_DIR=/opt/arduino ARDUINO_DIRECTORIES_DATA=/opt/arduino ARDUINO_DIRECTORIES_DOWNLOADS=/tmp/arduino-dl
RUN arduino-cli core update-index \
 && arduino-cli core install "arduino:avr@${ARDUINO_AVR_VERSION}" \
 && rm -rf /tmp/arduino-dl && chmod -R a+rX,a-w /opt/arduino
WORKDIR /app
COPY --from=build /out .
COPY packages/lfr-hal /app/lfr-hal
ENV NODE_ENV=production LFR_HAL_DIR=/app/lfr-hal CLANG=clang++ COMPILER_WORK_DIR=/tmp PORT=8100
USER node
EXPOSE 8100
CMD ["node", "dist/server.js"]

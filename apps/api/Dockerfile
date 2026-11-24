# Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @linelab/api... \
 && pnpm --filter @linelab/api... build \
 && pnpm deploy --filter @linelab/api --prod --legacy /out

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# Synthetic bug -> fix cases that seed an empty knowledge base (labelled synthetic).
COPY --from=build /repo/examples/knowledge/seed.json ./seed/knowledge-seed.json
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]

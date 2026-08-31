# The portal. Next.js standalone output, so the runtime image carries a server and
# its traced dependencies rather than the whole node_modules tree.
FROM node:22-alpine AS build
WORKDIR /app
# Corepack resolves the pnpm version from package.json's "packageManager" field.
# Without that pin it fetches the newest pnpm, which cannot read this lockfile
# (version 6.0, written by pnpm 8) and fails with ERR_PNPM_LOCKFILE_BREAKING_CHANGE.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Build-time env only needs to satisfy the config schema; nothing is baked in.
# Every page is dynamic and reads the Cloud on request.
ENV TEMPORAL_CLOUD_API_KEY=build \
    PORTAL_ACCOUNT_ID=build \
    PORTAL_SHARED_SECRET=build-only-placeholder-secret
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
RUN addgroup -g 10001 portal && adduser -u 10001 -G portal -D portal

COPY --from=build --chown=10001:10001 /app/.next/standalone ./
COPY --from=build --chown=10001:10001 /app/.next/static ./.next/static

USER 10001
EXPOSE 3000
CMD ["node", "server.js"]

# orders-api: multi-stage build on Chainguard (Wolfi) images.
# Builder has npm and a shell; the runtime runs only node as nonroot (65532) with Node's permission
# model: it can read /app and use the network, but cannot write files, spawn processes, start
# workers, load native addons or eval strings.
# Bases are pinned by digest; Dependabot (docker) updates them.

FROM cgr.dev/chainguard/node:latest-dev@sha256:42e9e83d31a228a12c991c4c332205409cb7b46bd29a3e9519f6c98f710fbea1 AS builder
WORKDIR /app
COPY --chown=65532:65532 package.json package-lock.json .npmrc ./
# npm ci installs exactly the lockfile (integrity hashes checked); .npmrc disables install scripts.
RUN npm ci --omit=dev --no-audit --ignore-scripts && npm cache clean --force

FROM cgr.dev/chainguard/node:latest@sha256:3f0d2afa09a5b4ccf8cb9caf9457343d0128a7e1ca63ebe5f9932420fe96cfa4
LABEL org.opencontainers.image.title="orders-api" \
      org.opencontainers.image.vendor="Triorex" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production
WORKDIR /app
# Owned by root and read-only to the runtime user: the app cannot modify its own code.
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
USER 65532:65532
EXPOSE 8080
# For docker run and Compose; Kubernetes uses the liveness and readiness probes in deploy/k8s.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--permission", "--allow-fs-read=/app/", "--allow-net", "--disallow-code-generation-from-strings", "src/server.js"]

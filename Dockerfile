# orders-api: multi-stage build on Chainguard (Wolfi) images.
# Builder has npm and a shell; the runtime runs only node as nonroot (65532) with Node's permission
# model: it can read /app and use the network, but cannot write files, spawn processes, start
# workers, load native addons or eval strings.
# Bases are pinned by digest; Dependabot (docker) updates them.

FROM cgr.dev/chainguard/node:latest-dev@sha256:c50cc3b01363d48e078a253ae4d5cb7318bacc03d61506b77f2dd98f6543f8fe AS builder
WORKDIR /app
COPY --chown=65532:65532 package.json package-lock.json .npmrc ./
# npm ci installs exactly the lockfile (integrity hashes checked); .npmrc disables install scripts.
RUN npm ci --omit=dev --no-audit --ignore-scripts && npm cache clean --force

FROM cgr.dev/chainguard/node:latest@sha256:af96c952fbc36cde8979dadfeb505691a1e214650128dd895a360192c168a719
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
ENTRYPOINT ["node", "--permission", "--allow-fs-read=/app/", "--allow-net", "--disallow-code-generation-from-strings", "src/server.js"]

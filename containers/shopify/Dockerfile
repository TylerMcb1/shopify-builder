ARG BASE_IMAGE=shopify-builder/base:local
FROM ${BASE_IMAGE}

WORKDIR /app
COPY package.json package-lock.json ./
# Shopify CLI is pinned in package.json/package-lock.json and never updates itself.
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src

# Non-interactive, no telemetry, no update checks; caches live on tmpfs (/tmp) because the root fs is read-only.
ENV CI=1 \
    SHOPIFY_CLI_NO_ANALYTICS=1 \
    SHOPIFY_CLI_ENV=production \
    XDG_CONFIG_HOME=/tmp/.config \
    XDG_CACHE_HOME=/tmp/.cache \
    XDG_DATA_HOME=/tmp/.local/share \
    PATH=/app/node_modules/.bin:$PATH

USER 10001:10001
# One command per container: `docker run -i --rm shopify-builder/shopify theme list --json ...`
# Credential arrives via the encrypted handoff on stdin (SHOPIFY_HANDOFF=none for Theme Check).
ENTRYPOINT ["node", "/app/src/entrypoint.mjs"]

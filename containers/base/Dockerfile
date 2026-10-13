# Shared slim base for the agent, Shopify and Anthropic gateway images.
# Pin by digest for releases: --build-arg NODE_IMAGE=node:22.12.0-bookworm-slim@sha256:<digest>
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

# Explicit non-root user. Child images never switch back to root at runtime.
RUN groupadd --gid 10001 builder \
 && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin builder \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/local/bin/yarn /usr/local/bin/yarnpkg

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    HOME=/tmp

LABEL org.opencontainers.image.title="shopify-builder-base"

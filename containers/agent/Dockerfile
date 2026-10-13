ARG BASE_IMAGE=shopify-builder/base:local
FROM ${BASE_IMAGE}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
# Application policy files are read-only inside the image (README 6.2).
COPY policy /app/policy

# No credentials: Claude Code talks to the gateway with a placeholder key.
# Non-essential traffic and auto-updates are disabled.
ENV ANTHROPIC_BASE_URL=http://anthropic-gateway:8080 \
    ANTHROPIC_API_KEY=placeholder-not-a-real-key \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    DISABLE_TELEMETRY=1 \
    DISABLE_ERROR_REPORTING=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/agent-state/config \
    WORKSPACE_DIR=/workspace

# /workspace and /agent-state are bind-mounted by the host at runtime.
WORKDIR /workspace
USER 10001:10001
# Host talks to the runner over stdin/stdout (line-delimited JSON): run with `docker run -i`.
ENTRYPOINT ["node", "/app/src/runner.mjs"]

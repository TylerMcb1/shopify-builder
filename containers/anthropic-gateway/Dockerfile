ARG BASE_IMAGE=shopify-builder/base:local
FROM ${BASE_IMAGE}

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src

USER 10001:10001
EXPOSE 8080
# Secret handoff (README 6.5) needs stdin: run with `docker run -i`.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "src/healthcheck.mjs"]
ENTRYPOINT ["node", "src/server.mjs"]

# Containers

Three images share `containers/base` (Node slim, non-root uid 10001):

| Image | Dir | Notes |
|---|---|---|
| Agent | `containers/agent` | Claude Agent SDK 0.3.296; no credentials; internal network only; stdin/stdout JSON protocol. Runner is a skeleton until Phase 3. |
| Shopify | `containers/shopify` | Shopify CLI 4.9.3; one command per container; entrypoint allowlists `theme list/pull/push/check` and receives the token via the sealed-box handoff (`SHOPIFY_HANDOFF=none` for Theme Check). |
| Anthropic gateway | `containers/anthropic-gateway` | Receives the key via handoff, forwards only `POST /v1/messages[/count_tokens]` to `api.anthropic.com`. |

All run read-only, non-root, `cap_drop: ALL`, `no-new-privileges`, with CPU/memory/pid limits.

- Build: `pnpm images:build` (builds base, then the three images). Release builds must pass `--build-arg NODE_IMAGE=...@sha256:<digest>` and record the resulting image digests in the tool manifest.
- `containers/compose.yaml` is a dev/validation reference only. In production the Docker adapter starts containers with equivalent arguments (no compose at runtime).
- Tests (no Docker needed): `npm ci` in `containers/anthropic-gateway` and `containers/shopify`, then `npm run containers:test`.

Not yet verified: image builds and network isolation, because Docker was unavailable in the authoring environment.

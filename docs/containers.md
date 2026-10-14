# Containers

Three images share `containers/base` (Node slim, non-root uid 10001):

| Image | Dir | Notes |
|---|---|---|
| Agent | `containers/agent` | Claude Agent SDK 0.3.296; no credentials; internal network only; stdin/stdout JSON protocol. The runner enforces the tool allowlist, sensitive-file approval, repair limit, and step timeout. |
| Shopify | `containers/shopify` | Shopify CLI 4.9.3; one command per container; entrypoint allowlists `theme list/pull/push/check` and receives the token via the sealed-box handoff (`SHOPIFY_HANDOFF=none` for Theme Check). |
| Anthropic gateway | `containers/anthropic-gateway` | Receives the key via handoff, forwards only `POST /v1/messages[/count_tokens]` to `api.anthropic.com`. |

All run read-only, non-root, `cap_drop: ALL`, `no-new-privileges`, with CPU/memory/pid limits.

- Build: `pnpm images:build` (builds base, then the three images). Release builds must pass `--build-arg NODE_IMAGE=...@sha256:<digest>` and record the resulting image digests in the tool manifest.
- `containers/compose.yaml` is a dev/validation reference only. In production the Docker adapter starts containers with equivalent arguments (no compose at runtime).
- Tests (no Docker needed): `npm ci` in `containers/anthropic-gateway` and `containers/shopify`, then `npm run containers:test`.

## Host: theme pull (`packages/host`)

Backend only (README 6.1, 6.3, 11, 14.1). `createShopifyReadService(...)` exposes:

- `listThemes()`: runs `theme list --json` in a one-shot Shopify container and validates the output with Zod.
- `pullTheme(themeId)`: resolves the ID against a fresh theme list, mounts a fresh empty `inbox/` at `/inbox`, runs `theme pull --theme <id> --path /inbox`, runs file intake, records a `sync` commit, swaps the accepted files into `canonical/` in one step, and removes `inbox/`. It returns the accepted, sensitive, and rejected files plus the sync result.

The `sync` commit (README 12.3) uses the bundled Dugite Git with the 12.6 hardening and a fully controlled environment. It goes on the `shopify` branch of the bare `history.git/`, is built with a temporary index from the files that passed intake, and is tagged `sync/<source-theme-id>/<n>`. No commit is made if the pulled tree matches the branch tip. If the commit fails, `canonical/` is left untouched.

The Theme Access password is requested from `getThemeToken()` only when the container offers its one-time public key. It is sealed to that key and written to stdin. The container entrypoint additionally limits `theme pull` to a numeric `--theme` and `--path /inbox`, and refuses `--password` and `--environment`.

- Tests: `npm install` in `packages/host` (plus `npm ci` in `containers/shopify`), then `npm run host:test`. These use fake Docker and Shopify CLI fixtures that run the real container entrypoint and handoff, with no Docker or network needed.
- Real image + store (opt-in): `SHOPIFY_STORE=x.myshopify.com SHOPIFY_THEME_TOKEN=... npm run host:test:docker`.
- Not yet built: SQLite store records, credential prompts, and the conversation screen.

## Host: change sessions

`createAgentSession` speaks the runner protocol over stdin and stdout. It copies `canonical/` into `sessions/<id>/workspace`, mounts only that directory and `agent-state/`, and validates every runner line. Sensitive-file descriptions come from `containers/agent/policy/sensitive-descriptions.json`, not from the model. A malformed line, a step timeout, or an idle timeout ends the session. Tests spawn the runner with a stand-in for Claude, not the SDK.

Not yet verified: image builds and network isolation, because Docker was unavailable in the authoring environment.

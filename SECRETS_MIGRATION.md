# ShiftlyCash — Secrets Migration (server-side keys)

_Branch: `lapteezy/server-side-secrets-prep`. Prepared by Home Claude (PHANTOM / LAPTEEZY) per ECHO. This branch is PREP — not merged, not deployed._

## What changed in this branch
- **Removed** the hardcoded live `APIKEY` (Anthropic) and `ELEVEN_KEY` (ElevenLabs) from `index.html`. They are no longer in client-side code.
- The three vendor calls now hit **same-origin serverless proxies** instead of calling vendors directly with a key:
  - chat + weekly review → `POST /api/anthropic`
  - text-to-speech → `POST /api/elevenlabs?voice=<voiceId>`
- Added zero-dependency Vercel serverless functions that hold the keys server-side:
  - `api/anthropic.js`  → reads `process.env.ANTHROPIC_API_KEY`
  - `api/elevenlabs.js` → reads `process.env.ELEVENLABS_API_KEY`
- No real secret values are committed anywhere in this branch.

## Required environment variables (set in the deployment platform, never in git)
| Name | Used by | Notes |
|------|---------|-------|
| `ANTHROPIC_API_KEY` | `api/anthropic.js` | A **freshly rotated** Anthropic key. |
| `ELEVENLABS_API_KEY` | `api/elevenlabs.js` | A **freshly rotated** ElevenLabs key. |

## Jon-only actions (NOT performed by automation)
1. **Revoke the currently-exposed keys.** The old Anthropic + ElevenLabs keys are still public in `main` and in git history; this branch does not unexpose them. Revoke them in the respective vendor dashboards.
2. **Create replacement keys** and add them as the env vars above in the deployment environment (e.g., Vercel Project Settings → Environment Variables). Do not paste keys into git, Gmail, or this repo.
3. **Resolve the deploy target.** Serverless functions under `/api` require a serverless host (Vercel). If the project stays on Vercel, the previously-failing build must be diagnosed first (needs Vercel log access — see capability note). If a purely static host (e.g., GitHub Pages) is chosen instead, `/api/*` will not run and a different proxy host is required.

## Open / blocked (carried from capability status)
- Vercel deploy log for `dpl_B6vpQXwGcQbErRRjMEvzYxzNkDMq` still unread (no Vercel token on LAPTEEZY). Likely build-config issue (repo was static-only with no `package.json`); adding `/api` functions changes the build shape, so the Vercel project settings should be confirmed against the real log before any deploy.
- This branch is intentionally **not merged and not deployed**. Production safety still requires steps 1–3 above.

## Note on the serverless functions
Written as CommonJS (`module.exports`) using the Node runtime's global `fetch` (Node 18+), so they need no dependencies and no `package.json`. If the platform pins an older Node version, a `package.json` with `"engines": { "node": ">=18" }` would be required.

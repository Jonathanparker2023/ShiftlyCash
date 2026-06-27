# Bashflow

Next.js App Router scaffold for the Bashflow rebuild. This step only covers Supabase magic-link auth and the protected signed-in landing page.

## Environment

Copy `.env.local.example` to `.env.local` and fill in the project values:

```text
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Server-only. Required only for one-time Firebase import scripts.
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Optional until the Banking page is tested
PLAID_CLIENT_ID=your-plaid-client-id
PLAID_SECRET=your-plaid-secret
PLAID_ENV=sandbox
PLAID_PRODUCTS=transactions
PLAID_COUNTRY_CODES=US
PLAID_ACCESS_TOKEN_ENCRYPTION_KEY=generate-a-long-random-server-only-secret
```

In Supabase Auth URL configuration, allow:

- `http://localhost:3000/**`
- the production Render URL once it exists

For the PKCE magic-link confirmation route, the Supabase email template should point to:

```html
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

## Run

```powershell
npm run dev
```

Then open `http://localhost:3000`.

## Auth Flow

- `/login` sends a Supabase magic link with `signInWithOtp`.
- `/auth/confirm` exchanges `token_hash` for a server-side cookie session.
- `src/proxy.ts` refreshes Supabase auth cookies for non-static routes.
- `src/app/(protected)/layout.tsx` revalidates the user before rendering protected routes.
- `/auth/logout` signs out and redirects to `/login`.

The database migration already includes `handle_new_auth_user`, which calls `bootstrap_user_defaults` on first Supabase signup. The signed-in landing page checks for the profile, settings, and default template rows and attempts the same bootstrap RPC if any are missing.

## Banking / Plaid

The `/banking` route renders without Plaid credentials and shows a missing-config state. To test Plaid sandbox, add the `PLAID_*` env vars above, push migration `202605040015_plaid_server_functions.sql`, restart the dev server, then connect a sandbox institution from `/banking`.

`PLAID_ACCESS_TOKEN_ENCRYPTION_KEY` is server-only. Use a long random value and do not rotate it unless you are ready to reconnect Plaid items, because existing encrypted access tokens depend on it.

## Firebase Import

Legacy Firebase history comes in through a one-time script:

```powershell
npm run import:firebase -- --file "C:\Users\jay1p\Downloads\shiftly-export.json" --dry-run --report ".\reports\firebase-dry-run.json"
```

Apply mode requires `SUPABASE_SERVICE_ROLE_KEY` and an explicit Supabase user:

```powershell
npm run import:firebase -- --file "C:\Users\jay1p\Downloads\shiftly-export.json" --apply --user-email "you@example.com"
```

Read [docs/firebase-import.md](docs/firebase-import.md) before applying. The script writes a local source backup first and reports any ambiguous rows instead of silently dropping them.

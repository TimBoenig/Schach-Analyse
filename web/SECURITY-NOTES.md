# Security notes (web app)

- `vercel.json` sets the response headers: a strict Content-Security-Policy (own origin, Supabase,
  chess.com and Lichess APIs only; `wasm-unsafe-eval` is needed for the Caissa engine, inline styles
  for Preact style attributes), HSTS, nosniff, `X-Frame-Options: DENY`, Referrer-Policy, Permissions-Policy
  (microphone only for the video studio) and COOP. When a new external host is called, add it to `connect-src`.
- Data access is protected by row level security on `sync_records` (own rows only). The migration
  `20261123_harden_sync_records_grants.sql` additionally removes anon access and TRUNCATE rights.
- The Supabase publishable key in the bundle is public by design; never ship a service-role key.
- No `innerHTML` / `dangerouslySetInnerHTML` / `eval` is used in `src/`; external links use `rel="noopener"`.
- Open items for the owner: enable leaked-password protection in the Supabase dashboard (Auth → Providers → Email),
  check that the Site URL / Redirect URLs list only the production domains.

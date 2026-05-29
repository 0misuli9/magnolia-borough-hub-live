# Deployment Checklist

## Before Deploy

- Confirm `.env.local` is not committed.
- Confirm Vercel has env vars by name only:
  - `OPENAI_API_KEY`
  - `OPENAI_MODEL`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `AUDIT_SYSTEM_ACTOR_ID`
  - optional `STAFF_ALLOWED_ROLES`
  - optional `STAFF_REQUIRE_MFA`
- Keep `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` backend-only.
- Run `supabase/migrations/20260528120000_municipal_operations_hardening.sql` in Supabase.
- Run `supabase/migrations/20260529103000_request_photos.sql` in Supabase before enabling resident photo uploads. Confirm the `request-photos` Storage bucket is private.
- Create or verify Supabase Auth staff users with staff role metadata.
- Verify RLS policies are present.
- Confirm staff accounts are individual whenever possible; shared testing accounts reduce audit value.
- Confirm final borough-approved wording for privacy, public-records, emergency, and accessibility notices before broad public launch.

## Local Checks

```powershell
Get-ChildItem api -Filter *.js | ForEach-Object { node --check $_.FullName }
npm test
```

For the inline script in `index.html`, use the command documented in `TEST_PLAN.md`.

Also run:

```powershell
rg -n "onclick=|onkeydown=|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|ADMIN_SECRET|x-admin-secret" index.html
```

Expected: no matches.

## Deploy

```powershell
git add README.md index.html api supabase vercel.json SECURITY.md DEPLOYMENT_CHECKLIST.md TEST_PLAN.md SUPABASE_SCHEMA.md
git commit -m "feat: triage scoring engine, resident photo upload, staff request detail drawer"
git push origin main
```

## After Deploy

- Submit a request in one browser and confirm staff can see it in another.
- Post an announcement, refresh, and confirm it persists.
- Confirm staff top navigation leaves the dashboard and opens the correct section.
- Confirm protected APIs reject missing or invalid staff tokens.
- Confirm browser network payloads do not include backend-only secrets.
- Test resident mobile at 360px and 390px: task cards route correctly, chat is readable, inputs do not zoom, and there is no horizontal whitespace.
- Confirm public tracking lookup shows the status timeline and does not expose internal notes.
- Confirm resident landing has no duplicate hero/stat/card navigation: hero only starts the card layer, stats are informational, and cards route to distinct sections.
- Confirm Staff Dashboard audit rows use plain-English event names and do not show raw response IDs or raw JSON metadata.
- Submit a resident report with photos and confirm photos do not appear in public tracking lookup.
- Sign in as staff, open the request detail drawer, and confirm photos load through signed URLs, triage factors render, internal notes save, and audit events do not include note text.
- Confirm Service Requests sorted by Most Urgent pins manual `urgent` first and then sorts by computed triage score.

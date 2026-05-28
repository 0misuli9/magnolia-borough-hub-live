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
- Create or verify Supabase Auth staff users with staff role metadata.
- Verify RLS policies are present.

## Local Checks

```powershell
Get-ChildItem api -Filter *.js | ForEach-Object { node --check $_.FullName }
npm test
```

For the inline script in `index.html`, use the command documented in `TEST_PLAN.md`.

## Deploy

```powershell
git add README.md index.html api supabase vercel.json SECURITY.md DEPLOYMENT_CHECKLIST.md TEST_PLAN.md SUPABASE_SCHEMA.md
git commit -m "fix: persist municipal workflows and harden staff operations"
git push origin main
```

## After Deploy

- Submit a request in one browser and confirm staff can see it in another.
- Post an announcement, refresh, and confirm it persists.
- Confirm staff top navigation leaves the dashboard and opens the correct section.
- Confirm protected APIs reject missing or invalid staff tokens.
- Confirm browser network payloads do not include backend-only secrets.

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
  - optional `STAFF_REQUIRE_MFA` (leave unset or `false` until the runbook below is complete)
- Keep `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` backend-only.
- Run `supabase/migrations/20260528120000_municipal_operations_hardening.sql` in Supabase.
- Run `supabase/migrations/20260529103000_request_photos.sql` in Supabase before enabling resident photo uploads. Confirm the `request-photos` Storage bucket is private.
- Run `supabase/migrations/20260529113000_durable_rate_limits.sql` in Supabase before relying on production rate limiting.
- Run `supabase/migrations/20260531090000_staff_profiles_shape.sql` in Supabase.
- Run `supabase/migrations/20260531091000_is_staff_user_staff_profiles.sql` in Supabase.
- Run `supabase/migrations/20260531092000_audit_actor_nullable.sql` in Supabase.
- Run `supabase/migrations/20260531093000_request_soft_delete.sql` in Supabase.
- Keep the temporary `app_metadata` fallback in place until the staff-profile transition runbook is complete.
- Verify RLS policies are present.
- Confirm staff accounts are individual before enabling MFA enforcement.
- Confirm final borough-approved wording for privacy, public-records, emergency, and accessibility notices before broad public launch.

## Staff Profiles And MFA Transition Runbook

Do these only after the code is merged and deployed. The temporary fallback keeps the current staff login working during the transition.

1. Create individual staff accounts in Supabase Authentication, one per real staff user.
2. For each staff user, copy the Auth user UUID and insert a row into `public.staff_profiles` using the commented template in `20260531090000_staff_profiles_shape.sql`.
3. Each staff member enrolls TOTP MFA in the existing app flow.
4. Log in as a new individual account and confirm staff access. Watch logs: that account should not emit the `app_metadata_fallback` warning.
5. After every staff user works through `staff_profiles`, set `STAFF_REQUIRE_MFA=true` in Vercel and redeploy/restart. Confirm an `aal1` session receives `MFA_REQUIRED` and an `aal2` session works.
6. Deactivate the shared account by removing its staff `app_metadata` and keeping/no-adding a `staff_profiles` row for it.
7. Only after all individual + MFA logins are confirmed, run the follow-up code pass to remove the `app_metadata` fallback from `_staff-auth.js` and `public.is_staff_user()`.

Rollback: unset `STAFF_REQUIRE_MFA` to disable MFA enforcement. Because the fallback remains until step 7, the original staff login can continue as the safety path during transition.

## Local Checks

```powershell
Get-ChildItem api -Filter *.js | ForEach-Object { node --check $_.FullName }
npm test
```

Confirm the external frontend script parses:

```powershell
node --check app.js
```

Also run:

```powershell
rg -n "onclick=|onkeydown=|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|ADMIN_SECRET|x-admin-secret" index.html
```

Expected: no matches.

## Deploy

```powershell
git add README.md index.html api supabase vercel.json SECURITY.md DEPLOYMENT_CHECKLIST.md TEST_PLAN.md SUPABASE_SCHEMA.md
git commit -m "docs: staff_profiles transition, MFA enforcement, audit capture, records"
git push origin main
```

## After Deploy

- Submit a request in one browser and confirm staff can see it in another.
- Post an announcement, refresh, and confirm it persists.
- Confirm staff top navigation leaves the dashboard and opens the correct section.
- Confirm protected APIs reject missing or invalid staff tokens.
- Confirm `GET /api/requests-export` rejects anonymous requests and works with a valid staff token.
- Confirm `staff_profiles` fallback warnings appear for metadata-only staff and stop for profile-backed staff.
- Confirm browser network payloads do not include backend-only secrets.
- Test resident mobile at 360px and 390px: task cards route correctly, chat is readable, inputs do not zoom, and there is no horizontal whitespace.
- Confirm public tracking lookup shows the status timeline and does not expose internal notes.
- Confirm public tracking lookup accepts new long tracking codes and legacy 4-digit codes, and does not expose resident addresses.
- Confirm public announcements hide future `starts_at` and past `ends_at` records while staff can still manage them.
- Confirm rapid public lookup/chat/request-create calls receive durable `429` responses after the configured threshold.
- Confirm resident landing has no duplicate hero/stat/card navigation: hero only starts the card layer, stats are informational, and cards route to distinct sections.
- Confirm Staff Dashboard audit rows use plain-English event names and do not show raw response IDs or raw JSON metadata.
- Submit a resident report with photos and confirm photos do not appear in public tracking lookup.
- Sign in as staff, open the request detail drawer, and confirm photos load through signed URLs, triage factors render, internal notes save, and audit events do not include note text.
- Confirm Service Requests sorted by Most Urgent pins manual `urgent` first and then sorts by computed triage score.

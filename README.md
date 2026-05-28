# Magnolia Borough AI Community Hub

Vercel static frontend plus Vercel serverless APIs, OpenAI Responses API, Supabase Auth, and Supabase data tables.

The root `index.html` is the production entry. The nested `magnolia-site/magnolia-site/index.html` is an older snapshot and should only be used as reference.

## Architecture

- Browser renders `index.html`.
- Browser signs staff in with Supabase Auth using `/api/auth-config`.
- Browser sends staff Supabase access tokens to protected APIs with `Authorization: Bearer <token>`.
- Serverless APIs verify staff role with `api/_staff-auth.js`.
- Serverless APIs query Supabase with `SUPABASE_SERVICE_ROLE_KEY` and return sanitized JSON.
- Public request lookup uses `/api/requests?tracking_number=MGN-####`.
- Announcements and requests persist in Supabase, not browser-local arrays.
- Chat-created requests are persisted by `api/chat.js` with server-generated tracking numbers.

## Environment Variables

Use these names only. Do not commit real values.

```text
OPENAI_API_KEY
OPENAI_MODEL
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
AUDIT_SYSTEM_ACTOR_ID
SUPABASE_REQUESTS_TABLE
SUPABASE_ANNOUNCEMENTS_TABLE
STAFF_ALLOWED_ROLES
STAFF_REQUIRE_MFA
```

`SUPABASE_ANON_KEY` is public configuration for browser Auth. `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are backend-only secrets and must never be sent to the browser.

## Staff Auth

Create staff users in Supabase Auth. Add trusted `app_metadata`:

```json
{"role":"staff"}
```

or:

```json
{"roles":["staff"]}
```

Allowed roles default to `staff`, `admin`, and `owner`. Set `STAFF_REQUIRE_MFA=true` to require Supabase MFA assurance level `aal2`.

## Local Development

```powershell
npm install
npx vercel env pull .env.local
npx vercel dev
```

Open the local URL printed by Vercel, usually `http://localhost:3000`.

## Supabase Setup

Run the migration in `supabase/migrations/20260528120000_municipal_operations_hardening.sql` in the Supabase SQL editor. It adds operational columns, status normalization, RLS policies, indexes, and knowledge-base fields.

Required tables:

- `requests`
- `announcements`
- `audit_logs`
- `borough_knowledge`
- `staff_profiles` created by the migration

See `SUPABASE_SCHEMA.md` for details.

## Verification

Use `TEST_PLAN.md` for cross-browser persistence, announcement persistence, staff navigation, dashboard signal, and security checks.

# Magnolia Borough AI Community Hub

Vercel static frontend plus Vercel serverless APIs, OpenAI Responses API, Supabase Auth, and Supabase data tables.

The root `index.html` is the production entry. The nested `magnolia-site/magnolia-site/index.html` is an older snapshot and should only be used as reference.

## Architecture

- Browser renders `index.html`.
- Resident UX is task-first: Ask a Borough Question, Report a Problem, Check a Request, and See Borough Updates route residents into the correct workflow without requiring prompt-writing skill.
- Resident depth includes Departments & Contacts, Meetings & Calendar, and Forms & Public Records sections. Sections use config-backed content or explicit review-ready fallback text instead of blank pages.
- Mobile layout uses responsive task cards, dynamic viewport sizing for chat, 16px mobile form inputs, wrapped long records, and mobile-friendly staff audit cards.
- Browser signs staff in with Supabase Auth using `/api/auth-config`.
- Browser sends staff Supabase access tokens to protected APIs with `Authorization: Bearer <token>`.
- Serverless APIs verify staff role with `api/_staff-auth.js`.
- Serverless APIs query Supabase with `SUPABASE_SERVICE_ROLE_KEY` and return sanitized JSON.
- Public request lookup uses `/api/requests?tracking_number=MGN-7K9Q2M8P`. Existing legacy `MGN-####` tracking numbers remain valid.
- Announcements and requests persist in Supabase, not browser-local arrays.
- Chat-created requests are persisted by `api/chat.js` with server-generated tracking numbers.
- Resident status lookup returns a server-backed request summary and status timeline.
- `BOROUGH_CONFIG` in `index.html` centralizes Magnolia-specific identity, contact placeholders, service categories, department directory content, calendar notes, and forms/public-records resources as groundwork for future municipality templates. Server-side triage tuning lives in `config/borough.js`.
- Staff request queues include server-derived triage scoring so active requests sort by urgency, with manual `urgent` priority pinning above computed score.
- New request tracking numbers are crypto-random, non-enumerable codes using an unambiguous alphabet. Public lookup returns status-oriented request summaries and does not expose resident addresses or staff-only fields.
- Triage ranking is computed across the filtered active request set before pagination, with an O(n) duplicate index for similar reports.
- The resident report form supports up to 3 staff-visible photos. Browser code resizes raster images before upload; the server stores them in a private Supabase Storage bucket and returns signed URLs only to staff detail views.
- Staff can open a request detail drawer to review triage factors, photos, resident details, staff controls, internal notes, and an audit-backed timeline.
- Staff audit activity is displayed as human-readable events. Chat volume is counted as a metric; individual chat-turn audit rows are not shown in the staff activity table.

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

For controlled borough testing, use individual staff accounts where possible so audit logs are meaningful. The migration includes `staff_profiles`; a future hardening pass should make that table the single source of truth for staff role authorization after current staff rows are populated.

## Public-Sector UX Notes

- The interface is designed for controlled municipal review, not certified compliance.
- Accessibility work includes skip-to-main-content, visible focus states, labeled form controls, live regions for chat/status/toasts, reduced-motion support, and keyboard-operable task cards/stats.
- Final privacy, public-records, accessibility statement, and retention wording should be approved by the borough.

## Future Multi-Municipality Path

Do not fork the app per town. The intended path is:

1. Move `BOROUGH_CONFIG` into a versioned config module or tenant table.
2. Add `tenant_id` to operational tables.
3. Add tenant-scoped RLS policies.
4. Route by subdomain or path.
5. Maintain a separate approved knowledge base per municipality.

## Local Development

```powershell
npm install
npx vercel env pull .env.local
npx vercel dev
```

Open the local URL printed by Vercel, usually `http://localhost:3000`.

## Supabase Setup

Run the migration in `supabase/migrations/20260528120000_municipal_operations_hardening.sql` in the Supabase SQL editor. It adds operational columns, status normalization, RLS policies, indexes, and knowledge-base fields.

Run `supabase/migrations/20260529103000_request_photos.sql` before enabling photo uploads. It creates `public.request_photos`, enables RLS, and creates or verifies the private `request-photos` Storage bucket. The migration detects the `public.requests.id` type at runtime so the photo foreign key matches the deployed table.

Run `supabase/migrations/20260529113000_durable_rate_limits.sql` before relying on production rate limiting. It adds `public.rate_limits` and a `public.check_rate_limit` RPC used by chat, public lookup, and public request creation. This table-backed limiter is suitable for controlled borough volume; a larger multi-municipality rollout should move the limiter to a dedicated KV/edge service.

Required tables:

- `requests`
- `announcements`
- `audit_logs`
- `borough_knowledge`
- `staff_profiles` created by the migration
- `request_photos` created by the photo attachment migration

See `SUPABASE_SCHEMA.md` for details.

## Verification

Use `TEST_PLAN.md` for cross-browser persistence, announcement persistence, staff navigation, dashboard signal, and security checks.

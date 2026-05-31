# Security Notes

## Secrets

Never expose these values to the browser:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SECRET`

The browser may receive only Supabase public Auth configuration from `/api/auth-config`: `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Staff Authorization

Protected APIs require `Authorization: Bearer <Supabase access token>`.

`api/_staff-auth.js` verifies the token with Supabase. `public.staff_profiles` is the authoritative staff-role table for the transition, while Supabase Auth `app_metadata` remains a temporary fallback so the current borough review login is not locked out before staff profile rows are populated.

The RLS helper `public.is_staff_user()` mirrors this transition: active `staff_profiles` row OR the temporary `app_metadata` fallback. Remove the fallback only after the staff-profile runbook is complete and verified. Optional MFA enforcement is controlled by `STAFF_REQUIRE_MFA=true` and should remain off until all staff have enrolled.

Staff-only APIs:

- `GET /api/requests`
- `GET /api/requests?tracking_number=MGN-7K9Q2M8P&staff=1`
- `PATCH /api/requests`
- `GET /api/requests-export`
- `GET /api/announcements?staff=1`
- `POST/PATCH/DELETE /api/announcements`
- `GET /api/dashboard`

Public APIs:

- `GET /api/announcements`
- `GET /api/requests?tracking_number=MGN-7K9Q2M8P`
- `POST /api/requests`
- `POST /api/request-photos`
- `POST /api/chat`

## Database Access

The production pattern is server-enforced authorization:

1. Browser authenticates staff with Supabase Auth.
2. Browser calls a Vercel API with the access token.
3. API verifies staff role.
4. API uses the Supabase service role to query/write data.
5. API returns sanitized JSON.

Run the Supabase migration to enable RLS as defense-in-depth.

## Input Validation And XSS

APIs trim and limit user input lengths. The frontend normalizes and escapes request and announcement fields before rendering.

Do not render resident titles, descriptions, addresses, or announcement bodies with raw `innerHTML` unless escaped first.

The frontend no longer uses inline `onclick`/`onkeydown` handlers. Dynamic chat messages are rendered with DOM nodes and `textContent`. Some static templates still use `innerHTML`; user-generated fields in those templates must stay escaped with `escapeHtml`.

Staff audit display intentionally hides low-value plumbing. Raw OpenAI response IDs, debug-only metadata, and raw JSON should not be shown in the dashboard table. Chat turns may still be counted as an operational metric without exposing resident message content.

Tracking numbers generated after this hardening pass use a crypto-random 8-character suffix from an unambiguous uppercase alphabet. Legacy `MGN-####` numbers remain accepted for residents who already received them. Public lookup must never return resident address, internal notes, assignment, manual priority, private photo storage paths, or signed photo URLs.

Photo uploads are staff-visible only. The browser accepts JPEG, PNG, and WebP files, rejects SVG/non-raster files, and re-encodes images through canvas before upload to reduce size and strip EXIF/GPS metadata. The server accepts only resized JPEG data URLs, validates count and size, strips JPEG metadata again, and stores objects in the private `request-photos` Supabase Storage bucket. Staff access uses short-lived signed URLs from the server; public tracking lookup never returns photo URLs or internal notes.

The application script is self-hosted and `script-src` does not allow inline script. Inline CSS remains allowed for the current single-page UI; any user-generated text rendered into template HTML must continue to be escaped first.

## Audit Integrity

System/public actions write audit rows with `actor_id = null` unless `AUDIT_SYSTEM_ACTOR_ID` is explicitly configured. High-value audit write failures are logged and copied into `public.audit_write_failures` with sanitized payloads so they can be reviewed instead of disappearing silently.

High-value events include request creation, request status/priority/assignment changes, announcement creation/update/archive, staff sign-in if emitted, and request exports. Audit metadata must remain limited to tracking numbers, counts, status transitions, field names, and channel/source labels.

## Abuse Controls

`api/_http.js` uses a Supabase-backed durable limiter for chat, request creation, and public tracking lookup through `public.check_rate_limit`. If the limiter store is unavailable, requests fail open and log a warning so legitimate residents are not blocked by an infrastructure issue.

The Supabase-table limiter adds one database round trip per limited call and is appropriate for controlled borough volume. A high-scale or multi-municipality deployment should move this control to a dedicated KV or edge rate-limiting service such as Vercel KV or Upstash.

## Privacy

Do not log full resident descriptions, addresses, phone numbers, or emails in production logs. Audit metadata should capture operational facts such as source, category, status, and whether an address was present.

New request-detail events should stay sanitized: status transitions, priority transitions, assignment changed, note changed, and photo counts are acceptable. Internal-note content, resident message content, raw response IDs, and image data should not be written to audit metadata.

This portal is not for emergencies. Emergency UI and chat guidance should direct residents to call 911.

## Records And Retention

`GET /api/requests-export` is staff-only and streams filtered CSV for controlled records review. Exports are audited with row count and filters only. `public.requests.deleted_at` is the soft-delete marker; soft-deleted requests are hidden from public lookup and default staff queues but retained until a borough-approved retention process authorizes hard deletion.

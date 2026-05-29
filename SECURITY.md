# Security Notes

## Secrets

Never expose these values to the browser:

- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_SECRET`

The browser may receive only Supabase public Auth configuration from `/api/auth-config`: `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

## Staff Authorization

Protected APIs require `Authorization: Bearer <Supabase access token>`.

`api/_staff-auth.js` verifies the token with Supabase and accepts only trusted staff roles in `app_metadata`. Optional MFA enforcement is controlled by `STAFF_REQUIRE_MFA=true`.

Important current-state note: the database migration also creates `public.staff_profiles`, but current production authorization still uses Supabase Auth `app_metadata`. Before switching the source of truth to `staff_profiles`, populate the staff profile rows and test staff login in Supabase so the existing borough account is not locked out. The desired hardening direction is individual staff accounts, MFA required, and `staff_profiles` as the authoritative role table for both APIs and RLS.

Staff-only APIs:

- `GET /api/requests`
- `GET /api/requests?tracking_number=MGN-####&staff=1`
- `PATCH /api/requests`
- `GET /api/announcements?staff=1`
- `POST/PATCH/DELETE /api/announcements`
- `GET /api/dashboard`

Public APIs:

- `GET /api/announcements`
- `GET /api/requests?tracking_number=MGN-####`
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

Photo uploads are staff-visible only. The browser accepts JPEG, PNG, and WebP files, rejects SVG/non-raster files, and re-encodes images through canvas before upload to reduce size and strip EXIF/GPS metadata. The server accepts only resized JPEG data URLs, validates count and size, strips JPEG metadata again, and stores objects in the private `request-photos` Supabase Storage bucket. Staff access uses short-lived signed URLs from the server; public tracking lookup never returns photo URLs or internal notes.

The current CSP still permits inline script/style because `index.html` contains an inline application script and inline CSS. A future strict-CSP pass should move frontend JavaScript and CSS into external files or add nonces/hashes, then remove `script-src 'unsafe-inline'`.

## Abuse Controls

`api/_http.js` includes lightweight in-memory rate limiting for chat, request creation, and public tracking lookup. This is useful for basic protection on a warm serverless instance, but production should add durable edge or provider-level rate limiting.

For Vercel serverless production, durable rate limiting should be added with Vercel KV, Upstash, or a Supabase-backed bucket table. In-memory buckets are not enough for a public municipal launch because serverless instances are stateless.

## Privacy

Do not log full resident descriptions, addresses, phone numbers, or emails in production logs. Audit metadata should capture operational facts such as source, category, status, and whether an address was present.

New request-detail events should stay sanitized: status transitions, priority transitions, assignment changed, note changed, and photo counts are acceptable. Internal-note content, resident message content, raw response IDs, and image data should not be written to audit metadata.

This portal is not for emergencies. Emergency UI and chat guidance should direct residents to call 911.

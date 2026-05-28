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

Staff-only APIs:

- `GET /api/requests`
- `PATCH /api/requests`
- `GET /api/announcements?staff=1`
- `POST/PATCH/DELETE /api/announcements`
- `GET /api/dashboard`

Public APIs:

- `GET /api/announcements`
- `GET /api/requests?tracking_number=MGN-####`
- `POST /api/requests`
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

## Abuse Controls

`api/_http.js` includes lightweight in-memory rate limiting for chat, request creation, and public tracking lookup. This is useful for basic protection on a warm serverless instance, but production should add durable edge or provider-level rate limiting.

## Privacy

Do not log full resident descriptions, addresses, phone numbers, or emails in production logs. Audit metadata should capture operational facts such as source, category, status, and whether an address was present.

This portal is not for emergencies. Emergency UI and chat guidance should direct residents to call 911.

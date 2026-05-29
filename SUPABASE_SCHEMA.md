# Supabase Schema Notes

Run `supabase/migrations/20260528120000_municipal_operations_hardening.sql` before deploying the upgraded workflows.

## Requests

Expected table: `public.requests`

Important fields:

- `id`
- `tracking_number`
- `title`
- `description`
- `category`
- `address`
- `status`: `open`, `in_progress`, `resolved`, `closed`
- `priority`
- `assigned_to`
- `internal_notes`
- `source`: `public`, `chat`, or `staff`
- `created_at`
- `updated_at`

Legacy values are normalized:

- `pending` -> `open`
- `progress` -> `in_progress`

Public lookup happens through `/api/requests?tracking_number=MGN-####`; public browser clients should not list this table directly.

Triage is derived server-side at read time and is not stored in the table. Active `open` and `in_progress` requests receive a computed score, level, badges, and factor explanation using category urgency, age, SLA target, and simple duplicate heuristics. The existing `priority` field remains a manual staff override; `urgent` pins a request above computed triage order.

## Request Photos

Expected table after running `supabase/migrations/20260529103000_request_photos.sql`: `public.request_photos`

Important fields:

- `id`: UUID primary key
- `request_id`: foreign key to `public.requests(id)`; the migration detects the deployed requests primary-key type at runtime
- `storage_path`: private Supabase Storage object path
- `content_type`: currently `image/jpeg`
- `created_at`

Storage bucket:

- Bucket id/name: `request-photos`
- Public: `false`
- Allowed MIME type: `image/jpeg`
- Size limit: 1.25 MB per stored resized image

All photo objects are private. Residents upload photos immediately after creating a request, but staff access is mediated by the server through short-lived signed URLs in the request detail drawer. Public request lookup must not expose photos, storage paths, signed URLs, assignment, manual priority, or internal notes.

## Announcements

Expected table: `public.announcements`

Important fields:

- `id`
- `type`: `info`, `urgent`, `event`
- `title`
- `body`
- `status`: `active`, `draft`, `expired`, `archived`
- `starts_at`
- `ends_at`
- `created_at`
- `updated_at`

Public reads return active/current announcements. Staff reads use `/api/announcements?staff=1`.

## Audit Logs

Expected table: `public.audit_logs`

Important fields:

- `timestamp`
- `event_type`
- `actor_id`
- `related_record_id`
- `metadata`

The APIs write audit events for request creation/update, status changes, priority changes, assignment changes, internal note updates, photo attachments, announcement creation/update/archive, chat conversations, and chat-created requests.

Dashboard display filters the staff activity table to meaningful operational events such as request creation/update, request photo attachment, announcement changes, knowledge changes, and staff sign-in events if present. Individual `chat_conversation` rows are counted as chat volume metrics rather than displayed as repetitive audit activity. Audit metadata should stay sanitized: status transitions, changed field names, tracking numbers, and photo counts are acceptable; internal note text, resident message content, raw response IDs, and image data are not.

## Staff Profiles And Roles

The migration creates `public.staff_profiles` for future staff management. Current server authorization trusts Supabase Auth `app_metadata` roles:

```json
{"role":"staff"}
```

or:

```json
{"roles":["staff"]}
```

Recommended next hardening step: make `public.staff_profiles` the single source of truth for staff authorization after verified rows exist for every staff user. At that point, update both `api/_staff-auth.js` and `public.is_staff_user()` together so API authorization and RLS cannot drift.

## Borough Knowledge

The migration adds foundation fields to `public.borough_knowledge` if the table exists:

- `question`
- `answer`
- `topic`
- `tags`
- `jurisdiction`
- `authority_level`
- `source_url`
- `department_owner`
- `review_status`
- `active`
- `last_verified`
- `created_at`
- `updated_at`

Public answers should use approved active knowledge only. Draft and unapproved knowledge should stay staff-only.

## Records And Retention Foundation

Requests, announcements, and audit logs are persisted in Supabase and can be exported by staff APIs or SQL queries for controlled review. A formal municipal records-retention policy has not been encoded in schema yet. Future work should add retention metadata, soft-delete/archive fields where needed, and borough-approved export procedures.

## Future Tenant Fields

The current Magnolia build is single-municipality. If the platform expands to additional municipalities, add a `tenant_id` column to operational tables and tenant-scoped RLS policies before sharing infrastructure across towns.

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
- `deleted_at`: nullable soft-delete/archive marker for retained records

Legacy values are normalized:

- `pending` -> `open`
- `progress` -> `in_progress`

Public lookup happens through `/api/requests?tracking_number=MGN-7K9Q2M8P`; existing legacy `MGN-####` numbers remain valid. Public browser clients should not list this table directly.

Public lookup responses intentionally omit resident address, description, assignment, manual priority, internal notes, private photo paths, and signed URLs. Staff detail responses remain the operational surface for full records.

Requests with `deleted_at` set are retained for records purposes but hidden from public lookup and default staff queues. Staff exports may include soft-deleted records only when explicitly requested.

Triage is derived server-side at read time and is not stored in the table. Active `open` and `in_progress` requests receive a computed score, level, badges, and factor explanation using category urgency, age, SLA target, and simple duplicate heuristics. The existing `priority` field remains a manual staff override; `urgent` pins a request above computed triage order.

The staff "Most Urgent" queue ranks the filtered active set before pagination. Duplicate-volume scoring uses a single-pass map keyed by category and normalized address line, avoiding per-request scans.

## Rate Limits

Expected table after running `supabase/migrations/20260529113000_durable_rate_limits.sql`: `public.rate_limits`

Important fields:

- `key`: endpoint bucket and client IP
- `count`: requests within the current window
- `window_start`: start timestamp for the active rate-limit window

The migration also creates `public.check_rate_limit(p_key, p_limit, p_window_seconds)`, used by server APIs with the service role. The table has RLS enabled and no public policies; clients do not read it directly.

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

Expected table after running `supabase/migrations/20260531090000_staff_profiles_shape.sql`: `public.staff_profiles`

Important fields:

- `id`: UUID primary key referencing `auth.users(id)`
- `role`: staff role label, default `clerk`
- `active`: staff access flag
- `email`: optional operator-readable email
- `full_name`: optional operator-readable name
- `created_at`
- `updated_at`

Server APIs and the RLS helper `public.is_staff_user()` treat an active `staff_profiles` row as authoritative. During the controlled transition, Supabase Auth `app_metadata` remains a temporary fallback so the existing login is not locked out before profile rows and MFA enrollment are complete. Remove that fallback only after the deployment runbook confirms every staff user works through `staff_profiles`.

No migration in this repo inserts real staff rows. Operators must create Auth users and insert the matching UUIDs manually in Supabase.

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

Requests, announcements, audit logs, request photos, and audit write failures are persisted in Supabase for controlled review. `public.requests.deleted_at` is the soft-delete marker: application surfaces hide those records by default, but the records remain available to staff exports and database administrators. Hard deletion should be a deliberate manual database operation only after the borough approves the applicable retention window.

Staff can export request records as CSV through `GET /api/requests-export` with a valid staff token. Supported filters include `status`, `category`, `created_from`, `created_to`, `updated_from`, `updated_to`, `include_deleted=1`, and `include_internal_notes=1`. Internal notes are excluded unless explicitly requested. Each export writes a sanitized `requests_exported` audit event with row count and filters, never row contents.

Final OPRA/public-records retention windows, redaction rules, and release procedures require borough approval before broad operational use.

## Future Tenant Fields

The current Magnolia build is single-municipality. If the platform expands to additional municipalities, add a `tenant_id` column to operational tables and tenant-scoped RLS policies before sharing infrastructure across towns.

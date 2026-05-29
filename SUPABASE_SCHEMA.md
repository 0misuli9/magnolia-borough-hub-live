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

The APIs write audit events for request creation/update, announcement creation/update/archive, chat conversations, and chat-created requests.

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

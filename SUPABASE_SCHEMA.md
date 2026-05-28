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

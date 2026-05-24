# Magnolia Local Environment

This project uses Vercel serverless functions and Supabase. Keep secrets in local environment files and in Vercel project settings only.

## Required Environment Variables

Create a local `.env` file with these names:

```text
OPENAI_API_KEY=
OPENAI_MODEL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_ANON_KEY=
ADMIN_SECRET=
AUDIT_SYSTEM_ACTOR_ID=
```

Optional table overrides:

```text
SUPABASE_REQUESTS_TABLE=
SUPABASE_ANNOUNCEMENTS_TABLE=
```

Notes:

- Do not commit `.env` or any file containing real secrets.
- `SUPABASE_SERVICE_ROLE_KEY` is backend-only and must never appear in browser code.
- `SUPABASE_ANON_KEY` is public-safe and is used for browser auth and public RLS reads.
- `AUDIT_SYSTEM_ACTOR_ID` should be a UUID used for system-generated audit log entries.

## Vercel Project Link

The local `.vercel/project.json` file indicates this folder is linked to a Vercel project. To verify from your machine:

```powershell
vercel.cmd whoami
vercel.cmd project ls
vercel.cmd env ls
```

If the project link is stale or missing:

```powershell
vercel.cmd link
```

Choose the Magnolia project, then confirm `.vercel/project.json` is recreated.

## Local Dev

After `.env` is populated:

```powershell
vercel.cmd dev
```

Open the local URL that Vercel prints, usually:

```text
http://localhost:3000
```

Quick checks:

- Chat should call `/api/chat`.
- Staff login requires `SUPABASE_ANON_KEY` and Supabase email/password auth.
- Server-side request persistence and audit logging require `SUPABASE_SERVICE_ROLE_KEY`.

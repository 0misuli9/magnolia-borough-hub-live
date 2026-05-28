# Test Plan

## Automated Checks

API syntax:

```powershell
Get-ChildItem api -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Inline frontend script syntax:

```powershell
$html=[System.IO.File]::ReadAllText((Resolve-Path 'index.html'))
$match=[regex]::Match($html,'(?s)<script>\s*(.*?)\s*</script>')
$tmp=Join-Path $env:TEMP 'magnolia-index-inline.js'
[System.IO.File]::WriteAllText($tmp,$match.Groups[1].Value,[System.Text.UTF8Encoding]::new($false))
node --check $tmp
```

Project test script:

```powershell
npm test
```

Search checks:

```powershell
rg -n "OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|ADMIN_SECRET|x-admin-secret" index.html
rg -n "requests\.find|localStorage|sessionStorage" index.html api
rg -n "/api/requests|/api/announcements|/api/dashboard" index.html api
```

## Manual Smoke Tests

### Test 1 - Cross-Browser Public Request

1. Open public resident view in Firefox or a separate browser.
2. Submit a new service request through chat.
3. Copy the tracking number.
4. Open Chrome staff view.
5. Click Staff Dashboard, then Refresh.
6. Confirm open request count increases.
7. Click Service Requests.
8. Confirm request appears.
9. Sign out.
10. Search the same tracking number in public lookup.

Expected: request appears from the Supabase-backed API.

### Test 2 - Announcement Persistence

1. Sign in as staff.
2. Open Announcements.
3. Post a new announcement.
4. Confirm it appears in staff list.
5. Refresh the page.
6. Confirm it remains.
7. Open resident announcements in another browser.

Expected: announcement appears there too.

### Test 3 - Staff Navigation

1. Sign in as staff.
2. Click Staff Dashboard.
3. Confirm dashboard appears.
4. Click AI Assistant top nav.
5. Confirm assistant appears, not dashboard.
6. Click Announcements top nav.
7. Confirm staff announcement manager appears, not dashboard.
8. Click Service Requests top nav.
9. Confirm staff request queue appears, not dashboard.

Expected: every tab changes actual content.

### Test 4 - Dashboard Signal

1. Create request.
2. Create announcement.
3. Trigger chat interaction.
4. Refresh dashboard.

Expected: metrics and audit logs update.

### Test 5 - Security

1. Open browser developer tools.
2. Confirm no `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `ADMIN_SECRET` appears in JS or network payloads.
3. Attempt staff API without token.
4. Attempt staff API with invalid token.

Expected: protected APIs return 401 or 403.

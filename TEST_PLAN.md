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
rg -n "image/svg|image/jpeg|image/png|image/webp|request-photos" index.html api supabase
```

## Manual Smoke Tests

### Test 0 - Mobile Resident Experience

Run at 360px, 390px, 768px, 1024px, and desktop wide.

1. Open the resident view.
2. Tap Open Requests in the hero stats.
3. Confirm Service Requests opens and the lookup field is focused.
4. Tap Active Notices in the hero stats.
5. Confirm Announcements opens.
6. Ask a long assistant question and read the response.
7. Focus the chat input, lookup input, and form fields on a phone.
8. Scroll every resident and staff view horizontally.

Expected: stats route correctly, chat is readable without line-by-line scrolling, inputs do not trigger mobile zoom, and there is no sideways whitespace.

### Test 0A - Task Cards And Prompts

1. Click Start Here in the hero.
2. Confirm it scrolls to the resident action cards.
3. Click Ask a Borough Question.
4. Click Report a Problem.
5. Click Check a Request.
6. Click See Borough Updates.
7. Click Departments & Contacts.
8. Click Meetings & Calendar.
9. Click Forms & Public Records.
10. Click each starter prompt.

Expected: the hero is not a duplicate navigation row; each card opens its own workflow or section; starter prompts send to the assistant.

### Test 0B - Staff Audit Readability

1. Sign in as staff.
2. Open Staff Dashboard.
3. Review Recent Audit Logs.
4. Confirm event labels are plain English.
5. Confirm request records show tracking numbers when available.
6. Confirm no `resp_...` response IDs or raw JSON metadata appear.
7. Confirm mobile audit cards show the same humanized content.

Expected: chat turns are counted in metrics, not listed as repetitive audit rows; the activity table shows meaningful staff-facing events.

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

### Test 4A - Triage Queue

1. Sign in as staff.
2. Create or seed active requests in safety-relevant and lower-risk categories.
3. Open Service Requests with sort set to Most Urgent.
4. Confirm manual `urgent` priority appears first.
5. Confirm remaining active requests sort by triage score.
6. Confirm triage level, score, aging badges, and factor summary render with text labels.

Expected: the staff queue explains why a request is ranked and does not rely on color alone.

### Test 4B - Resident Photo Upload

1. Open Report a Problem as a resident.
2. Attach 1 to 3 JPEG, PNG, or WebP files.
3. Confirm thumbnails render and remove buttons work.
4. Try an SVG or non-image file.
5. Submit the request.

Expected: SVG/non-image files are rejected, valid images are resized before upload, the request receives a server tracking number, and the confirmation notes the photo count. Photos are not visible in public lookup.

### Test 4C - Staff Request Detail Drawer

1. Sign in as staff.
2. Click a request card or press Enter/Space on a focused card.
3. Confirm the drawer opens with details, triage, photos, controls, and timeline.
4. Change status, manual priority, assignment, and internal notes.
5. Save.
6. Refresh the public tracking lookup for the same request.

Expected: the drawer traps focus and closes with Escape, queue/dashboard refresh after save, clean audit events are written, and internal notes never appear publicly.

### Test 5 - Security

1. Open browser developer tools.
2. Confirm no `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, or `ADMIN_SECRET` appears in JS or network payloads.
3. Attempt staff API without token.
4. Attempt staff API with invalid token.
5. Confirm request photo signed URLs appear only in authenticated staff drawer responses.

Expected: protected APIs return 401 or 403.

### Test 6 - Accessibility Pass

1. Use keyboard only from page load.
2. Confirm the skip link appears and jumps to main content.
3. Tab through task cards, hero stat buttons, nav tabs, chat input, lookup, staff login, and staff controls.
4. Confirm visible focus indicators.
5. Open and close the staff login modal with keyboard controls.
6. Confirm chat/status/toast updates are announced by live regions in screen-reader testing.

Expected: primary public and staff flows are keyboard-operable and screen-reader conscious. This is a review target, not a certification claim.

import { getServiceSupabaseClient } from "./_audit.js";
import { requireStaff } from "./_staff-auth.js";
import { getMethodNotAllowed, normalizeCategory, normalizeStatus, sendJson } from "./_http.js";

const REQUESTS_TABLE = process.env.SUPABASE_REQUESTS_TABLE || "requests";
const ANNOUNCEMENTS_TABLE = process.env.SUPABASE_ANNOUNCEMENTS_TABLE || "announcements";
const STAFF_AUDIT_EVENTS = [
  "request_created",
  "request_created_from_chat",
  "request_updated",
  "announcement_created",
  "announcement_updated",
  "announcement_archived",
  "knowledge_created",
  "knowledge_updated",
  "knowledge_archived",
  "staff_sign_in",
];

function normalizeRequest(record) {
  return {
    id: record.id || null,
    tracking_number: record.tracking_number || null,
    title: record.title || "",
    description: record.description || "",
    category: normalizeCategory(record.category),
    address: record.address || "",
    status: normalizeStatus(record.status),
    priority: record.priority || "normal",
    source: record.source || "public",
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

function normalizeAnnouncement(record) {
  return {
    id: record.id || null,
    type: record.type || "info",
    title: record.title || "",
    body: record.body || "",
    status: record.status || "active",
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

function getTopCategory(requests) {
  const counts = {};

  for (const request of requests) {
    const category = normalizeCategory(request.category);
    counts[category] = (counts[category] || 0) + 1;
  }

  return Object.keys(counts).sort((left, right) => counts[right] - counts[left])[0] || "-";
}

function countByStatus(requests, status) {
  return requests.filter((request) => normalizeStatus(request.status) === status).length;
}

function countResolvedSince(requests, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return requests.filter((request) => {
    if (normalizeStatus(request.status) !== "resolved") {
      return false;
    }

    const timestamp = new Date(request.updated_at || request.created_at || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  }).length;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return getMethodNotAllowed(res, ["GET"]);
  }

  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  try {
    const supabase = getServiceSupabaseClient();

    const [
      requestsResult,
      announcementsResult,
      auditResult,
      conversationsResult,
    ] = await Promise.all([
      supabase
        .from(REQUESTS_TABLE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(250),
      supabase
        .from(ANNOUNCEMENTS_TABLE)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("audit_logs")
        .select("timestamp,event_type,related_record_id,metadata")
        .in("event_type", STAFF_AUDIT_EVENTS)
        .order("timestamp", { ascending: false })
        .limit(10),
      supabase
        .from("audit_logs")
        .select("*", { count: "exact", head: true })
        .eq("event_type", "chat_conversation"),
    ]);

    if (requestsResult.error) throw requestsResult.error;
    if (announcementsResult.error) throw announcementsResult.error;
    if (auditResult.error) throw auditResult.error;
    if (conversationsResult.error) throw conversationsResult.error;

    const requests = (Array.isArray(requestsResult.data) ? requestsResult.data : []).map(normalizeRequest);
    const announcements = (Array.isArray(announcementsResult.data) ? announcementsResult.data : []).map(normalizeAnnouncement);
    const auditRows = Array.isArray(auditResult.data) ? auditResult.data : [];
    const activeAnnouncements = announcements.filter((announcement) => announcement.status !== "archived");

    return sendJson(res, 200, {
      success: true,
      generated_at: new Date().toISOString(),
      metrics: {
        conversations: conversationsResult.count || 0,
        open_requests: countByStatus(requests, "open"),
        in_progress_requests: countByStatus(requests, "in_progress"),
        resolved_requests: countByStatus(requests, "resolved"),
        resolved_last_7_days: countResolvedSince(requests, 7),
        resolved_last_30_days: countResolvedSince(requests, 30),
        closed_requests: countByStatus(requests, "closed"),
        recent_activity: auditRows.length,
        top_category: getTopCategory(requests),
      },
      latest_requests: requests.slice(0, 5),
      latest_announcements: activeAnnouncements.slice(0, 3),
      latest_audit_logs: auditRows,
      staff: {
        id: staff.user.id,
        email: staff.user.email,
        roles: staff.roles,
      },
    });
  } catch (error) {
    console.error("[api/dashboard] Failed to load dashboard", {
      message: error instanceof Error ? error.message : "Unknown dashboard error.",
    });

    return sendJson(res, 500, {
      success: false,
      error: "DASHBOARD_FAILED",
      message: "Unable to load staff dashboard.",
      details: error.details || error.message || "Unknown error.",
    });
  }
}

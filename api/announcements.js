import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";
import { requireStaff } from "./_staff-auth.js";
import {
  clampText,
  getMethodNotAllowed,
  getQueryParam,
  normalizeAnnouncementStatus,
  normalizeAnnouncementType,
  normalizeBody,
  sendJson,
} from "./_http.js";

const ANNOUNCEMENTS_TABLE = process.env.SUPABASE_ANNOUNCEMENTS_TABLE || "announcements";

function normalizeAnnouncementRecord(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    type: normalizeAnnouncementType(record.type),
    title: record.title || "",
    body: record.body || "",
    status: normalizeAnnouncementStatus(record.status),
    starts_at: record.starts_at || null,
    ends_at: record.ends_at || null,
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

function safeAnnouncementShape(body) {
  if (!body || typeof body !== "object") {
    return { bodyType: typeof body };
  }

  return {
    bodyKeys: Object.keys(body),
    hasTitle: Boolean(String(body.title || "").trim()),
    hasBody: Boolean(String(body.body || "").trim()),
    type: String(body.type || "").trim() || null,
    status: String(body.status || "").trim() || null,
  };
}

function buildAnnouncementRecord(body) {
  return {
    type: normalizeAnnouncementType(body.type),
    title: clampText(body.title, 120),
    body: clampText(body.body || body.message, 2000),
    status: normalizeAnnouncementStatus(body.status),
    starts_at: body.starts_at || null,
    ends_at: body.ends_at || null,
    created_at: new Date().toISOString(),
  };
}

function buildPatchRecord(body) {
  const patch = {
    updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(body, "type")) {
    patch.type = normalizeAnnouncementType(body.type);
  }

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    patch.title = clampText(body.title, 120);
  }

  if (Object.prototype.hasOwnProperty.call(body, "body") || Object.prototype.hasOwnProperty.call(body, "message")) {
    patch.body = clampText(body.body || body.message, 2000);
  }

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    patch.status = normalizeAnnouncementStatus(body.status);
  }

  if (Object.prototype.hasOwnProperty.call(body, "starts_at")) {
    patch.starts_at = body.starts_at || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "ends_at")) {
    patch.ends_at = body.ends_at || null;
  }

  return patch;
}

async function writeAudit(eventType, actorId, recordId, metadata = {}) {
  try {
    await logAuditEvent(getServiceSupabaseClient(), {
      eventType,
      actorId,
      recordId,
      metadata,
    });
  } catch (auditError) {
    console.error("[api/announcements] Failed to write audit log", {
      eventType,
      recordId,
      error: auditError instanceof Error ? auditError.message : "Unknown audit error.",
    });
  }
}

async function handleGet(req, res) {
  const staffMode = getQueryParam(req, "staff") === "1";
  let staff = null;

  if (staffMode) {
    staff = await requireStaff(req, res);
    if (!staff) {
      return;
    }
  }

  const supabase = getServiceSupabaseClient();
  let query = supabase
    .from(ANNOUNCEMENTS_TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (!staffMode) {
    query = query.or("status.is.null,status.eq.active");
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return sendJson(res, 200, {
    success: true,
    announcements: (Array.isArray(data) ? data : []).map(normalizeAnnouncementRecord),
  });
}

async function handlePost(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const body = normalizeBody(req.body);

  if (!body) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON",
      message: "Invalid JSON body.",
    });
  }

  const insertPayload = buildAnnouncementRecord(body);

  if (!insertPayload.title) {
    return sendJson(res, 400, {
      success: false,
      error: "TITLE_REQUIRED",
      message: "An announcement title is required.",
    });
  }

  if (!insertPayload.body) {
    return sendJson(res, 400, {
      success: false,
      error: "BODY_REQUIRED",
      message: "An announcement body is required.",
    });
  }

  console.log("[api/announcements] Creating announcement", {
    type: insertPayload.type,
    status: insertPayload.status,
    titleLength: insertPayload.title.length,
    bodyLength: insertPayload.body.length,
  });

  const { data, error } = await getServiceSupabaseClient()
    .from(ANNOUNCEMENTS_TABLE)
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const announcement = normalizeAnnouncementRecord(data);
  await writeAudit("announcement_created", staff.user.id, announcement.id, {
    type: announcement.type,
    status: announcement.status,
  });

  return sendJson(res, 201, {
    success: true,
    announcement,
  });
}

async function handlePatch(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const body = normalizeBody(req.body);
  const id = clampText(getQueryParam(req, "id") || body?.id, 80);

  if (!body) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON",
      message: "Invalid JSON body.",
    });
  }

  if (!id) {
    return sendJson(res, 400, {
      success: false,
      error: "ANNOUNCEMENT_ID_REQUIRED",
      message: "Provide announcement id.",
    });
  }

  const patch = buildPatchRecord(body);
  const changedFields = Object.keys(patch).filter((key) => key !== "updated_at");

  if (!changedFields.length) {
    return sendJson(res, 400, {
      success: false,
      error: "NO_PATCH_FIELDS",
      message: "No supported update fields were provided.",
    });
  }

  const { data, error } = await getServiceSupabaseClient()
    .from(ANNOUNCEMENTS_TABLE)
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const announcement = normalizeAnnouncementRecord(data);
  await writeAudit("announcement_updated", staff.user.id, announcement.id, {
    changedFields,
    status: announcement.status,
  });

  return sendJson(res, 200, {
    success: true,
    announcement,
  });
}

async function handleDelete(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const id = clampText(getQueryParam(req, "id"), 80);

  if (!id) {
    return sendJson(res, 400, {
      success: false,
      error: "ANNOUNCEMENT_ID_REQUIRED",
      message: "Provide announcement id.",
    });
  }

  const { data, error } = await getServiceSupabaseClient()
    .from(ANNOUNCEMENTS_TABLE)
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const announcement = normalizeAnnouncementRecord(data);
  await writeAudit("announcement_archived", staff.user.id, announcement.id, {
    status: announcement.status,
  });

  return sendJson(res, 200, {
    success: true,
    announcement,
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      return await handleGet(req, res);
    }

    if (req.method === "POST") {
      return await handlePost(req, res);
    }

    if (req.method === "PATCH") {
      return await handlePatch(req, res);
    }

    if (req.method === "DELETE") {
      return await handleDelete(req, res);
    }

    return getMethodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
  } catch (error) {
    console.error("[api/announcements] Request failed", {
      method: req.method,
      body: safeAnnouncementShape(normalizeBody(req.body)),
      message: error instanceof Error ? error.message : "Unknown error.",
    });

    return sendJson(res, error.status || 500, {
      success: false,
      error: "ANNOUNCEMENTS_API_FAILED",
      message: "Announcement operation failed.",
      details: error.details || error.message || "Unknown error.",
    });
  }
}

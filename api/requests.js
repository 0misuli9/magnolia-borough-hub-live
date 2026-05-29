import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";
import { getAuthenticatedStaff, requireStaff } from "./_staff-auth.js";
import { buildTriageContext } from "./_triage.js";
import {
  createRequestRecord,
  normalizePublicRequestRecord,
  normalizeRequestRecord,
  REQUESTS_TABLE,
} from "./_requests-core.js";
import {
  checkRateLimit,
  clampText,
  getIntQuery,
  getMethodNotAllowed,
  getQueryParam,
  normalizeBody,
  normalizeCategory,
  normalizeStatus,
  normalizeTrackingNumber,
  rejectRateLimited,
  sendJson,
} from "./_http.js";

const PHOTOS_TABLE = "request_photos";

function safeRequestShape(body) {
  if (!body || typeof body !== "object") {
    return { bodyType: typeof body };
  }

  return {
    bodyKeys: Object.keys(body),
    hasTitle: Boolean(String(body.title || "").trim()),
    category: String(body.category || body.cat || "").trim() || null,
    status: String(body.status || "").trim() || null,
    hasAddress: Boolean(String(body.address || body.addr || "").trim()),
  };
}

function buildPatchRecord(body) {
  const patch = {
    updated_at: new Date().toISOString(),
  };

  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    patch.status = normalizeStatus(body.status);
  }

  if (Object.prototype.hasOwnProperty.call(body, "category")) {
    patch.category = normalizeCategory(body.category);
  }

  if (Object.prototype.hasOwnProperty.call(body, "priority")) {
    const priority = String(clampText(body.priority, 40) || "normal").toLowerCase();
    patch.priority = ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
  }

  if (Object.prototype.hasOwnProperty.call(body, "assigned_to")) {
    patch.assigned_to = clampText(body.assigned_to, 120) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "internal_notes")) {
    patch.internal_notes = clampText(body.internal_notes, 2000);
  }

  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    patch.title = clampText(body.title, 120);
  }

  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    patch.description = clampText(body.description, 2000);
  }

  if (Object.prototype.hasOwnProperty.call(body, "address")) {
    patch.address = clampText(body.address, 200);
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
    console.error("[api/requests] Failed to write audit log", {
      eventType,
      recordId,
      error: auditError instanceof Error ? auditError.message : "Unknown audit error.",
    });
  }
}

async function handleLookup(req, res, trackingNumber) {
  const rateLimit = await checkRateLimit(req, "requests:lookup", 30);
  if (!rateLimit.allowed) {
    return rejectRateLimited(res, rateLimit);
  }

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase
    .from(REQUESTS_TABLE)
    .select("*")
    .eq("tracking_number", trackingNumber)
    .limit(1);

  if (error) {
    throw error;
  }

  if (!Array.isArray(data) || data.length === 0) {
    return sendJson(res, 404, {
      success: false,
      error: "REQUEST_NOT_FOUND",
      message: "Request not found.",
    });
  }

  const staff = await getAuthenticatedStaff(req);
  const wantsStaffDetail = staff.authenticated && getQueryParam(req, "staff") === "1";

  if (wantsStaffDetail) {
    return handleStaffDetail(req, res, data[0], staff);
  }

  return sendJson(res, 200, {
    success: true,
    request: normalizePublicRequestRecord(data[0]),
  });
}

function normalizePhotoRecord(record, signedUrl) {
  return {
    id: record.id || null,
    request_id: record.request_id || null,
    storage_path: record.storage_path || "",
    content_type: record.content_type || "image/jpeg",
    created_at: record.created_at || null,
    signed_url: signedUrl || "",
  };
}

function humanizeAuditEvent(eventType) {
  const labels = {
    request_created: "Request submitted",
    request_created_from_chat: "Request submitted by chat",
    request_updated: "Request updated",
    request_status_changed: "Status changed",
    request_assigned: "Assignment changed",
    request_priority_changed: "Priority changed",
    internal_note_updated: "Internal note updated",
    request_photo_attached: "Photo attached",
  };

  return labels[eventType] || String(eventType || "Activity").replace(/_/g, " ");
}

function normalizeRequestEvent(row) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};

  return {
    timestamp: row.timestamp || null,
    event_type: row.event_type || "",
    label: humanizeAuditEvent(row.event_type),
    metadata: {
      from: metadata.from || null,
      to: metadata.to || null,
      status: metadata.status || null,
      changedFields: Array.isArray(metadata.changedFields) ? metadata.changedFields : [],
      photoCount: Number.isFinite(Number(metadata.photoCount)) ? Number(metadata.photoCount) : null,
    },
  };
}

async function handleStaffDetail(req, res, rawRequest, staff) {
  const supabase = getServiceSupabaseClient();
  const activeRecordsResult = await supabase
    .from(REQUESTS_TABLE)
    .select("id,tracking_number,category,address,status,created_at,updated_at,priority")
    .in("status", ["open", "in_progress"])
    .limit(1000);
  const activeRecords = activeRecordsResult.error || !Array.isArray(activeRecordsResult.data)
    ? [rawRequest]
    : activeRecordsResult.data;
  const request = normalizeRequestRecord(rawRequest, buildTriageContext(activeRecords));

  const [photoResult, auditResult] = await Promise.all([
    supabase
      .from(PHOTOS_TABLE)
      .select("*")
      .eq("request_id", rawRequest.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("audit_logs")
      .select("timestamp,event_type,related_record_id,metadata")
      .eq("related_record_id", rawRequest.tracking_number)
      .order("timestamp", { ascending: true })
      .limit(50),
  ]);

  let photos = [];

  if (!photoResult.error && Array.isArray(photoResult.data)) {
    photos = await Promise.all(
      photoResult.data.map(async (photo) => {
        const { data } = await supabase.storage.from("request-photos").createSignedUrl(photo.storage_path, 10 * 60);
        return normalizePhotoRecord(photo, data?.signedUrl || "");
      }),
    );
  }

  const events = auditResult.error || !Array.isArray(auditResult.data)
    ? []
    : auditResult.data.map(normalizeRequestEvent);

  return sendJson(res, 200, {
    success: true,
    request,
    triage: request.triage,
    photos,
    events,
    staff: {
      id: staff.user.id,
      email: staff.user.email,
    },
  });
}

async function handleStaffList(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const supabase = getServiceSupabaseClient();
  const limit = getIntQuery(req, "limit", 100, 1, 250);
  const offset = getIntQuery(req, "offset", 0, 0, 10000);
  const status = normalizeStatus(getQueryParam(req, "status"), "");
  const category = getQueryParam(req, "category");
  const search = clampText(getQueryParam(req, "search"), 120);
  const sort = getQueryParam(req, "sort") || "urgent";
  const order = sort === "oldest" ? "created_at" : "created_at";
  const ascending = sort === "oldest";

  if (sort === "urgent" && (!status || ["open", "in_progress"].includes(status))) {
    return handleStaffUrgentList(req, res, {
      supabase,
      limit,
      offset,
      status,
      category,
      search,
    });
  }

  let query = supabase
    .from(REQUESTS_TABLE)
    .select("*", { count: "exact" })
    .order(order, { ascending })
    .range(offset, offset + limit - 1);

  if (status) {
    query = query.eq("status", status);
  }

  if (category) {
    query = query.eq("category", normalizeCategory(category));
  }

  if (search) {
    const escaped = search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `tracking_number.ilike.%${escaped}%,title.ilike.%${escaped}%,address.ilike.%${escaped}%,category.ilike.%${escaped}%`,
    );
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const triageContext = buildTriageContext(Array.isArray(data) ? data : []);
  const normalizedRequests = (Array.isArray(data) ? data : []).map((record) => normalizeRequestRecord(record, triageContext));
  const sortedRequests = normalizedRequests.sort((left, right) => {
    if (sort === "newest") {
      return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
    }

    if (sort === "oldest") {
      return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    }

    const leftUrgent = String(left.priority || "").toLowerCase() === "urgent";
    const rightUrgent = String(right.priority || "").toLowerCase() === "urgent";
    const priorityDelta = Number(rightUrgent) - Number(leftUrgent);
    if (priorityDelta !== 0) return priorityDelta;
    return (right.triage?.score || 0) - (left.triage?.score || 0);
  });

  return sendJson(res, 200, {
    success: true,
    requests: sortedRequests,
    count: count || 0,
    limit,
    offset,
  });
}

async function handleStaffUrgentList(req, res, { supabase, limit, offset, status, category, search }) {
  const rankCap = 1000;
  let query = supabase
    .from(REQUESTS_TABLE)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(rankCap);

  if (status) {
    query = query.eq("status", status);
  } else {
    query = query.in("status", ["open", "in_progress"]);
  }

  if (category) {
    query = query.eq("category", normalizeCategory(category));
  }

  if (search) {
    const escaped = search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `tracking_number.ilike.%${escaped}%,title.ilike.%${escaped}%,address.ilike.%${escaped}%,category.ilike.%${escaped}%`,
    );
  }

  const { data, error, count } = await query;

  if (error) {
    throw error;
  }

  const records = Array.isArray(data) ? data : [];
  const triageContext = buildTriageContext(records);
  const sortedRequests = records
    .map((record) => normalizeRequestRecord(record, triageContext))
    .sort((left, right) => {
      const leftUrgent = String(left.priority || "").toLowerCase() === "urgent";
      const rightUrgent = String(right.priority || "").toLowerCase() === "urgent";
      const priorityDelta = Number(rightUrgent) - Number(leftUrgent);
      if (priorityDelta !== 0) return priorityDelta;

      const scoreDelta = (right.triage?.score || 0) - (left.triage?.score || 0);
      if (scoreDelta !== 0) return scoreDelta;

      return new Date(left.created_at || 0).getTime() - new Date(right.created_at || 0).getTime();
    });

  return sendJson(res, 200, {
    success: true,
    requests: sortedRequests.slice(offset, offset + limit),
    count: count || sortedRequests.length,
    limit,
    offset,
    rank_cap: rankCap,
    rank_cap_applied: (count || sortedRequests.length) > rankCap,
  });
}

async function handleCreate(req, res) {
  const rateLimit = await checkRateLimit(req, "requests:create", 12);
  if (!rateLimit.allowed) {
    return rejectRateLimited(res, rateLimit);
  }

  const body = normalizeBody(req.body);

  if (!body) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON",
      message: "Invalid JSON body.",
    });
  }

  const supabase = getServiceSupabaseClient();
  const staff = await getAuthenticatedStaff(req);
  const source = staff.authenticated ? "staff" : "public";

  console.log("[api/requests] Creating request", {
    source,
    category: normalizeCategory(body.category || body.cat),
    status: staff.authenticated ? normalizeStatus(body.status) : "open",
    hasAddress: Boolean(clampText(body.address || body.addr, 200)),
  });

  const createdRequest = await createRequestRecord({
    supabase,
    body,
    source,
    canSetStatus: staff.authenticated,
    requestedTrackingNumber: body.tracking_number,
  });
  await writeAudit("request_created", staff.authenticated ? staff.user.id : null, createdRequest.tracking_number, {
    source: createdRequest.source,
    category: createdRequest.category,
    status: createdRequest.status,
    hasAddress: Boolean(createdRequest.address),
  });

  return sendJson(res, 201, {
    success: true,
    request: staff.authenticated ? createdRequest : normalizePublicRequestRecord(createdRequest, { includeId: true }),
  });
}

async function handlePatch(req, res) {
  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const body = normalizeBody(req.body);
  const recordId = clampText(getQueryParam(req, "id") || body?.id, 80);
  const trackingNumber = normalizeTrackingNumber(getQueryParam(req, "tracking_number") || body?.tracking_number);

  if (!body) {
    return sendJson(res, 400, {
      success: false,
      error: "INVALID_JSON",
      message: "Invalid JSON body.",
    });
  }

  if (!recordId && !trackingNumber) {
    return sendJson(res, 400, {
      success: false,
      error: "REQUEST_ID_REQUIRED",
      message: "Provide id or tracking_number.",
    });
  }

  const patch = buildPatchRecord(body);
  const patchKeys = Object.keys(patch).filter((key) => key !== "updated_at");

  if (!patchKeys.length) {
    return sendJson(res, 400, {
      success: false,
      error: "NO_PATCH_FIELDS",
      message: "No supported update fields were provided.",
    });
  }

  const supabase = getServiceSupabaseClient();
  let existingQuery = supabase.from(REQUESTS_TABLE).select("*").single();
  existingQuery = recordId ? existingQuery.eq("id", recordId) : existingQuery.eq("tracking_number", trackingNumber);
  const { data: existingRecord, error: existingError } = await existingQuery;

  if (existingError) {
    throw existingError;
  }

  let query = supabase.from(REQUESTS_TABLE).update(patch).select("*").single();
  query = recordId ? query.eq("id", recordId) : query.eq("tracking_number", trackingNumber);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const updatedRequest = normalizeRequestRecord(data);
  const changedFields = patchKeys.filter((field) => field !== "updated_at");
  await writeAudit("request_updated", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
    changedFields,
    status: updatedRequest.status,
  });

  if (Object.prototype.hasOwnProperty.call(patch, "status") && normalizeStatus(existingRecord.status) !== updatedRequest.status) {
    await writeAudit("request_status_changed", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
      from: normalizeStatus(existingRecord.status),
      to: updatedRequest.status,
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "priority") && String(existingRecord.priority || "normal") !== updatedRequest.priority) {
    await writeAudit("request_priority_changed", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
      from: existingRecord.priority || "normal",
      to: updatedRequest.priority,
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "assigned_to") && String(existingRecord.assigned_to || "") !== String(updatedRequest.assigned_to || "")) {
    await writeAudit("request_assigned", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
      changed: true,
    });
  }

  if (Object.prototype.hasOwnProperty.call(patch, "internal_notes") && String(existingRecord.internal_notes || "") !== String(updatedRequest.internal_notes || "")) {
    await writeAudit("internal_note_updated", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
      changed: true,
    });
  }

  return sendJson(res, 200, {
    success: true,
    request: updatedRequest,
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const rawTrackingNumber = getQueryParam(req, "tracking_number");
      if (rawTrackingNumber) {
        const trackingNumber = normalizeTrackingNumber(rawTrackingNumber);
        if (!trackingNumber) {
          return sendJson(res, 400, {
            success: false,
            error: "INVALID_TRACKING_NUMBER",
            message: "Use a tracking number like MGN-7K9Q2M8P or an existing legacy code.",
          });
        }
        return handleLookup(req, res, trackingNumber);
      }
      return handleStaffList(req, res);
    }

    if (req.method === "POST") {
      return await handleCreate(req, res);
    }

    if (req.method === "PATCH") {
      return await handlePatch(req, res);
    }

    return getMethodNotAllowed(res, ["GET", "POST", "PATCH"]);
  } catch (error) {
    console.error("[api/requests] Request failed", {
      method: req.method,
      body: safeRequestShape(normalizeBody(req.body)),
      message: error instanceof Error ? error.message : "Unknown error.",
    });

    return sendJson(res, error.status || 500, {
      success: false,
      error: "REQUESTS_API_FAILED",
      message: "Request operation failed.",
      details: error.details || error.message || "Unknown error.",
    });
  }
}

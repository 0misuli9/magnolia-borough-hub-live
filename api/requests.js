import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";
import { getAuthenticatedStaff, requireStaff } from "./_staff-auth.js";
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

const REQUESTS_TABLE = process.env.SUPABASE_REQUESTS_TABLE || "requests";

function normalizeRequestRecord(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    tracking_number: record.tracking_number || null,
    title: record.title || "",
    description: record.description || "",
    category: normalizeCategory(record.category),
    address: record.address || "",
    status: normalizeStatus(record.status),
    priority: record.priority || "normal",
    assigned_to: record.assigned_to || null,
    internal_notes: record.internal_notes || "",
    source: record.source || "public",
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
  };
}

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

function generateTrackingNumber() {
  return `MGN-${Math.floor(Math.random() * 9000) + 1000}`;
}

async function createUniqueTrackingNumber(supabase) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const trackingNumber = generateTrackingNumber();
    const { data, error } = await supabase
      .from(REQUESTS_TABLE)
      .select("tracking_number")
      .eq("tracking_number", trackingNumber)
      .limit(1);

    if (error) {
      throw error;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return trackingNumber;
    }
  }

  throw new Error("Unable to generate a unique tracking number.");
}

function buildRequestRecord(body, trackingNumber, source, canSetStatus = false) {
  return {
    tracking_number: trackingNumber,
    title: clampText(body.title, 120),
    description: clampText(body.description || body.desc, 2000),
    category: normalizeCategory(body.category || body.cat),
    address: clampText(body.address || body.addr, 200),
    status: canSetStatus ? normalizeStatus(body.status) : "open",
    created_at: new Date().toISOString(),
    source,
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
    patch.priority = clampText(body.priority, 40) || "normal";
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
  const rateLimit = checkRateLimit(req, "requests:lookup", 30);
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

  return sendJson(res, 200, {
    success: true,
    request: normalizeRequestRecord(data[0]),
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
  const order = getQueryParam(req, "sort") === "oldest" ? "created_at" : "created_at";
  const ascending = getQueryParam(req, "sort") === "oldest";

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

  return sendJson(res, 200, {
    success: true,
    requests: (Array.isArray(data) ? data : []).map(normalizeRequestRecord),
    count: count || 0,
    limit,
    offset,
  });
}

async function handleCreate(req, res) {
  const rateLimit = checkRateLimit(req, "requests:create", 12);
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

  if (!clampText(body.title, 120)) {
    return sendJson(res, 400, {
      success: false,
      error: "TITLE_REQUIRED",
      message: "A request title is required.",
    });
  }

  if (!clampText(body.description || body.desc, 2000)) {
    return sendJson(res, 400, {
      success: false,
      error: "DESCRIPTION_REQUIRED",
      message: "A request description is required.",
    });
  }

  const supabase = getServiceSupabaseClient();
  const staff = await getAuthenticatedStaff(req);
  const trackingNumber = normalizeTrackingNumber(body.tracking_number) || await createUniqueTrackingNumber(supabase);
  const source = staff.authenticated ? "staff" : "public";
  const insertPayload = buildRequestRecord(body, trackingNumber, source, staff.authenticated);

  console.log("[api/requests] Creating request", {
    source: insertPayload.source,
    category: insertPayload.category,
    status: insertPayload.status,
    hasAddress: Boolean(insertPayload.address),
  });

  const { data, error } = await supabase
    .from(REQUESTS_TABLE)
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const createdRequest = normalizeRequestRecord(data);
  await writeAudit("request_created", staff.authenticated ? staff.user.id : null, createdRequest.tracking_number, {
    source: createdRequest.source,
    category: createdRequest.category,
    status: createdRequest.status,
    hasAddress: Boolean(createdRequest.address),
  });

  return sendJson(res, 201, {
    success: true,
    request: createdRequest,
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
  let query = supabase.from(REQUESTS_TABLE).update(patch).select("*").single();
  query = recordId ? query.eq("id", recordId) : query.eq("tracking_number", trackingNumber);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  const updatedRequest = normalizeRequestRecord(data);
  await writeAudit("request_updated", staff.user.id, updatedRequest.tracking_number || updatedRequest.id, {
    changedFields: patchKeys,
    status: updatedRequest.status,
  });

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
            message: "Use a tracking number like MGN-1234.",
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

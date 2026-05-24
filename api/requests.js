import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

function validateAuth(req) {
  const expectedSecret = process.env.ADMIN_SECRET;
  const providedSecret = req.headers?.["x-admin-secret"];
  const normalizedSecret = Array.isArray(providedSecret) ? providedSecret[0] : providedSecret;

  return Boolean(expectedSecret && normalizedSecret && normalizedSecret === expectedSecret);
}

function normalizeBody(body) {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    return body;
  }

  return null;
}

function getTrackingNumberFromRequest(req) {
  const queryValue =
    typeof req.query?.tracking_number === "string" ? req.query.tracking_number : null;

  if (queryValue) {
    return queryValue.trim().toUpperCase();
  }

  const requestUrl = new URL(req.url, "http://localhost");
  const urlValue = requestUrl.searchParams.get("tracking_number");

  return urlValue ? urlValue.trim().toUpperCase() : "";
}

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_REQUESTS_TABLE || "requests";

  if (!url || !key) {
    return null;
  }

  return { url, key, table };
}

function safeRequestShape(body) {
  if (!body || typeof body !== "object") {
    return { bodyType: typeof body };
  }

  return {
    bodyKeys: Object.keys(body),
    hasTitle: Boolean(String(body.title || "").trim()),
    trackingNumber: String(body.tracking_number || "").trim().toUpperCase() || null,
    category: String(body.category || body.cat || "").trim() || null,
    status: String(body.status || "").trim() || null,
  };
}

async function readResponse(response) {
  const rawText = await response.text();

  if (!rawText) {
    return { parsed: null, rawText: "" };
  }

  try {
    return { parsed: JSON.parse(rawText), rawText };
  } catch {
    return { parsed: null, rawText };
  }
}

async function supabaseRequest(config, path, options = {}) {
  const response = await fetch(`${config.url}/rest/v1/${config.table}${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const { parsed, rawText } = await readResponse(response);

  if (!response.ok) {
    throw {
      status: response.status,
      details: parsed || rawText || "Supabase request failed.",
    };
  }

  return parsed;
}

async function trackingNumberExists(config, trackingNumber) {
  const encodedTrackingNumber = encodeURIComponent(trackingNumber);
  const records = await supabaseRequest(
    config,
    `?select=tracking_number&tracking_number=eq.${encodedTrackingNumber}&limit=1`,
    { method: "GET", prefer: "return=minimal" },
  );

  return Array.isArray(records) && records.length > 0;
}

function generateTrackingNumber() {
  return `MGN-${Math.floor(Math.random() * 9000) + 1000}`;
}

async function createUniqueTrackingNumber(config) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const trackingNumber = generateTrackingNumber();
    const exists = await trackingNumberExists(config, trackingNumber);

    if (!exists) {
      return trackingNumber;
    }
  }

  throw new Error("Unable to generate a unique tracking number.");
}

function buildRequestRecord(body, trackingNumber) {
  const record = {
    tracking_number: trackingNumber,
    title: String(body.title || "").trim(),
    description: String(body.description || body.desc || "").trim(),
    category: String(body.category || body.cat || "Other").trim() || "Other",
    address: String(body.address || body.addr || "").trim(),
    status: "pending",
    created_at: new Date().toISOString(),
  };

  console.log("[api/requests] Insert payload", record);

  return record;
}

export default async function handler(req, res) {
  const config = getSupabaseConfig();

  if (!config) {
    return sendJson(res, 500, {
      error: "Server configuration error: Supabase environment variables are missing.",
    });
  }

  if (req.method === "GET") {
    const trackingNumber = getTrackingNumberFromRequest(req);

    try {
      if (trackingNumber) {
        const encodedTrackingNumber = encodeURIComponent(trackingNumber);
        const records = await supabaseRequest(
          config,
          `?select=*&tracking_number=eq.${encodedTrackingNumber}&limit=1`,
          { method: "GET", prefer: "return=minimal" },
        );

        if (!Array.isArray(records) || !records.length) {
          return sendJson(res, 404, { error: "Request not found." });
        }

        return sendJson(res, 200, { request: records[0] });
      }

      if (!validateAuth(req)) {
        return sendJson(res, 401, {
          error: "Unauthorized.",
        });
      }

      const records = await supabaseRequest(config, "?select=*&order=created_at.desc", {
        method: "GET",
        prefer: "return=minimal",
      });

      return sendJson(res, 200, { requests: Array.isArray(records) ? records : [] });
    } catch (error) {
      return sendJson(res, error.status || 500, {
        error: "Failed to fetch requests.",
        details: error.details || error.message || "Unknown error.",
      });
    }
  }

  if (req.method === "POST") {
    const body = normalizeBody(req.body);

    console.log("[api/requests] POST request", safeRequestShape(body));

    if (!body) {
      return sendJson(res, 400, { error: "Invalid JSON body." });
    }

    if (!String(body.title || "").trim()) {
      return sendJson(res, 400, { error: "A request title is required." });
    }

    try {
      const trackingNumber = await createUniqueTrackingNumber(config);

      console.log("[api/requests] Using tracking number", { trackingNumber });

      const createdRecords = await supabaseRequest(config, "", {
        method: "POST",
        body: buildRequestRecord(body, trackingNumber),
        prefer: "return=representation",
      });

      const createdRequest = Array.isArray(createdRecords) ? createdRecords[0] : createdRecords;

      console.log("[api/requests] Created request record", createdRequest);

      try {
        await logAuditEvent(getServiceSupabaseClient(), {
          eventType: "request_created",
          actorId: null,
          recordId: createdRequest?.tracking_number || trackingNumber,
          metadata: {
            category: createdRequest?.category || null,
            status: createdRequest?.status || null,
            hasAddress: Boolean(createdRequest?.address),
          },
        });
      } catch (auditError) {
        console.error("[api/requests] Failed to write audit log", auditError);
      }

      return sendJson(res, 201, {
        request: createdRequest,
      });
    } catch (error) {
      console.error("[api/requests] Failed to create request", {
        request: safeRequestShape(body),
        error,
      });

      return sendJson(res, error.status || 500, {
        error: "Failed to create request.",
        details: error.details || error.message || "Unknown error.",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return sendJson(res, 405, { error: "Method not allowed." });
}

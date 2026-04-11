function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
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

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const table = process.env.SUPABASE_ANNOUNCEMENTS_TABLE || "announcements";

  if (!url || !key) {
    return null;
  }

  return { url, key, table };
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

function buildAnnouncementRecord(body) {
  const normalizedType = ["urgent", "event", "info"].includes(String(body.type || "").trim())
    ? String(body.type || "").trim()
    : "info";

  const record = {
    type: normalizedType,
    title: String(body.title || "").trim(),
    body: String(body.body || "").trim(),
    created_at: new Date().toISOString(),
  };

  console.log("[api/announcements] Insert payload", {
    type: record.type,
    titleLength: record.title.length,
    bodyLength: record.body.length,
  });

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
    try {
      const records = await supabaseRequest(config, "?select=*&order=created_at.desc", {
        method: "GET",
        prefer: "return=minimal",
      });

      return sendJson(res, 200, {
        announcements: Array.isArray(records) ? records : [],
      });
    } catch (error) {
      console.error("[api/announcements] Failed to fetch announcements", error);

      return sendJson(res, error.status || 500, {
        error: "Failed to fetch announcements.",
        details: error.details || error.message || "Unknown error.",
      });
    }
  }

  if (req.method === "POST") {
    const body = normalizeBody(req.body);

    console.log("[api/announcements] POST request", safeAnnouncementShape(body));

    if (!body) {
      return sendJson(res, 400, { error: "Invalid JSON body." });
    }

    if (!String(body.title || "").trim()) {
      return sendJson(res, 400, { error: "An announcement title is required." });
    }

    if (!String(body.body || "").trim()) {
      return sendJson(res, 400, { error: "An announcement body is required." });
    }

    try {
      const createdRecords = await supabaseRequest(config, "", {
        method: "POST",
        body: buildAnnouncementRecord(body),
        prefer: "return=representation",
      });

      const createdAnnouncement = Array.isArray(createdRecords) ? createdRecords[0] : createdRecords;

      console.log("[api/announcements] Created announcement", {
        id: createdAnnouncement?.id || null,
        type: createdAnnouncement?.type || null,
      });

      return sendJson(res, 201, {
        announcement: createdAnnouncement,
      });
    } catch (error) {
      console.error("[api/announcements] Failed to create announcement", {
        announcement: safeAnnouncementShape(body),
        error,
      });

      return sendJson(res, error.status || 500, {
        error: "Failed to create announcement.",
        details: error.details || error.message || "Unknown error.",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return sendJson(res, 405, { error: "Method not allowed." });
}

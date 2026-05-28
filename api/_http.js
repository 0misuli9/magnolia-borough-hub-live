const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const rateLimitBuckets = new Map();

export const REQUEST_STATUS = ["open", "in_progress", "resolved", "closed"];
export const REQUEST_CATEGORIES = [
  "Roads & Infrastructure",
  "Utilities & Lighting",
  "Parks & Public Spaces",
  "Sanitation & Trash",
  "Noise & Safety",
  "Permits & Zoning",
  "Other",
];
export const ANNOUNCEMENT_TYPES = ["urgent", "event", "info"];
export const ANNOUNCEMENT_STATUS = ["active", "draft", "expired", "archived"];

export function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export function normalizeBody(body) {
  if (!body) {
    return null;
  }

  if (typeof body === "string") {
    if (body.length > 10000) {
      return null;
    }

    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (typeof body === "object" && !Array.isArray(body)) {
    try {
      if (JSON.stringify(body).length > 10000) {
        return null;
      }
    } catch {
      return null;
    }

    return body;
  }

  return null;
}

export function getMethodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return sendJson(res, 405, {
    success: false,
    error: "METHOD_NOT_ALLOWED",
    message: `Method not allowed. Use ${methods.join(" or ")}.`,
  });
}

export function clampText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

export function normalizeStatus(value, fallback = "open") {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  const legacyMap = {
    pending: "open",
    progress: "in_progress",
    "in-progress": "in_progress",
  };
  const mapped = legacyMap[normalized] || normalized;

  return REQUEST_STATUS.includes(mapped) ? mapped : fallback;
}

export function normalizeCategory(value) {
  const clean = String(value || "").replace(/^[^\w?]+/u, "").trim();
  return REQUEST_CATEGORIES.includes(clean) ? clean : "Other";
}

export function normalizeAnnouncementType(value) {
  const clean = String(value || "").trim().toLowerCase();
  return ANNOUNCEMENT_TYPES.includes(clean) ? clean : "info";
}

export function normalizeAnnouncementStatus(value, fallback = "active") {
  const clean = String(value || "").trim().toLowerCase();
  return ANNOUNCEMENT_STATUS.includes(clean) ? clean : fallback;
}

export function normalizeTrackingNumber(value) {
  const clean = String(value || "").trim().toUpperCase();
  const withPrefix = clean && !clean.startsWith("MGN-") ? `MGN-${clean}` : clean;

  if (!/^MGN-\d{4}$/.test(withPrefix)) {
    return "";
  }

  return withPrefix;
}

export function getQueryParam(req, name) {
  if (typeof req.query?.[name] === "string") {
    return req.query[name];
  }

  const requestUrl = new URL(req.url, "http://localhost");
  return requestUrl.searchParams.get(name) || "";
}

export function getIntQuery(req, name, fallback, min, max) {
  const parsed = Number.parseInt(getQueryParam(req, name), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function getClientIp(req) {
  const forwardedFor = req.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

  return String(value || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export function checkRateLimit(req, key, limit) {
  const now = Date.now();
  const bucketKey = `${key}:${getClientIp(req)}`;
  const bucket = rateLimitBuckets.get(bucketKey);

  if (!bucket || bucket.expiresAt <= now) {
    rateLimitBuckets.set(bucketKey, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  bucket.count += 1;

  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.ceil((bucket.expiresAt - now) / 1000),
  };
}

export function rejectRateLimited(res, rateLimit) {
  res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds || 60));
  return sendJson(res, 429, {
    success: false,
    error: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
  });
}

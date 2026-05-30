import { randomInt } from "node:crypto";
import { TRACKING_CONFIG } from "../config/borough.js";
import { getServiceSupabaseClient } from "./_audit.js";

const RATE_LIMIT_WINDOW_SECONDS = 60;
export const TRACKING_ALPHABET = TRACKING_CONFIG.alphabet;
export const TRACKING_EXAMPLE = TRACKING_CONFIG.example;
const LEGACY_TRACKING_REGEX = /^MGN-\d{4}$/;
const NEW_TRACKING_REGEX = new RegExp(`^MGN-[${TRACKING_ALPHABET}]{${TRACKING_CONFIG.generatedLength}}$`);

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

  if (!LEGACY_TRACKING_REGEX.test(withPrefix) && !NEW_TRACKING_REGEX.test(withPrefix)) {
    return "";
  }

  return withPrefix;
}

export function generateTrackingNumber() {
  let suffix = "";

  for (let index = 0; index < TRACKING_CONFIG.generatedLength; index += 1) {
    suffix += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  }

  return `MGN-${suffix}`;
}

export async function createUniqueTrackingNumber(supabase, table) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const trackingNumber = generateTrackingNumber();
    const { data, error } = await supabase
      .from(table)
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
  // Prefer the platform-trusted client IP header; XFF is only a platform-dependent fallback.
  const realIp = req.headers?.["x-real-ip"];
  if (typeof realIp === "string" && realIp.trim()) {
    return realIp.trim();
  }

  const forwardedFor = req.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;

  return String(value || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

export async function checkRateLimit(req, key, limit, windowSeconds = RATE_LIMIT_WINDOW_SECONDS) {
  const bucketKey = `${key}:${getClientIp(req)}`;

  try {
    const { data, error } = await getServiceSupabaseClient().rpc("check_rate_limit", {
      p_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;

    if (!result) {
      return { allowed: true };
    }

    return {
      allowed: Boolean(result.allowed),
      retryAfterSeconds: Number(result.retry_after_seconds) || windowSeconds,
    };
  } catch (error) {
    console.warn("[rate-limit] Durable limiter unavailable; failing open.", {
      key,
      message: error instanceof Error ? error.message : "Unknown rate limit error.",
    });
    return { allowed: true, failedOpen: true };
  }
}

export function rejectRateLimited(res, rateLimit) {
  res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds || 60));
  return sendJson(res, 429, {
    success: false,
    error: "RATE_LIMITED",
    message: "Too many requests. Please wait a moment and try again.",
  });
}

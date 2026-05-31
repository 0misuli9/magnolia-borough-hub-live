import { getServiceSupabaseClient } from "./_audit.js";
import { createHash } from "node:crypto";

const DEFAULT_STAFF_ROLES = ["staff", "admin", "owner", "clerk"];
const STAFF_AUTH_CACHE_KEY = Symbol.for("magnolia.staffAuth");

function getHeaderValue(req, name) {
  const value = req.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function getBearerToken(req) {
  const authorization = getHeaderValue(req, "authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  return match ? match[1].trim() : "";
}

function getJwtPayload(token) {
  const parts = String(token || "").split(".");

  if (parts.length < 2) {
    return {};
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

function shouldRequireMfa() {
  return String(process.env.STAFF_REQUIRE_MFA || "").trim().toLowerCase() === "true";
}

function getAllowedRoles() {
  const configuredRoles = String(process.env.STAFF_ALLOWED_ROLES || "")
    .split(",")
    .map((role) => role.trim().toLowerCase())
    .filter(Boolean);

  return configuredRoles.length ? configuredRoles : DEFAULT_STAFF_ROLES;
}

function hashUserId(userId) {
  return createHash("sha256")
    .update(String(userId || ""))
    .digest("hex")
    .slice(0, 12);
}

function addRole(roles, value) {
  if (typeof value === "string" && value.trim()) {
    roles.add(value.trim().toLowerCase());
  }
}

function getUserRoles(user, staffProfile = null) {
  const appMetadata = user?.app_metadata || {};
  const roles = new Set();

  if (staffProfile?.active === true) {
    addRole(roles, staffProfile.role || "staff");
  }

  addRole(roles, appMetadata.role);
  addRole(roles, appMetadata.staff_role);
  addRole(roles, appMetadata.user_role);

  if (Array.isArray(appMetadata.roles)) {
    for (const role of appMetadata.roles) {
      addRole(roles, role);
    }
  }

  return roles;
}

function hasAppMetadataStaffSignal(user) {
  const appMetadata = user?.app_metadata || {};

  if (appMetadata.is_staff === true) {
    return true;
  }

  const roles = getUserRoles(user);
  return getAllowedRoles().some((role) => roles.has(role));
}

function isStaffUser(user, staffProfile = null) {
  return staffProfile?.active === true || hasAppMetadataStaffSignal(user);
}

async function getActiveStaffProfile(supabase, userId) {
  if (!userId) {
    return null;
  }

  const { data, error } = await supabase
    .from("staff_profiles")
    .select("id,role,active,email,full_name")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[api/auth] staff_profiles lookup failed; falling back to app_metadata", {
      code: error.code || null,
      message: error.message || "Unknown staff profile lookup error.",
      userHash: hashUserId(userId),
    });
    return null;
  }

  return data?.active === true ? data : null;
}

export async function getAuthenticatedStaff(req) {
  if (req?.[STAFF_AUTH_CACHE_KEY]) {
    return req[STAFF_AUTH_CACHE_KEY];
  }

  const token = getBearerToken(req);

  if (!token) {
    const result = {
      authenticated: false,
      statusCode: 401,
      message: "Staff login required.",
    };
    if (req) req[STAFF_AUTH_CACHE_KEY] = result;
    return result;
  }

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    const result = {
      authenticated: false,
      statusCode: 401,
      message: "Staff session expired. Please sign in again.",
    };
    if (req) req[STAFF_AUTH_CACHE_KEY] = result;
    return result;
  }

  const staffProfile = await getActiveStaffProfile(supabase, data.user.id);
  const appMetadataFallback = hasAppMetadataStaffSignal(data.user);

  if (!isStaffUser(data.user, staffProfile)) {
    const result = {
      authenticated: false,
      statusCode: 403,
      message: "This account is not authorized for staff access.",
    };
    if (req) req[STAFF_AUTH_CACHE_KEY] = result;
    return result;
  }

  if (!staffProfile && appMetadataFallback) {
    console.warn("[api/auth] Staff access granted through temporary app_metadata fallback", {
      via: "app_metadata_fallback",
      userHash: hashUserId(data.user.id),
    });
  }

  if (shouldRequireMfa() && getJwtPayload(token).aal !== "aal2") {
    const result = {
      authenticated: false,
      statusCode: 401,
      errorCode: "MFA_REQUIRED",
      message: "Multi-factor authentication is required for staff access.",
    };
    if (req) req[STAFF_AUTH_CACHE_KEY] = result;
    return result;
  }

  const result = {
    authenticated: true,
    user: data.user,
    roles: Array.from(getUserRoles(data.user, staffProfile)),
    staffProfile,
    authorizationSource: staffProfile ? "staff_profiles" : "app_metadata",
  };
  if (req) req[STAFF_AUTH_CACHE_KEY] = result;
  return result;
}

export async function requireStaff(req, res) {
  const staff = await getAuthenticatedStaff(req);

  if (!staff.authenticated) {
    res.status(staff.statusCode).json({
      success: false,
      error: staff.errorCode || (staff.statusCode === 403 ? "FORBIDDEN" : "UNAUTHORIZED"),
      message: staff.message,
    });
    return null;
  }

  return staff;
}

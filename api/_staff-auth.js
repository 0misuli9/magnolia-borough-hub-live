import { getServiceSupabaseClient } from "./_audit.js";

const DEFAULT_STAFF_ROLES = ["staff", "admin", "owner"];

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

function addRole(roles, value) {
  if (typeof value === "string" && value.trim()) {
    roles.add(value.trim().toLowerCase());
  }
}

function getUserRoles(user) {
  const appMetadata = user?.app_metadata || {};
  const roles = new Set();

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

function isStaffUser(user) {
  const appMetadata = user?.app_metadata || {};

  if (appMetadata.is_staff === true) {
    return true;
  }

  const roles = getUserRoles(user);
  return getAllowedRoles().some((role) => roles.has(role));
}

export async function getAuthenticatedStaff(req) {
  const token = getBearerToken(req);

  if (!token) {
    return {
      authenticated: false,
      statusCode: 401,
      message: "Staff login required.",
    };
  }

  const supabase = getServiceSupabaseClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return {
      authenticated: false,
      statusCode: 401,
      message: "Staff session expired. Please sign in again.",
    };
  }

  if (!isStaffUser(data.user)) {
    return {
      authenticated: false,
      statusCode: 403,
      message: "This account is not authorized for staff access.",
    };
  }

  if (shouldRequireMfa() && getJwtPayload(token).aal !== "aal2") {
    return {
      authenticated: false,
      statusCode: 401,
      message: "Multi-factor authentication is required for staff access.",
    };
  }

  return {
    authenticated: true,
    user: data.user,
    roles: Array.from(getUserRoles(data.user)),
  };
}

export async function requireStaff(req, res) {
  const staff = await getAuthenticatedStaff(req);

  if (!staff.authenticated) {
    res.status(staff.statusCode).json({
      success: false,
      error: staff.statusCode === 403 ? "FORBIDDEN" : "UNAUTHORIZED",
      message: staff.message,
    });
    return null;
  }

  return staff;
}

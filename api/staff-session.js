import { getAuthenticatedStaff } from "./_staff-auth.js";

function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed. Use GET.",
    });
  }

  const staff = await getAuthenticatedStaff(req);

  return sendJson(res, 200, {
    success: true,
    authenticated: staff.authenticated,
    message: staff.authenticated ? null : staff.message,
    staff: staff.authenticated
      ? {
          id: staff.user.id,
          email: staff.user.email,
          roles: staff.roles,
        }
      : null,
  });
}

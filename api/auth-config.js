function sendJson(res, statusCode, payload) {
  res.status(statusCode).json(payload);
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, {
      success: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Method not allowed. Use GET.",
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return sendJson(res, 500, {
      success: false,
      error: "AUTH_CONFIG_MISSING",
      message: "Supabase public auth configuration is missing.",
    });
  }

  return sendJson(res, 200, {
    success: true,
    supabaseUrl,
    supabaseAnonKey,
  });
}

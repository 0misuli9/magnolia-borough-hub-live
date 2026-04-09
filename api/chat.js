const BOROUGH_KNOWLEDGE = `You are the official AI assistant for the Borough of Magnolia, Camden County, New Jersey. You are warm, friendly, helpful, and concise. You represent the borough with civic pride and genuine care for every resident.

KEY INFO:
- Borough Hall: 438 West Evesham Ave, Magnolia, NJ 08049-1725
- Office Hours: Monday-Friday, 8:30 AM - 4:00 PM
- Phone: (856) 783-1520
- Emergency: 911. Non-emergency police: Camden County Police

APPROVED SCHEDULE FACTS:
- East Side Trash: Weekly on Tuesdays
- West Side Trash: Weekly on Wednesdays
- Recycling: Weekly on Thursdays
- Set-out guidance: Place materials curbside between 7:00 PM the night before and 6:00 AM on collection day

POTHOLES:
- Potholes on borough streets can be reported to Public Works at (856) 784-6162
- If the resident wants, you may still help capture the issue details in this app as a service request

SCHEDULE SAFETY RULE:
- For trash, recycling, leaf pickup, yard waste, bulk pickup, snow schedules, and meeting times, answer only from the approved Magnolia facts provided here.
- Do not guess or fill in missing schedule details.
- If the resident asks for a schedule detail that is not explicitly listed here, say you do not want to risk giving the wrong schedule and direct them to Borough Hall at (856) 783-1520.

PERMITS:
- Building permits required for additions, new construction, decks, sheds over 100 sq ft
- Fence permits required for fences over 4ft
- Apply at Borough Hall during office hours. Turnaround: 5-10 business days

PARKS:
- Magnolia Lake Park and Veterans Memorial Park - open dawn to dusk

SERVICE REQUEST INTAKE:
When a resident wants to report a problem, warmly collect: 1) type of issue 2) location/address 3) brief description. Once you have all three, confirm logged and give tracking number like MGN-[4 random digits].

IMPORTANT: When you have all info, append EXACTLY at the very end on its own line:
SUBMIT_REQUEST:{"title":"[short title]","desc":"[description]","cat":"[one of: Roads & Infrastructure, Utilities & Lighting, Parks & Public Spaces, Sanitation & Trash, Noise & Safety, Permits & Zoning, Other]","addr":"[address]"}

Keep responses friendly and concise - 2 to 4 sentences unless more detail is needed.`;

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

function messageContentToText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }

        if (part && typeof part.text === "string") {
          return part.text;
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function extractLatestUserMessage(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index];
    }
  }

  return null;
}

function safeRequestShape(body) {
  if (!body || typeof body !== "object") {
    return { bodyType: typeof body };
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  const latestUserMessage = extractLatestUserMessage(messages);

  return {
    bodyKeys: Object.keys(body),
    messagesCount: messages.length,
    previousResponseId:
      typeof body.previousResponseId === "string" && body.previousResponseId.trim()
        ? body.previousResponseId
        : null,
    messageRoles: messages.map((message) => message?.role || null),
    latestUserLength: latestUserMessage ? messageContentToText(latestUserMessage.content).length : 0,
  };
}

function extractReplyText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  if (!Array.isArray(responseJson.output)) {
    return "";
  }

  const parts = [];

  for (const outputItem of responseJson.output) {
    if (!Array.isArray(outputItem.content)) {
      continue;
    }

    for (const contentItem of outputItem.content) {
      if (typeof contentItem.text === "string" && contentItem.text.trim()) {
        parts.push(contentItem.text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

function parseSubmitRequest(reply) {
  const prefix = "SUBMIT_REQUEST:";
  const lines = reply.split(/\r?\n/);
  let lastNonEmptyIndex = -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim()) {
      lastNonEmptyIndex = index;
      break;
    }
  }

  if (lastNonEmptyIndex === -1) {
    return { reply: "", requestData: null };
  }

  const finalLine = lines[lastNonEmptyIndex].trim();

  if (!finalLine.startsWith(prefix)) {
    return { reply: reply.trim(), requestData: null };
  }

  const rawJson = finalLine.slice(prefix.length).trim();

  try {
    const requestData = JSON.parse(rawJson);

    if (!requestData || typeof requestData !== "object" || Array.isArray(requestData)) {
      return { reply: reply.trim(), requestData: null };
    }

    const cleanedReply = lines
      .filter((_, index) => index !== lastNonEmptyIndex)
      .join("\n")
      .trim();

    return {
      reply: cleanedReply,
      requestData,
    };
  } catch {
    return { reply: reply.trim(), requestData: null };
  }
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
    console.log("[api/chat] Generated tracking number candidate", { trackingNumber, attempt });
    const exists = await trackingNumberExists(config, trackingNumber);

    if (!exists) {
      console.log("[api/chat] Tracking number available", { trackingNumber });
      return trackingNumber;
    }
  }

  throw new Error("Unable to generate a unique tracking number.");
}

async function createServiceRequest(requestData) {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error("Supabase environment variables are missing.");
  }

  console.log("[api/chat] Request data ready for persistence", requestData);

  const trackingNumber = await createUniqueTrackingNumber(config);
  const insertPayload = {
    tracking_number: trackingNumber,
    title: String(requestData.title || "").trim(),
    description: String(requestData.description || requestData.desc || "").trim(),
    category: String(requestData.category || requestData.cat || "Other").trim() || "Other",
    address: String(requestData.address || requestData.addr || "").trim(),
    status: "open",
    created_at: new Date().toISOString(),
  };

  console.log("[api/chat] Supabase insert payload", insertPayload);

  const createdRecords = await supabaseRequest(config, "", {
    method: "POST",
    body: insertPayload,
    prefer: "return=representation",
  });

  const createdRequest = Array.isArray(createdRecords) ? createdRecords[0] : createdRecords;
  console.log("[api/chat] Supabase created request", createdRequest);

  return createdRequest;
}

export default async function handler(req, res) {
  console.log("[api/chat] Incoming request", {
    method: req.method,
    body: safeRequestShape(req.body),
  });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed. Use POST." });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4";

  if (!apiKey) {
    return sendJson(res, 500, { error: "Server configuration error: OPENAI_API_KEY is not set." });
  }

  const body = normalizeBody(req.body);

  if (!body) {
    console.error("[api/chat] Invalid body", { bodyType: typeof req.body });
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    console.error("[api/chat] Invalid messages array", safeRequestShape(body));
    return sendJson(res, 400, { error: "Invalid request body: messages must be a non-empty array." });
  }

  const invalidMessage = body.messages.find(
    (message) =>
      !message ||
      typeof message !== "object" ||
      typeof message.role !== "string" ||
      !["user", "assistant", "system", "developer"].includes(message.role) ||
      (typeof message.content !== "string" && !Array.isArray(message.content)),
  );

  if (invalidMessage) {
    console.error("[api/chat] Invalid message payload", safeRequestShape(body));
    return sendJson(res, 400, {
      error: "Invalid request body: each message must include a valid role and string or array content.",
    });
  }

  const latestUserMessage = extractLatestUserMessage(body.messages);
  const latestUserText = latestUserMessage ? messageContentToText(latestUserMessage.content) : "";

  if (!latestUserText) {
    console.error("[api/chat] Missing latest user message", safeRequestShape(body));
    return sendJson(res, 400, {
      error: "Invalid request body: a latest user message is required.",
    });
  }

  const previousResponseId =
    typeof body.previousResponseId === "string" && body.previousResponseId.trim()
      ? body.previousResponseId.trim()
      : null;

  const openaiPayload = {
    model,
    instructions: BOROUGH_KNOWLEDGE,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: latestUserText,
          },
        ],
      },
    ],
  };

  if (previousResponseId) {
    openaiPayload.previous_response_id = previousResponseId;
  }

  let upstreamResponse;

  try {
    upstreamResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(openaiPayload),
    });
  } catch (error) {
    console.error("[api/chat] Failed to reach OpenAI", error);
    return sendJson(res, 502, {
      error: "Failed to reach OpenAI.",
      details: error instanceof Error ? error.message : "Unknown network error.",
    });
  }

  const openaiStatus = upstreamResponse.status;
  const openaiStatusText = upstreamResponse.statusText;
  let rawResponseText = "";

  try {
    rawResponseText = await upstreamResponse.text();
  } catch (error) {
    console.error("[api/chat] Failed reading OpenAI response body", error);
    return sendJson(res, 502, {
      error: "Failed to read OpenAI response.",
      details: error instanceof Error ? error.message : "Unknown response read error.",
    });
  }

  let responseJson = null;

  if (rawResponseText) {
    try {
      responseJson = JSON.parse(rawResponseText);
    } catch (error) {
      if (!upstreamResponse.ok) {
        console.error("[api/chat] OpenAI non-JSON error body", {
          openaiStatus,
          openaiStatusText,
          rawResponseText,
        });
      } else {
        console.error("[api/chat] OpenAI returned invalid JSON", {
          openaiStatus,
          openaiStatusText,
          rawResponseText,
        });
      }
    }
  }

  if (!upstreamResponse.ok) {
    const details = responseJson || rawResponseText || null;

    console.error("[api/chat] OpenAI request failed", {
      openaiStatus,
      openaiStatusText,
      details,
    });

    return res.status(openaiStatus).json({
      error: "OpenAI request failed",
      details,
    });
  }

  if (!responseJson) {
    return sendJson(res, 502, {
      error: "OpenAI returned a non-JSON response.",
      details: rawResponseText || null,
    });
  }

  const replyText = extractReplyText(responseJson);

  if (!replyText) {
    console.error("[api/chat] OpenAI returned empty reply", {
      responseId: responseJson.id || null,
      responseJson,
    });

    return sendJson(res, 502, { error: "OpenAI returned an empty response." });
  }

  let { reply, requestData } = parseSubmitRequest(replyText);
  let createdRequest = null;

  if (requestData) {
    console.log("[api/chat] Extracted SUBMIT_REQUEST payload", requestData);
  }

  if (requestData) {
    try {
      createdRequest = await createServiceRequest(requestData);
      reply = reply.replace(/MGN-\d{4}/g, createdRequest.tracking_number);
    } catch (error) {
      console.error("[api/chat] Failed to persist request", {
        requestData,
        error,
      });
      return sendJson(res, error.status || 500, {
        error: "Failed to save service request.",
        details: error.details || error.message || "Unknown Supabase error.",
        requestData,
      });
    }
  }

  return sendJson(res, 200, {
    reply,
    requestData,
    responseId: typeof responseJson.id === "string" ? responseJson.id : null,
    createdRequest,
  });
}

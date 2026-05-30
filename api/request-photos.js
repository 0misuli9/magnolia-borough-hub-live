import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";
import { checkRateLimit, getMethodNotAllowed, normalizeTrackingNumber, rejectRateLimited, sendJson } from "./_http.js";
import { randomUUID } from "crypto";

const REQUESTS_TABLE = process.env.SUPABASE_REQUESTS_TABLE || "requests";
const PHOTOS_TABLE = "request_photos";
const PHOTO_BUCKET = "request-photos";
const MAX_PHOTOS = 3;
const MAX_DECODED_BYTES = 1.25 * 1024 * 1024;
const MAX_TOTAL_DECODED_BYTES = 3.75 * 1024 * 1024;

function parseJsonBody(body) {
  if (!body) return null;

  if (typeof body === "string") {
    if (body.length > 6 * 1024 * 1024) return null;

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

function getDataUrlParts(value) {
  const match = String(value || "").match(/^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/);

  if (!match) {
    return null;
  }

  return {
    contentType: match[1],
    base64: match[2],
  };
}

function stripJpegMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error("Invalid JPEG image.");
  }

  const chunks = [buffer.subarray(0, 2)];
  let offset = 2;

  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const marker = buffer[offset + 1];

    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    if (marker === 0xd9) {
      chunks.push(buffer.subarray(offset, offset + 2));
      break;
    }

    const length = buffer.readUInt16BE(offset + 2);
    const end = offset + 2 + length;

    if (end > buffer.length || length < 2) {
      throw new Error("Invalid JPEG segment.");
    }

    const isMetadataSegment = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;

    if (!isMetadataSegment) {
      chunks.push(buffer.subarray(offset, end));
    }

    offset = end;
  }

  return Buffer.concat(chunks);
}

async function writeAudit(eventType, recordId, metadata = {}) {
  try {
    await logAuditEvent(getServiceSupabaseClient(), {
      eventType,
      actorId: null,
      recordId,
      metadata,
    });
  } catch (error) {
    console.error("[api/request-photos] Failed to write audit log", {
      eventType,
      recordId,
      message: error instanceof Error ? error.message : "Unknown audit error.",
    });
  }
}

async function findRequest(supabase, requestId, trackingNumber) {
  const { data, error } = await supabase
    .from(REQUESTS_TABLE)
    .select("id,tracking_number")
    .eq("id", requestId)
    .eq("tracking_number", trackingNumber)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return getMethodNotAllowed(res, ["POST"]);
  }

  const rateLimit = await checkRateLimit(req, "requests:photos", 6);
  if (!rateLimit.allowed) {
    return rejectRateLimited(res, rateLimit);
  }

  try {
    const body = parseJsonBody(req.body);

    if (!body) {
      return sendJson(res, 400, {
        success: false,
        error: "INVALID_JSON",
        message: "Invalid photo upload payload.",
      });
    }

    const requestId = body.request_id;
    const trackingNumber = normalizeTrackingNumber(body.tracking_number);
    const photos = Array.isArray(body.photos) ? body.photos : [];

    if (!requestId || !trackingNumber) {
      return sendJson(res, 400, {
        success: false,
        error: "REQUEST_REQUIRED",
        message: "A matching request id and tracking number are required.",
      });
    }

    if (!photos.length || photos.length > MAX_PHOTOS) {
      return sendJson(res, 400, {
        success: false,
        error: "PHOTO_COUNT_INVALID",
        message: `Attach between 1 and ${MAX_PHOTOS} photos.`,
      });
    }

    const supabase = getServiceSupabaseClient();
    const request = await findRequest(supabase, requestId, trackingNumber);
    const existingPhotos = await supabase
      .from(PHOTOS_TABLE)
      .select("id", { count: "exact", head: true })
      .eq("request_id", request.id);

    if (existingPhotos.error) {
      throw existingPhotos.error;
    }

    if ((existingPhotos.count || 0) + photos.length > MAX_PHOTOS) {
      return sendJson(res, 400, {
        success: false,
        error: "PHOTO_COUNT_INVALID",
        message: `A request can have up to ${MAX_PHOTOS} photos.`,
      });
    }

    const savedPhotos = [];
    let totalBytes = 0;

    for (const photo of photos) {
      const parts = getDataUrlParts(photo?.dataUrl);

      if (!parts) {
        return sendJson(res, 400, {
          success: false,
          error: "PHOTO_TYPE_INVALID",
          message: "Only resized JPEG uploads are accepted by the server.",
        });
      }

      const decoded = Buffer.from(parts.base64, "base64");
      totalBytes += decoded.length;

      if (decoded.length > MAX_DECODED_BYTES || totalBytes > MAX_TOTAL_DECODED_BYTES) {
        return sendJson(res, 413, {
          success: false,
          error: "PHOTO_TOO_LARGE",
          message: "Attached photos are too large. Remove one or use smaller photos.",
        });
      }

      const stripped = stripJpegMetadata(decoded);
      const fileName = `${randomUUID()}.jpg`;
      const storagePath = `${request.id}/${fileName}`;
      const upload = await supabase.storage.from(PHOTO_BUCKET).upload(storagePath, stripped, {
        contentType: "image/jpeg",
        upsert: false,
      });

      if (upload.error) {
        throw upload.error;
      }

      const { data, error } = await supabase
        .from(PHOTOS_TABLE)
        .insert({
          request_id: request.id,
          storage_path: storagePath,
          content_type: "image/jpeg",
        })
        .select("*")
        .single();

      if (error) {
        await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
        throw error;
      }

      savedPhotos.push(data);
    }

    await writeAudit("request_photo_attached", trackingNumber, {
      trackingNumber,
      photoCount: savedPhotos.length,
    });

    return sendJson(res, 201, {
      success: true,
      count: savedPhotos.length,
    });
  } catch (error) {
    console.error("[api/request-photos] Upload failed", {
      message: error instanceof Error ? error.message : "Unknown photo upload error.",
    });

    return sendJson(res, 500, {
      success: false,
      error: "PHOTO_UPLOAD_FAILED",
      message: "Unable to attach photos to the request.",
    });
  }
}

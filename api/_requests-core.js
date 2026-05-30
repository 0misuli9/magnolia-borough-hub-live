import { computeRequestTriage } from "./_triage.js";
import {
  clampText,
  createUniqueTrackingNumber,
  normalizeCategory,
  normalizeStatus,
  normalizeTrackingNumber,
} from "./_http.js";

export const REQUESTS_TABLE = process.env.SUPABASE_REQUESTS_TABLE || "requests";

export function normalizeRequestRecord(record, triageContext = []) {
  if (!record) {
    return null;
  }

  return {
    id: record.id || null,
    tracking_number: record.tracking_number || null,
    title: record.title || "",
    description: record.description || "",
    category: normalizeCategory(record.category),
    address: record.address || "",
    status: normalizeStatus(record.status),
    priority: record.priority || "normal",
    assigned_to: record.assigned_to || null,
    internal_notes: record.internal_notes || "",
    source: record.source || "public",
    created_at: record.created_at || null,
    updated_at: record.updated_at || null,
    triage: computeRequestTriage(record, triageContext),
  };
}

export function normalizePublicRequestRecord(record, options = {}) {
  const normalized = normalizeRequestRecord(record, []);

  if (!normalized) {
    return null;
  }

  if (!options.includeId) {
    delete normalized.id;
  }

  delete normalized.address;
  delete normalized.description;
  delete normalized.internal_notes;
  delete normalized.assigned_to;
  delete normalized.priority;
  delete normalized.triage;

  return normalized;
}

export function buildRequestRecord(body, trackingNumber, source, canSetStatus = false) {
  return {
    tracking_number: trackingNumber,
    title: clampText(body.title, 120),
    description: clampText(body.description || body.desc, 2000),
    category: normalizeCategory(body.category || body.cat),
    address: clampText(body.address || body.addr, 200),
    status: canSetStatus ? normalizeStatus(body.status) : "open",
    created_at: new Date().toISOString(),
    source,
  };
}

export async function createRequestRecord({
  supabase,
  body,
  source = "public",
  canSetStatus = false,
  requestedTrackingNumber = "",
}) {
  const title = clampText(body?.title, 120);
  const description = clampText(body?.description || body?.desc, 2000);

  if (!title) {
    throw {
      status: 400,
      error: "TITLE_REQUIRED",
      message: "A request title is required.",
    };
  }

  if (!description) {
    throw {
      status: 400,
      error: "DESCRIPTION_REQUIRED",
      message: "A request description is required.",
    };
  }

  const trackingNumber =
    normalizeTrackingNumber(requestedTrackingNumber) ||
    await createUniqueTrackingNumber(supabase, REQUESTS_TABLE);
  const insertPayload = buildRequestRecord({ ...body, title, description }, trackingNumber, source, canSetStatus);

  const { data, error } = await supabase
    .from(REQUESTS_TABLE)
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return normalizeRequestRecord(data);
}

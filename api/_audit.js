import { createClient } from "@supabase/supabase-js";

const HIGH_VALUE_AUDIT_EVENTS = new Set([
  "request_created",
  "request_created_from_chat",
  "request_status_changed",
  "request_priority_changed",
  "request_assigned",
  "announcement_created",
  "announcement_updated",
  "announcement_archived",
  "staff_sign_in",
  "requests_exported",
]);

let serviceSupabaseClient = null;

export function getServiceSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service configuration is missing.");
  }

  if (!serviceSupabaseClient) {
    serviceSupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceSupabaseClient;
}

export async function logAuditEvent(
  supabase,
  { eventType, actorId, recordId, metadata = {} },
) {
  if (!eventType) {
    throw new Error("Audit event type is required.");
  }

  const resolvedActorId = actorId || process.env.AUDIT_SYSTEM_ACTOR_ID || null;
  const payload = {
    event_type: eventType,
    actor_id: resolvedActorId,
    related_record_id: recordId ? String(recordId) : null,
    metadata,
  };

  const { error } = await supabase.from("audit_logs").insert(payload);

  if (error) {
    if (HIGH_VALUE_AUDIT_EVENTS.has(eventType)) {
      console.error("[audit] High-value audit write failed", {
        eventType,
        recordId: payload.related_record_id,
        actorId: payload.actor_id,
        metadata: payload.metadata,
        error: error.message || "Unknown audit insert error.",
      });
      await captureAuditWriteFailure(supabase, payload, error);
    }

    throw error;
  }
}

async function captureAuditWriteFailure(supabase, payload, error) {
  try {
    const { error: fallbackError } = await supabase
      .from("audit_write_failures")
      .insert({
        event_type: payload.event_type,
        payload,
        error: error.message || String(error),
      });

    if (fallbackError) {
      console.error("[audit] Failed to capture audit write failure", {
        eventType: payload.event_type,
        recordId: payload.related_record_id,
        error: fallbackError.message || "Unknown audit failure capture error.",
      });
    }
  } catch (fallbackError) {
    console.error("[audit] Failed to capture audit write failure", {
      eventType: payload.event_type,
      recordId: payload.related_record_id,
      error: fallbackError instanceof Error ? fallbackError.message : "Unknown audit failure capture error.",
    });
  }
}

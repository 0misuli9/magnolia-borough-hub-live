import { createClient } from "@supabase/supabase-js";

const FALLBACK_SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

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

  const resolvedActorId = actorId || process.env.AUDIT_SYSTEM_ACTOR_ID || FALLBACK_SYSTEM_ACTOR_ID;

  const { error } = await supabase.from("audit_logs").insert({
    event_type: eventType,
    actor_id: resolvedActorId,
    related_record_id: recordId ? String(recordId) : null,
    metadata,
  });

  if (error) {
    throw error;
  }
}

import { createClient } from "@supabase/supabase-js";

let publicSupabaseClient = null;

function getPublicSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase public configuration is missing.");
  }

  if (!publicSupabaseClient) {
    publicSupabaseClient = createClient(supabaseUrl, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return publicSupabaseClient;
}

function getMatchedTopics(messageText) {
  const normalizedText = String(messageText || "").toLowerCase();
  const topics = [];

  if (/\b(trash|garbage|bulk|pickup|collection|sanitation)\b/.test(normalizedText)) {
    topics.push("trash");
  }

  if (/\b(recycle|recycling|recyclables)\b/.test(normalizedText)) {
    topics.push("recycling");
  }

  if (/\b(hours?|open|close|closed|borough hall|office)\b/.test(normalizedText)) {
    topics.push("hours");
  }

  return topics;
}

function isActiveRecord(record) {
  return (
    record &&
    record.active !== false &&
    record.is_active !== false &&
    record.status !== "inactive" &&
    record.status !== "archived"
  );
}

function getRecordText(record) {
  return [
    record.fact_key,
    record.fact_type,
    record.fact_name,
    record.fact_value,
    record.topic,
    record.category,
    record.title,
    record.value,
    record.content,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function matchesTopic(record, topic) {
  const text = getRecordText(record);

  if (topic === "trash") {
    return /trash|garbage|bulk|pickup|collection|sanitation/.test(text);
  }

  if (topic === "recycling") {
    return /recycl/.test(text);
  }

  if (topic === "hours") {
    return /hours|office|borough hall|open|close/.test(text);
  }

  return false;
}

function recordToFact(record) {
  const label = record.fact_key || record.fact_type || record.topic || record.category || record.title || "Fact";
  const value = record.fact_value || record.value || record.content || record.description || "";

  if (!value) {
    return null;
  }

  return `${label}: ${value}`;
}

export async function fetchRelevantKnowledgeFacts(messageText) {
  const topics = getMatchedTopics(messageText);

  if (!topics.length) {
    return [];
  }

  const supabase = getPublicSupabaseClient();
  const { data, error } = await supabase.from("borough_knowledge").select("*");

  if (error) {
    throw error;
  }

  return (Array.isArray(data) ? data : [])
    .filter(isActiveRecord)
    .filter((record) => topics.some((topic) => matchesTopic(record, topic)))
    .map(recordToFact)
    .filter(Boolean);
}

export function buildDynamicKnowledgePrompt(basePrompt, facts) {
  if (!facts.length) {
    return basePrompt;
  }

  return `${basePrompt}

DYNAMIC BOROUGH KNOWLEDGE:
You are the Magnolia Borough Assistant. Use these facts as your primary source:
${facts.map((fact) => `- ${fact}`).join("\n")}
Do not hallucinate. If the dynamic facts conflict with older static facts, use the dynamic facts.`;
}

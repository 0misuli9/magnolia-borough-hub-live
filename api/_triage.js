import { TRIAGE_CONFIG } from "../config/borough.js";
import { normalizeCategory, normalizeStatus } from "./_http.js";

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getAgeDays(value) {
  const timestamp = new Date(value || 0).getTime();

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

function urgencyTier(categoryScore) {
  if (categoryScore >= 70) return "high";
  if (categoryScore >= 40) return "medium";
  return "low";
}

function normalizeAddressKey(value) {
  return String(value || "")
    .toLowerCase()
    .split(",")[0]
    .replace(/\b\d+[a-z]?\b/g, "")
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function countSimilarActiveRequests(record, allRecords) {
  const category = normalizeCategory(record.category);
  const addressKey = normalizeAddressKey(record.address);

  if (!category || !addressKey) {
    return 0;
  }

  return allRecords.filter((candidate) => {
    if (candidate === record) return false;
    if (!["open", "in_progress"].includes(normalizeStatus(candidate.status))) return false;
    if (normalizeCategory(candidate.category) !== category) return false;
    return normalizeAddressKey(candidate.address) === addressKey;
  }).length;
}

export function computeRequestTriage(record, allRecords = []) {
  const status = normalizeStatus(record.status);

  if (!["open", "in_progress"].includes(status)) {
    return {
      score: 0,
      level: "Low",
      badges: [],
      factors: ["Resolved or closed"],
    };
  }

  const category = normalizeCategory(record.category);
  const categoryUrgency = TRIAGE_CONFIG.categoryUrgency[category] ?? TRIAGE_CONFIG.categoryUrgency.Other;
  const categoryScore = categoryUrgency * 0.4;
  const ageDays = getAgeDays(record.created_at);
  const ageScore = Math.min(30, ageDays * 3);
  const tier = urgencyTier(categoryUrgency);
  const slaTargetDays = TRIAGE_CONFIG.slaTargetDays[tier] || TRIAGE_CONFIG.slaTargetDays.medium;
  const slaBreached = ageDays > slaTargetDays;
  const similarCount = countSimilarActiveRequests(record, allRecords);
  const duplicateScore = Math.min(15, similarCount * 5);
  const score = clampScore(categoryScore + ageScore + (slaBreached ? 20 : 0) + duplicateScore);
  const level =
    score >= TRIAGE_CONFIG.triageThresholds.high
      ? "High"
      : score >= TRIAGE_CONFIG.triageThresholds.medium
        ? "Medium"
        : "Low";
  const badges = [];
  const factors = [];
  const updatedDays = getAgeDays(record.updated_at || record.created_at);

  if (ageDays <= TRIAGE_CONFIG.agingThresholds.newMaxDays) {
    badges.push("New");
  } else if (ageDays <= TRIAGE_CONFIG.agingThresholds.agingMaxDays) {
    badges.push("Aging");
  } else {
    badges.push("Overdue");
  }

  if (slaBreached && !badges.includes("Overdue")) {
    badges.push("Overdue");
  }

  if (status === "open" && updatedDays >= TRIAGE_CONFIG.agingThresholds.needsReviewDays) {
    badges.push("Needs Review");
  }

  factors.push(`${tier === "high" ? "High" : tier === "medium" ? "Moderate" : "Lower"} urgency category`);
  factors.push(`${ageDays} ${ageDays === 1 ? "day" : "days"} open`);

  if (slaBreached) {
    factors.push("SLA target passed");
  }

  if (similarCount > 0) {
    factors.push(`${similarCount + 1} similar reports`);
  }

  return {
    score,
    level,
    badges,
    factors,
  };
}

export function manualPriorityRank(priority) {
  const value = String(priority || "normal").toLowerCase();
  return { urgent: 4, high: 3, normal: 2, low: 1 }[value] || 2;
}

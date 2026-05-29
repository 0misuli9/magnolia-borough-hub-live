export const TRIAGE_CONFIG = {
  // 0-100 category weights. Future municipalities can tune these by service category.
  categoryUrgency: {
    "Roads & Infrastructure": 80,
    "Utilities & Lighting": 85,
    "Parks & Public Spaces": 35,
    "Sanitation & Trash": 50,
    "Noise & Safety": 90,
    "Permits & Zoning": 25,
    "Other": 30,
  },
  // Target days to first staff action by computed urgency tier.
  slaTargetDays: {
    high: 2,
    medium: 5,
    low: 10,
  },
  // Score cutoffs for staff-facing triage labels.
  triageThresholds: {
    high: 60,
    medium: 30,
  },
  // Staff-facing age badges.
  agingThresholds: {
    newMaxDays: 2,
    agingMaxDays: 5,
    overdueMinDays: 6,
    needsReviewDays: 2,
  },
};

export const TRACKING_CONFIG = {
  alphabet: "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
  generatedLength: 8,
  example: "MGN-7K9Q2M8P",
  legacyPattern: "MGN-####",
};

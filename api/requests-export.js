import { getServiceSupabaseClient, logAuditEvent } from "./_audit.js";
import { requireStaff } from "./_staff-auth.js";
import {
  getMethodNotAllowed,
  getQueryParam,
  normalizeCategory,
  normalizeStatus,
  sendJson,
} from "./_http.js";

const REQUESTS_TABLE = process.env.SUPABASE_REQUESTS_TABLE || "requests";
const PAGE_SIZE = 500;

const BASE_COLUMNS = [
  ["tracking_number", "Tracking Number"],
  ["category", "Category"],
  ["status", "Status"],
  ["priority", "Priority"],
  ["created_at", "Created At"],
  ["updated_at", "Updated At"],
  ["deleted_at", "Deleted At"],
  ["address", "Address"],
  ["description", "Description"],
  ["assigned_to", "Assigned To"],
  ["source", "Source"],
];

function csvCell(value) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  const text = String(value).replace(/\r?\n/g, " ");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRow(values) {
  return `${values.map(csvCell).join(",")}\r\n`;
}

function normalizeIsoDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function buildExportFilters(req) {
  const status = normalizeStatus(getQueryParam(req, "status"), "");
  const category = getQueryParam(req, "category");
  const createdFrom = normalizeIsoDate(getQueryParam(req, "created_from"));
  const createdTo = normalizeIsoDate(getQueryParam(req, "created_to"));
  const updatedFrom = normalizeIsoDate(getQueryParam(req, "updated_from"));
  const updatedTo = normalizeIsoDate(getQueryParam(req, "updated_to"));

  return {
    status,
    category: category ? normalizeCategory(category) : "",
    createdFrom,
    createdTo,
    updatedFrom,
    updatedTo,
    includeDeleted: getQueryParam(req, "include_deleted") === "1",
    includeInternalNotes: getQueryParam(req, "include_internal_notes") === "1",
  };
}

function applyFilters(query, filters) {
  let nextQuery = query;

  if (!filters.includeDeleted) {
    nextQuery = nextQuery.is("deleted_at", null);
  }

  if (filters.status) {
    nextQuery = nextQuery.eq("status", filters.status);
  }

  if (filters.category) {
    nextQuery = nextQuery.eq("category", filters.category);
  }

  if (filters.createdFrom) {
    nextQuery = nextQuery.gte("created_at", filters.createdFrom);
  }

  if (filters.createdTo) {
    nextQuery = nextQuery.lte("created_at", filters.createdTo);
  }

  if (filters.updatedFrom) {
    nextQuery = nextQuery.gte("updated_at", filters.updatedFrom);
  }

  if (filters.updatedTo) {
    nextQuery = nextQuery.lte("updated_at", filters.updatedTo);
  }

  return nextQuery;
}

async function fetchExportPage(supabase, filters, from, to) {
  const query = applyFilters(
    supabase
      .from(REQUESTS_TABLE)
      .select("*")
      .order("created_at", { ascending: false })
      .range(from, to),
    filters,
  );

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return Array.isArray(data) ? data : [];
}

function rowValues(record, columns) {
  return columns.map(([key]) => record[key] || "");
}

function publicFilterSummary(filters) {
  return {
    status: filters.status || null,
    category: filters.category || null,
    createdFrom: filters.createdFrom || null,
    createdTo: filters.createdTo || null,
    updatedFrom: filters.updatedFrom || null,
    updatedTo: filters.updatedTo || null,
    includeDeleted: filters.includeDeleted,
    includeInternalNotes: filters.includeInternalNotes,
  };
}

async function auditExport(staff, rowCount, filters) {
  try {
    await logAuditEvent(getServiceSupabaseClient(), {
      eventType: "requests_exported",
      actorId: staff.user.id,
      recordId: null,
      metadata: {
        rowCount,
        filters: publicFilterSummary(filters),
      },
    });
  } catch (error) {
    console.error("[api/requests-export] Failed to write export audit", {
      rowCount,
      error: error instanceof Error ? error.message : "Unknown audit error.",
    });
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return getMethodNotAllowed(res, ["GET"]);
  }

  const staff = await requireStaff(req, res);
  if (!staff) {
    return;
  }

  const supabase = getServiceSupabaseClient();
  const filters = buildExportFilters(req);
  const columns = filters.includeInternalNotes
    ? BASE_COLUMNS.concat([["internal_notes", "Internal Notes"]])
    : BASE_COLUMNS;

  try {
    const firstPage = await fetchExportPage(supabase, filters, 0, PAGE_SIZE - 1);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="magnolia-requests-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(csvRow(columns.map(([, label]) => label)));

    let rowCount = 0;
    let page = firstPage;
    let offset = 0;

    while (page.length) {
      for (const record of page) {
        res.write(csvRow(rowValues(record, columns)));
        rowCount += 1;
      }

      if (page.length < PAGE_SIZE) {
        break;
      }

      offset += PAGE_SIZE;
      page = await fetchExportPage(supabase, filters, offset, offset + PAGE_SIZE - 1);
    }

    await auditExport(staff, rowCount, filters);
    res.end();
  } catch (error) {
    console.error("[api/requests-export] Export failed", {
      message: error instanceof Error ? error.message : "Unknown export error.",
    });

    if (!res.headersSent) {
      return sendJson(res, 500, {
        success: false,
        error: "REQUEST_EXPORT_FAILED",
        message: "Unable to export request records.",
      });
    }

    res.end();
  }
}

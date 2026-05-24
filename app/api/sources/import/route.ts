/**
 * POST /api/sources/import
 *
 * Accepts a multipart/form-data upload with a YAML or CSV file
 * containing job sources and upserts them into JobSource + UserJobSource.
 *
 * Query params:
 *   ?preview=true  — parse and validate but do not write to DB
 *
 * Form fields:
 *   file  — the uploaded file (.yml / .yaml / .csv)
 *
 * Expected YAML shape (sources key):
 *   sources:
 *     - company: Acme Corp
 *       provider: greenhouse
 *       boardToken: acme
 *       enabled: true
 *       priority: 5
 *       tags: [backend, fintech]
 *
 * Expected CSV columns (header row required):
 *   company,provider,boardToken,url,enabled,priority,tags
 *
 * Response:
 *   { ok, preview, summary: { created, updated, skipped, invalid }, rows, errors }
 */
import { NextResponse, type NextRequest } from "next/server";
import yaml from "yaml";
import { prisma } from "@/lib/prisma";
import { tryGetSessionUserId } from "@/lib/get-user-id";

export const dynamic = "force-dynamic";

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_URL_TEMPLATES: Record<string, string> = {
  GREENHOUSE: "https://boards-api.greenhouse.io/v1/boards/{boardToken}/jobs?content=true",
  LEVER:      "https://api.lever.co/v0/postings/{boardToken}",
  ASHBY:      "https://api.ashbyhq.com/posting-api/job-board/{boardToken}",
};

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB

// ── Types ─────────────────────────────────────────────────────────────────────

interface SourceRow {
  rowIndex: number;
  company: string;
  provider: string;
  boardToken: string | null;
  url: string | null;
  enabled: boolean;
  priority: number;
  tags: string[];
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeProvider(raw: string): string {
  const up = (raw ?? "").toUpperCase().trim();
  if (["GREENHOUSE", "LEVER", "ASHBY"].includes(up)) return up;
  return "CUSTOM";
}

function buildUrl(provider: string, boardToken: string | null, explicitUrl: string | null): string | null {
  if (explicitUrl) return explicitUrl.trim();
  const template = PROVIDER_URL_TEMPLATES[provider];
  if (template && boardToken) return template.replace("{boardToken}", boardToken.trim());
  return null;
}

function safeArray(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === "string") return val.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}

// ── CSV parser ────────────────────────────────────────────────────────────────
// Handles quoted fields and basic escaping — no external dependency needed.

function parseCSV(text: string): Array<Record<string, string>> {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];

  function splitRow(line: string): string[] {
    const cells: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cur); cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  }

  const headers = splitRow(lines[0]).map((h) => h.toLowerCase().trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] ?? ""; });
    rows.push(row);
  }
  return rows;
}

// ── YAML → SourceRow[] ────────────────────────────────────────────────────────

function parseYamlSources(text: string): { rows: SourceRow[]; parseErrors: string[] } {
  const parseErrors: string[] = [];
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (err) {
    parseErrors.push(`YAML parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { rows: [], parseErrors };
  }

  if (typeof parsed !== "object" || parsed === null) {
    parseErrors.push("YAML root must be an object");
    return { rows: [], parseErrors };
  }

  const obj = parsed as Record<string, unknown>;
  const rawSources = Array.isArray(obj.sources) ? obj.sources : [];

  const rows: SourceRow[] = rawSources.map((s: unknown, idx: number) => {
    if (typeof s !== "object" || s === null) return null;
    const src = s as Record<string, unknown>;
    return {
      rowIndex: idx + 1,
      company:    typeof src.company === "string" ? src.company.trim() : "",
      provider:   normalizeProvider(String(src.provider ?? "")),
      boardToken: typeof src.boardToken === "string" ? src.boardToken.trim() : null,
      url:        typeof src.url === "string" ? src.url.trim() : null,
      enabled:    src.enabled !== false,
      priority:   typeof src.priority === "number" ? src.priority : 0,
      tags:       safeArray(src.tags),
    };
  }).filter((r): r is SourceRow => r !== null);

  return { rows, parseErrors };
}

// ── CSV → SourceRow[] ─────────────────────────────────────────────────────────

function parseCsvSources(text: string): { rows: SourceRow[]; parseErrors: string[] } {
  const parseErrors: string[] = [];
  let csvRows: Array<Record<string, string>>;
  try {
    csvRows = parseCSV(text);
  } catch (err) {
    parseErrors.push(`CSV parse error: ${err instanceof Error ? err.message : String(err)}`);
    return { rows: [], parseErrors };
  }

  if (csvRows.length === 0) {
    parseErrors.push("CSV has no data rows (header row only or empty file)");
    return { rows: [], parseErrors };
  }

  const rows: SourceRow[] = csvRows.map((r, idx) => ({
    rowIndex:   idx + 1,
    company:    (r.company ?? r.name ?? "").trim(),
    provider:   normalizeProvider(r.provider ?? r.type ?? ""),
    boardToken: (r.boardtoken ?? r.board_token ?? r.boardToken ?? "").trim() || null,
    url:        (r.url ?? r.apiurl ?? r.api_url ?? "").trim() || null,
    enabled:    (r.enabled ?? "true").toLowerCase() !== "false",
    priority:   parseInt(r.priority ?? "0", 10) || 0,
    tags:       safeArray(r.tags ?? r.tag ?? ""),
  }));

  return { rows, parseErrors };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateRows(rows: SourceRow[]): { valid: SourceRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const valid: SourceRow[] = [];

  for (const row of rows) {
    let rowOk = true;

    if (!row.company) {
      errors.push({ row: row.rowIndex, field: "company", message: "company is required" });
      rowOk = false;
    }

    const url = buildUrl(row.provider, row.boardToken, row.url);
    if (!url) {
      errors.push({
        row: row.rowIndex,
        field: row.provider === "CUSTOM" ? "url" : "boardToken",
        message: row.provider === "CUSTOM"
          ? "url is required for CUSTOM provider"
          : `boardToken or url required for ${row.provider}`,
      });
      rowOk = false;
    }

    if (rowOk) valid.push({ ...row, url });
  }

  return { valid, errors };
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertSources(
  rows: SourceRow[],
  userId: string,
): Promise<{ summary: ImportSummary; errors: RowError[] }> {
  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, invalid: 0 };
  const errors: RowError[] = [];

  for (const row of rows) {
    const url = row.url!; // already validated
    try {
      const existing = await prisma.jobSource.findUnique({ where: { url } });

      const jobSource = await prisma.jobSource.upsert({
        where: { url },
        create: {
          company:    row.company,
          provider:   row.provider,
          boardToken: row.boardToken,
          url,
          enabled:    row.enabled,
          priority:   row.priority,
          tags:       JSON.stringify(row.tags),
        },
        update: {
          company:    row.company,
          provider:   row.provider,
          boardToken: row.boardToken,
          enabled:    row.enabled,
          priority:   row.priority,
          tags:       JSON.stringify(row.tags),
        },
      });

      if (existing) summary.updated++;
      else summary.created++;

      // Upsert per-user source link
      await prisma.userJobSource.upsert({
        where:  { userId_sourceId: { userId, sourceId: jobSource.id } },
        create: { userId, sourceId: jobSource.id, enabled: row.enabled, priority: row.priority },
        update: { enabled: row.enabled, priority: row.priority },
      });
    } catch (err) {
      summary.skipped++;
      errors.push({
        row:     row.rowIndex,
        field:   "db",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { summary, errors };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const userId = await tryGetSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isPreview = request.nextUrl.searchParams.get("preview") === "true";

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file field in form data" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_FILE_BYTES / 1024}KB)` }, { status: 413 });
  }

  const filename = file.name.toLowerCase();
  const isYaml = filename.endsWith(".yml") || filename.endsWith(".yaml");
  const isCsv  = filename.endsWith(".csv");

  if (!isYaml && !isCsv) {
    return NextResponse.json({ error: "Unsupported file type — use .yml, .yaml, or .csv" }, { status: 400 });
  }

  const text = await file.text();

  // Parse
  const { rows, parseErrors } = isYaml
    ? parseYamlSources(text)
    : parseCsvSources(text);

  if (parseErrors.length > 0) {
    return NextResponse.json({ ok: false, parseErrors, rows: [] }, { status: 422 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: "No source rows found in file", rows: [] }, { status: 422 });
  }

  // Validate
  const { valid, errors: validationErrors } = validateRows(rows);
  const invalidCount = rows.length - valid.length;

  if (isPreview) {
    return NextResponse.json({
      ok:      true,
      preview: true,
      rows:    valid,
      summary: { created: 0, updated: 0, skipped: 0, invalid: invalidCount },
      errors:  validationErrors,
    });
  }

  // Save
  const { summary, errors: dbErrors } = await upsertSources(valid, userId);
  summary.invalid = invalidCount;

  return NextResponse.json({
    ok:      true,
    preview: false,
    summary,
    errors:  [...validationErrors, ...dbErrors],
  });
}

import { PrismaClient } from "@prisma/client";
import { extractCompany, normalizeProvider } from "../lib/source-utils";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import path from "node:path";

type SourceInput = {
  company?: string | null;
  provider?: string | null;
  url: string;
};

const prisma = new PrismaClient();

function getArgValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getSourceFile() {
  return (
    getArgValue("--file") ??
    process.env.JOB_SOURCE_FILE ??
    "C:/Users/joshi/CascadeProjects/windsurf-project-2/cronfetcher/public_job_api_targets_321.xlsx"
  );
}

function readTextSources(filePath: string): SourceInput[] {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((url) => ({ url }));
}

function readWorkbookSources(filePath: string): SourceInput[] {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets.Targets ?? workbook.Sheets[workbook.SheetNames[0]];

  if (!sheet) {
    throw new Error("Workbook has no sheets to import.");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  return rows.reduce<SourceInput[]>((sources, row) => {
    const url = String(row["Public Endpoint"] ?? row.url ?? "").trim();
    if (!url) return sources;

    sources.push({
        company: String(row.Company ?? "").trim() || null,
        provider: String(row["ATS Platform"] ?? "").trim() || null,
        url,
    });

    return sources;
  }, []);
}

function readSources(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".xlsx" || extension === ".xls") {
    return readWorkbookSources(filePath);
  }

  return readTextSources(filePath);
}

async function main() {
  const sourceFile = getSourceFile();
  const sources = readSources(sourceFile);

  if (sources.length === 0) {
    throw new Error(`No source URLs found in ${sourceFile}`);
  }

  let created = 0;
  let updated = 0;

  for (const source of sources) {
    const provider = normalizeProvider(source.provider, source.url);
    const company = extractCompany(source.url, source.company);
    const existing = await prisma.jobSource.findUnique({
      where: { url: source.url },
      select: { id: true },
    });

    await prisma.jobSource.upsert({
      where: { url: source.url },
      create: {
        company,
        provider,
        url: source.url,
        enabled: true,
      },
      update: {
        company,
        provider,
        enabled: true,
      },
    });

    if (existing) {
      updated += 1;
    } else {
      created += 1;
    }
  }

  console.log(
    `Imported ${sources.length} sources from ${sourceFile}: ${created} created, ${updated} updated.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

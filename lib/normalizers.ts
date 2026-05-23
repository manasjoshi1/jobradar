export function cleanHtmlToText(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;

  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();

  return text || undefined;
}

export function normalizeLocation(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.replace(/\s+/g, " ").trim() || undefined;
  }

  if (value && typeof value === "object" && "name" in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === "string" ? normalizeLocation(name) : undefined;
  }

  return undefined;
}

export function parseDateSafe(value: unknown): string | undefined {
  if (!value) return undefined;

  const date =
    typeof value === "number" || typeof value === "string"
      ? new Date(value)
      : undefined;

  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function ensureAbsoluteApplyUrl(url: string, baseUrl?: string): string {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) return "";

  try {
    return new URL(trimmedUrl, baseUrl).toString();
  } catch {
    return trimmedUrl;
  }
}

export type Provider = "GREENHOUSE" | "LEVER" | "ASHBY" | "CUSTOM";

export function detectProvider(url: string): Provider {
  const normalizedUrl = url.toLowerCase();

  if (normalizedUrl.includes("greenhouse.io")) return "GREENHOUSE";
  if (normalizedUrl.includes("lever.co")) return "LEVER";
  if (normalizedUrl.includes("ashbyhq.com")) return "ASHBY";
  return "CUSTOM";
}

export function normalizeProvider(value: string | null | undefined, url: string) {
  const normalized = value?.trim().toUpperCase() ?? "";

  if (normalized.includes("GREENHOUSE")) return "GREENHOUSE";
  if (normalized.includes("LEVER")) return "LEVER";
  if (normalized.includes("ASHBY")) return "ASHBY";
  if (normalized.includes("CUSTOM") || normalized.includes("PUBLIC")) {
    return "CUSTOM";
  }

  return detectProvider(url);
}

export function extractCompany(url: string, fallback?: string | null) {
  const trimmedFallback = fallback?.trim();
  if (trimmedFallback) return trimmedFallback;

  try {
    const parsedUrl = new URL(url);
    const parts = parsedUrl.pathname.split("/").filter(Boolean);
    const boardIndex = parts.indexOf("boards");
    const postingsIndex = parts.indexOf("postings");
    const jobBoardIndex = parts.indexOf("job-board");

    if (boardIndex >= 0 && parts[boardIndex + 1]) return parts[boardIndex + 1];
    if (postingsIndex >= 0 && parts[postingsIndex + 1]) {
      return parts[postingsIndex + 1];
    }
    if (jobBoardIndex >= 0 && parts[jobBoardIndex + 1]) {
      return parts[jobBoardIndex + 1];
    }

    return parsedUrl.hostname.replace(/^www\./, "").split(".")[0] || "custom";
  } catch {
    return "custom";
  }
}

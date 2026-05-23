import type { Sponsorship } from "./types";

const NO_PATTERNS = [
  "we do not sponsor",
  "no visa sponsorship",
  "unable to sponsor",
  "will not sponsor",
  "without sponsorship",
  "must be authorized to work",
  "must be legally authorized",
  "not sponsor",
];

const YES_PATTERNS = [
  "visa sponsorship",
  "sponsor visa",
  "sponsorship available",
  "h-1b",
  "h1b",
  "opt",
  "cpt",
  "work authorization sponsorship",
];

export function detectSponsorship(
  text: string | null | undefined,
): Sponsorship {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return "UNKNOWN";

  if (NO_PATTERNS.some((pattern) => normalizedText.includes(pattern))) {
    return "NO";
  }

  if (YES_PATTERNS.some((pattern) => normalizedText.includes(pattern))) {
    return "YES";
  }

  return "UNKNOWN";
}

function normalizeText(text: string | null | undefined) {
  return text?.toLowerCase().replace(/\s+/g, " ").trim() ?? "";
}

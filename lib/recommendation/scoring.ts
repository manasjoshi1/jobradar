/**
 * Deterministic scoring of a Job against a RoleProfile.
 *
 * Scoring weights:
 *   +25  title matches preferredTitles
 *   +6   per mustHaveKeyword match (in combined text)
 *   +4   per niceHaveKeyword match
 *   +8   location matches preferredLocations
 *   +5   sponsorship YES or UNKNOWN (acceptable)
 *   -20  per negativeKeyword match
 *   -25  seniority mismatch (staff/principal/director/vp/manager in title, profile doesn't target those)
 *   -15  internship-only mismatch
 *
 * Hard gates (reject before scoring):
 *   - At least one preferred title OR one must-have keyword must match
 *   - negativeKeyword strongly matches title → reject
 *   - sponsorship NO + profile requiresSponsorship=true → reject
 *
 * Score clamped 0–100.
 */

export type ScoreResult = {
  score: number;
  matched: string[];
  negatives: string[];
  reason: string;
  qualified: boolean;
};

type Profile = {
  preferredTitles: string;
  preferredLocations: string;
  mustHaveKeywords: string;
  niceHaveKeywords: string;
  negativeKeywords: string;
  requiresSponsorship: boolean;
  minScore: number;
  name: string;
};

type Job = {
  title: string;
  company: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  description: string | null;
  sponsorship: string;
};

const SENIOR_NEGATIVE_TERMS = [
  "staff engineer",
  "principal engineer",
  "director",
  "vice president",
  " vp ",
  "vp of",
  "head of engineering",
  "chief ",
  "cto",
];

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((s) => String(s).toLowerCase().trim()) : [];
  } catch {
    return [];
  }
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function containsAny(haystack: string, needles: string[]): string[] {
  return needles.filter((n) => n && haystack.includes(n));
}

function containsAnyTitle(title: string, terms: string[]): boolean {
  return terms.some((t) => t && title.includes(t));
}

export function scoreJob(job: Job, profile: Profile): ScoreResult {
  const title = normalize(job.title);
  const location = normalize(job.location);
  const description = normalize(job.description);
  const department = normalize(job.department);
  const employmentType = normalize(job.employmentType);
  const company = normalize(job.company);

  const combined = [title, company, location, department, employmentType, description]
    .filter(Boolean)
    .join(" ");

  const preferredTitles = parseJsonArray(profile.preferredTitles);
  const preferredLocations = parseJsonArray(profile.preferredLocations);
  const mustHaveKeywords = parseJsonArray(profile.mustHaveKeywords);
  const niceHaveKeywords = parseJsonArray(profile.niceHaveKeywords);
  const negativeKeywords = parseJsonArray(profile.negativeKeywords);

  const matched: string[] = [];
  const negatives: string[] = [];

  // ── Hard gate: sponsorship ────────────────────────────────────────────────
  if (profile.requiresSponsorship && job.sponsorship === "NO") {
    return {
      score: 0,
      matched: [],
      negatives: ["sponsorship:no"],
      reason: "Rejected: company does not sponsor and profile requires sponsorship.",
      qualified: false,
    };
  }

  // ── Hard gate: negative keywords in title ─────────────────────────────────
  const titleNegatives = containsAny(title, negativeKeywords);
  if (titleNegatives.length > 0) {
    return {
      score: 0,
      matched: [],
      negatives: titleNegatives,
      reason: `Rejected: title contains negative keywords (${titleNegatives.join(", ")}).`,
      qualified: false,
    };
  }

  // ── Hard gate: must have at least one title match OR one mustHave match ───
  const titleMatch = containsAnyTitle(title, preferredTitles);
  const mustHaveMatches = containsAny(combined, mustHaveKeywords);
  const hasBaseSignal = titleMatch || mustHaveMatches.length > 0;

  if (!hasBaseSignal) {
    return {
      score: 0,
      matched: [],
      negatives: [],
      reason: "No matching title or must-have keywords found.",
      qualified: false,
    };
  }

  // ── Scoring ───────────────────────────────────────────────────────────────
  let score = 0;

  // Title match
  if (titleMatch) {
    score += 25;
    matched.push(`title:${title.slice(0, 50)}`);
  }

  // Must-have keywords
  for (const kw of mustHaveMatches) {
    score += 6;
    matched.push(kw);
  }

  // Nice-have keywords
  const niceMatches = containsAny(combined, niceHaveKeywords);
  for (const kw of niceMatches) {
    score += 4;
    matched.push(kw);
  }

  // Location
  const locationMatches = containsAny(location, preferredLocations);
  if (locationMatches.length > 0) {
    score += 8;
    matched.push(`location:${locationMatches[0]}`);
  }

  // Sponsorship bonus
  if (job.sponsorship === "YES" || job.sponsorship === "UNKNOWN") {
    score += 5;
  }

  // Negative keywords in combined text (not caught by title gate above)
  const combinedNegatives = containsAny(combined, negativeKeywords);
  for (const kw of combinedNegatives) {
    score -= 20;
    negatives.push(kw);
  }

  // Seniority mismatch: penalise very senior roles unless title terms are in preferredTitles
  const seniorMatch = SENIOR_NEGATIVE_TERMS.some((t) => title.includes(t));
  if (seniorMatch) {
    const isSeniorProfile = preferredTitles.some((pt) =>
      ["staff", "principal", "director", "vp", "head", "chief"].some((s) =>
        pt.includes(s),
      ),
    );
    if (!isSeniorProfile) {
      score -= 25;
      negatives.push("seniority-mismatch");
    }
  }

  // Internship mismatch
  const isInternship =
    title.includes("intern") ||
    employmentType.includes("intern") ||
    title.includes("co-op");
  const wantsInternship = preferredTitles.some(
    (pt) => pt.includes("intern") || pt.includes("co-op"),
  );
  if (isInternship && !wantsInternship) {
    score -= 15;
    negatives.push("internship-mismatch");
  }

  // Clamp
  score = Math.min(100, Math.max(0, score));

  // ── Reason ────────────────────────────────────────────────────────────────
  const keyHighlights = matched
    .filter((m) => !m.startsWith("title:") && !m.startsWith("location:"))
    .slice(0, 5);

  let reason = "";
  if (titleMatch && keyHighlights.length > 0) {
    reason = `Strong ${profile.name} fit: title match + ${keyHighlights.join(", ")}.`;
  } else if (titleMatch) {
    reason = `Title matches ${profile.name} profile.`;
  } else {
    reason = `Keyword matches for ${profile.name}: ${keyHighlights.join(", ")}.`;
  }

  if (negatives.length > 0 && score < 50) {
    reason += ` Note: penalised for ${negatives.slice(0, 3).join(", ")}.`;
  }

  const qualified = score >= profile.minScore;

  return { score, matched, negatives, reason, qualified };
}

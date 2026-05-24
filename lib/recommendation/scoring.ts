/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  JobRadar · Elite Scoring Engine v2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Design goals:
 *  - Word-boundary matching:  "react" ≠ "reactive" / "proactively"
 *  - Tiered fields:           title > department > description (diminishing returns)
 *  - Skill synonym clusters:  react/reactjs/next.js counted as one cluster
 *  - Freshness bonus:         new jobs surface first (market is brutal)
 *  - Seniority matching:      junior/mid/senior/staff levels inferred + matched
 *  - Employment type aware:   contract / intern / part-time penalised when unwanted
 *  - Location intelligence:   remote / hybrid / on-site parsed separately from geo
 *  - Score distribution:      min 10 for qualified, clamped 0–100
 *
 * Scoring weights (total possible positive ≈ 115 before clamp):
 *  +30   exact preferred title phrase in title
 *  +18   any preferred title word in title (partial)
 *  +12   per mustHave in title (cap 3 keywords → max +36)
 *  +6    per mustHave in department/type (cap 3 → max +18)
 *  +3    per mustHave in description (cap 5 → max +15)
 *  +8    per niceHave in title (cap 2 → max +16)
 *  +4    per niceHave in department/type (cap 2 → max +8)
 *  +2    per niceHave in description (cap 6 → max +12)
 *  +10   preferred location exact/contained
 *  +8    remote work (if preferredLocations contains "remote")
 *  +8    visa sponsorship YES
 *  +3    visa sponsorship UNKNOWN (acceptable)
 *  +8    posted/first-seen within last 24 h (freshness)
 *  +4    posted/first-seen within last 48 h
 *  +3    full-time employment type
 *  +3    per skill cluster fully matched (cap 3 → max +9)
 *  +3    seniority level matches profile level
 *
 * Hard rejections (before scoring):
 *  – sponsorship=NO + requiresSponsorship
 *  – negative keyword in title (word-boundary)
 *  – no title match AND no mustHave match
 *
 * Penalties:
 *  –30   seniority mismatch (staff/principal for non-senior profile)
 *  –20   internship when profile doesn't want it
 *  –15   contract/temp when profile targets full-time
 *  –8    per negative keyword in department/type (cap 2)
 *  –4    per negative keyword in description (cap 5)
 */

export type ScoreResult = {
  score: number;
  matched: string[];
  negatives: string[];
  reason: string;
  qualified: boolean;
};

type Profile = {
  name: string;
  preferredTitles: string;
  preferredLocations: string;
  mustHaveKeywords: string;
  niceHaveKeywords: string;
  negativeKeywords: string;
  requiresSponsorship: boolean;
  minScore: number;
};

type Job = {
  title: string;
  company: string;
  location: string | null;
  department: string | null;
  employmentType: string | null;
  description: string | null;
  sponsorship: string;
  postedAt?: string | Date | null;
  firstSeenAt?: string | Date | null;
  effectiveNewAt?: string | Date | null;
};

// ── Skill synonym clusters ────────────────────────────────────────────────────
// If ANY term in a cluster is found, the whole cluster counts as ONE matched signal.
const SKILL_CLUSTERS: Record<string, string[]> = {
  "react":        ["react", "reactjs", "react.js"],
  "nextjs":       ["next.js", "nextjs", "next js"],
  "typescript":   ["typescript", "ts", "tsx"],
  "python":       ["python", "django", "flask", "fastapi"],
  "ml/ai":        ["machine learning", "ml", "artificial intelligence", "deep learning", "llm", "large language model", "nlp"],
  "data-science": ["data science", "data scientist", "pandas", "numpy", "scikit"],
  "sql":          ["sql", "postgres", "postgresql", "mysql", "sqlite", "bigquery", "redshift"],
  "cloud":        ["aws", "amazon web services", "azure", "gcp", "google cloud"],
  "kubernetes":   ["kubernetes", "k8s", "docker", "containerization"],
  "node":         ["node.js", "nodejs", "node js", "express", "fastify"],
  "vue":          ["vue", "vuejs", "vue.js", "nuxt"],
  "java":         ["java", "spring", "spring boot"],
  "go":           ["golang", " go ", "go lang"],
  "rust":         ["rust", "cargo"],
  "mobile":       ["ios", "android", "react native", "flutter", "swift", "kotlin"],
  "graphql":      ["graphql", "apollo"],
  "devops":       ["devops", "ci/cd", "github actions", "jenkins", "terraform", "ansible"],
};

// ── Seniority levels ──────────────────────────────────────────────────────────
const SENIORITY_SIGNALS: Record<string, number> = {
  "intern":      0,
  "co-op":       0,
  "junior":      1,
  "jr.":         1,
  "associate":   1,
  "entry level": 1,
  "entry-level": 1,
  // mid = 2 (default when no signal)
  "senior":      3,
  "sr.":         3,
  "sr ":         3,
  "lead":        3,
  "staff":       4,
  "principal":   4,
  "distinguished": 5,
  "director":    5,
  "vice president": 5,
  " vp ":        5,
  "vp of":       5,
  "head of":     5,
  "chief ":      5,
  "cto":         5,
  "ceo":         5,
  "president":   5,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((s) => String(s).toLowerCase().trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalize(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^\w\s.]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Word-boundary aware match. Handles terms with spaces as phrase matches.
 * Single word terms use \b boundaries; multi-word terms use space/start/end guards.
 */
function wordBoundaryMatch(haystack: string, term: string): boolean {
  if (!term) return false;
  try {
    // Escape regex special chars except spaces
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = term.includes(" ")
      ? `(^|\\s)${escaped}(\\s|$)`
      : `\\b${escaped}\\b`;
    return new RegExp(pattern).test(haystack);
  } catch {
    return haystack.includes(term);
  }
}

function matchAny(haystack: string, terms: string[]): string[] {
  return terms.filter((t) => t && wordBoundaryMatch(haystack, t));
}

function detectSeniority(title: string): number {
  let level = 2; // default: mid
  let matched = false;
  for (const [signal, lvl] of Object.entries(SENIORITY_SIGNALS)) {
    if (wordBoundaryMatch(title, signal.trim())) {
      if (!matched || lvl < level) {
        level = lvl;
        matched = true;
      }
    }
  }
  return level;
}

/** Detect the seniority level the profile is targeting from its preferredTitles */
function profileSeniorityLevel(preferredTitles: string[]): number {
  let max = 2;
  for (const pt of preferredTitles) {
    for (const [signal, lvl] of Object.entries(SENIORITY_SIGNALS)) {
      if (pt.includes(signal.trim())) max = Math.max(max, lvl);
    }
  }
  return max;
}

function freshnessHours(job: Job): number {
  const ref = job.effectiveNewAt ?? job.postedAt ?? job.firstSeenAt;
  if (!ref) return 999;
  const ageMs = Date.now() - new Date(ref).getTime();
  return ageMs / (1000 * 60 * 60);
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function scoreJob(job: Job, profile: Profile): ScoreResult {
  const title       = normalize(job.title);
  const location    = normalize(job.location);
  const description = normalize(job.description);
  const department  = normalize(job.department);
  const empType     = normalize(job.employmentType);

  const preferredTitles    = parseJsonArray(profile.preferredTitles);
  const preferredLocations = parseJsonArray(profile.preferredLocations);
  const mustHaveKeywords   = parseJsonArray(profile.mustHaveKeywords);
  const niceHaveKeywords   = parseJsonArray(profile.niceHaveKeywords);
  const negativeKeywords   = parseJsonArray(profile.negativeKeywords);

  const matched: string[] = [];
  const negatives: string[] = [];
  let score = 0;

  // ── Hard gate: sponsorship ──────────────────────────────────────────────────
  if (profile.requiresSponsorship && job.sponsorship === "NO") {
    return { score: 0, matched: [], negatives: ["sponsorship:no"],
      reason: "Rejected: company does not sponsor and profile requires sponsorship.",
      qualified: false };
  }

  // ── Hard gate: negative keywords in title (word-boundary) ──────────────────
  const titleNegHits = matchAny(title, negativeKeywords);
  if (titleNegHits.length > 0) {
    return { score: 0, matched: [], negatives: titleNegHits,
      reason: `Rejected: title contains "${titleNegHits[0]}".`,
      qualified: false };
  }

  // ── Hard gate: need at least one title OR mustHave match ───────────────────
  const titleExactMatch   = preferredTitles.find((pt) => title.includes(pt));
  const titlePartialMatch = !titleExactMatch
    ? preferredTitles.find((pt) => pt.split(" ").some((word) => word.length > 3 && wordBoundaryMatch(title, word)))
    : null;
  const mustInTitle = matchAny(title, mustHaveKeywords);
  const hasBaseSignal = titleExactMatch || titlePartialMatch || mustInTitle.length > 0;

  if (!hasBaseSignal) {
    return { score: 0, matched: [], negatives: [],
      reason: "No matching title or must-have keywords.",
      qualified: false };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POSITIVE SCORING
  // ─────────────────────────────────────────────────────────────────────────

  // Title match (exact phrase > partial)
  if (titleExactMatch) {
    score += 30;
    matched.push(`title:${titleExactMatch}`);
  } else if (titlePartialMatch) {
    score += 18;
    matched.push(`title~${titlePartialMatch}`);
  }

  // Must-have keywords — tiered by field
  const mustInDept  = matchAny(department + " " + empType, mustHaveKeywords);
  const mustInDesc  = matchAny(description, mustHaveKeywords);

  const titledMustAlready = new Set(mustInTitle);
  const deptMustNew = mustInDept.filter((k) => !titledMustAlready.has(k));
  const descMustNew = mustInDesc.filter((k) => !titledMustAlready.has(k) && !deptMustNew.includes(k));

  for (const kw of mustInTitle.slice(0, 3)) { score += 12; matched.push(kw); }
  for (const kw of deptMustNew.slice(0, 3))  { score += 6;  matched.push(kw); }
  for (const kw of descMustNew.slice(0, 5))  { score += 3;  matched.push(kw); }

  // Nice-have keywords — tiered
  const niceInTitle = matchAny(title, niceHaveKeywords);
  const niceInDept  = matchAny(department + " " + empType, niceHaveKeywords)
    .filter((k) => !niceInTitle.includes(k));
  const niceInDesc  = matchAny(description, niceHaveKeywords)
    .filter((k) => !niceInTitle.includes(k) && !niceInDept.includes(k));

  for (const kw of niceInTitle.slice(0, 2)) { score += 8; matched.push(kw); }
  for (const kw of niceInDept.slice(0, 2))  { score += 4; matched.push(kw); }
  for (const kw of niceInDesc.slice(0, 6))  { score += 2; matched.push(kw); }

  // Location scoring
  const wantsRemote = preferredLocations.some((l) => l.includes("remote"));
  const jobIsRemote = location.includes("remote") || location.includes("anywhere");
  const jobIsHybrid = location.includes("hybrid");

  if (wantsRemote && (jobIsRemote || jobIsHybrid)) {
    score += 8;
    matched.push(`location:remote`);
  } else {
    const geoMatches = matchAny(location, preferredLocations.filter((l) => !l.includes("remote")));
    if (geoMatches.length > 0) {
      score += 10;
      matched.push(`location:${geoMatches[0]}`);
    }
  }

  // Sponsorship
  if (job.sponsorship === "YES") {
    score += 8;
    matched.push("sponsorship:yes");
  } else if (job.sponsorship === "UNKNOWN") {
    score += 3;
  }

  // Freshness bonus — jobs < 24h surface first
  const ageH = freshnessHours(job);
  if (ageH < 24) {
    score += 8;
    matched.push("fresh:<24h");
  } else if (ageH < 48) {
    score += 4;
    matched.push("fresh:<48h");
  }

  // Employment type: full-time bonus
  const isFullTime = empType.includes("full") || empType.includes("permanent");
  if (isFullTime) score += 3;

  // Skill cluster bonus (word-boundary aware)
  const fullText = [title, department, empType, description].filter(Boolean).join(" ");
  let clusterHits = 0;
  for (const [clusterName, terms] of Object.entries(SKILL_CLUSTERS)) {
    if (clusterHits >= 3) break;
    const hit = terms.some((t) => wordBoundaryMatch(fullText, t));
    if (hit) {
      // Only credit it if cluster is relevant to the profile (mentioned in keywords)
      const allProfileKeywords = [...mustHaveKeywords, ...niceHaveKeywords].join(" ");
      const clusterRelevant = terms.some((t) => allProfileKeywords.includes(t)) ||
        clusterName.split("/").some((n) => allProfileKeywords.includes(n));
      if (clusterRelevant) {
        score += 3;
        matched.push(`cluster:${clusterName}`);
        clusterHits++;
      }
    }
  }

  // Seniority: +3 if level matches, -30 if serious mismatch
  const jobLevel     = detectSeniority(title);
  const profileLevel = profileSeniorityLevel(preferredTitles);

  if (jobLevel === profileLevel) {
    score += 3;
  } else if (jobLevel >= 4 && profileLevel <= 2) {
    // Staff/Principal for a mid-level profile
    score -= 30;
    negatives.push("seniority-mismatch:too-senior");
  } else if (jobLevel === 0 && profileLevel >= 2) {
    // Internship for non-intern profile — handled below too
    score -= 20;
    negatives.push("seniority-mismatch:internship");
  }

  // Internship / contract explicit checks
  const isInternship = title.includes("intern") || empType.includes("intern") || title.includes("co-op");
  const wantsInternship = preferredTitles.some((pt) => pt.includes("intern") || pt.includes("co-op"));
  if (isInternship && !wantsInternship) {
    if (!negatives.includes("seniority-mismatch:internship")) {
      score -= 20;
      negatives.push("internship-mismatch");
    }
  }

  const isContract = empType.includes("contract") || empType.includes("temp") || title.includes("contractor");
  const wantsContract = preferredTitles.some((pt) => pt.includes("contract")) ||
    mustHaveKeywords.includes("contract");
  if (isContract && !wantsContract) {
    score -= 15;
    negatives.push("contract-mismatch");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NEGATIVE SCORING (non-title — title negatives are a hard gate above)
  // ─────────────────────────────────────────────────────────────────────────
  const deptNegHits = matchAny(department + " " + empType, negativeKeywords);
  for (const kw of deptNegHits.slice(0, 2)) {
    score -= 8;
    negatives.push(kw);
  }

  const descNegHits = matchAny(description, negativeKeywords)
    .filter((k) => !deptNegHits.includes(k));
  for (const kw of descNegHits.slice(0, 5)) {
    score -= 4;
    negatives.push(kw);
  }

  // ── Clamp ─────────────────────────────────────────────────────────────────
  score = Math.min(100, Math.max(0, score));

  // ── Reason generation ─────────────────────────────────────────────────────
  const topSkills = matched
    .filter((m) => !m.startsWith("title") && !m.startsWith("location") && !m.startsWith("fresh") && !m.startsWith("cluster") && m !== "sponsorship:yes")
    .slice(0, 4);
  const clusters = matched.filter((m) => m.startsWith("cluster:")).map((m) => m.slice(8));
  const fresh    = matched.some((m) => m.startsWith("fresh:"));
  const sponsored = matched.includes("sponsorship:yes");

  let reason = "";
  if (titleExactMatch) {
    reason = `Strong ${profile.name} match: title "${titleExactMatch}"`;
  } else if (titlePartialMatch) {
    reason = `Good ${profile.name} fit: title near-matches "${titlePartialMatch}"`;
  } else {
    reason = `Keyword match for ${profile.name}`;
  }
  if (topSkills.length > 0) reason += ` + ${topSkills.join(", ")}`;
  if (clusters.length > 0)  reason += `. Skills: ${clusters.join(", ")}`;
  if (fresh)      reason += ". 🔥 Fresh listing";
  if (sponsored)  reason += ". ✅ Visa sponsored";
  if (negatives.length > 0 && score < 50) {
    reason += `. ⚠️ Penalised: ${negatives.slice(0, 2).join(", ")}`;
  }
  reason += ".";

  const qualified = score >= profile.minScore;
  return { score, matched, negatives, reason, qualified };
}

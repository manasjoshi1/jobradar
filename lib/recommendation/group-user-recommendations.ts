/**
 * Groups flat UserJobRecommendation rows (with job + userRoleProfile included)
 * into one entry per unique job.  Produces the same output shape as
 * groupRecommendations() so the UI can consume both without changes.
 */

export type MatchedProfile = {
  recommendationId: string;
  roleProfileId: string; // userRoleProfile.id — kept as same field name for UI compat
  name: string;
  score: number;
  matched: string[];
  negatives: string[];
  reason: string | null;
  status: string;
};

export type GroupedJobRecommendation = {
  jobId: string;
  job: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    department: string | null;
    employmentType: string | null;
    applyUrl: string;
    postedAt: string | null;
    firstSeenAt: string;
    effectiveNewAt: string | null;
    status: string;
    sponsorship: string;
    isActive: boolean;
  };
  bestScore: number;
  bestRecommendationId: string;
  bestRoleProfile: {
    id: string;
    name: string;
    priority: number;
    minScore: number;
  };
  bestStatus: string;
  recommendedAt: string;
  matchedProfiles: MatchedProfile[];
};

type RawUserRec = {
  id: string;
  score: number;
  reason: string | null;
  matched: string;
  negatives: string;
  status: string;
  recommendedAt: Date | string;
  userRoleProfile: { id: string; name: string; priority: number; minScore: number };
  job: {
    id: string;
    title: string;
    company: string;
    location: string | null;
    department: string | null;
    employmentType: string | null;
    applyUrl: string;
    postedAt: Date | string | null;
    firstSeenAt: Date | string;
    effectiveNewAt: Date | string | null;
    status: string;
    sponsorship: string;
    isActive: boolean;
  };
};

function safeParseArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

export function groupUserRecommendations(recs: RawUserRec[]): GroupedJobRecommendation[] {
  const map = new Map<string, GroupedJobRecommendation>();

  for (const rec of recs) {
    const jobId    = rec.job.id;
    const existing = map.get(jobId);

    const profile: MatchedProfile = {
      recommendationId: rec.id,
      roleProfileId:    rec.userRoleProfile.id, // maps to UI's roleProfileId field
      name:             rec.userRoleProfile.name,
      score:            rec.score,
      matched:          safeParseArray(rec.matched),
      negatives:        safeParseArray(rec.negatives),
      reason:           rec.reason,
      status:           rec.status,
    };

    if (!existing) {
      map.set(jobId, {
        jobId,
        job: {
          ...rec.job,
          postedAt:       toIso(rec.job.postedAt),
          firstSeenAt:    toIso(rec.job.firstSeenAt)!,
          effectiveNewAt: toIso(rec.job.effectiveNewAt),
        },
        bestScore:            rec.score,
        bestRecommendationId: rec.id,
        bestRoleProfile:      rec.userRoleProfile,
        bestStatus:           rec.status,
        recommendedAt:        toIso(rec.recommendedAt)!,
        matchedProfiles:      [profile],
      });
    } else {
      existing.matchedProfiles.push(profile);
      if (rec.score > existing.bestScore) {
        existing.bestScore            = rec.score;
        existing.bestRecommendationId = rec.id;
        existing.bestRoleProfile      = rec.userRoleProfile;
        existing.bestStatus           = rec.status;
      }
      const existingTs = new Date(existing.recommendedAt).getTime();
      const recTs = rec.recommendedAt instanceof Date
        ? rec.recommendedAt.getTime()
        : new Date(rec.recommendedAt).getTime();
      if (recTs < existingTs) existing.recommendedAt = toIso(rec.recommendedAt)!;
    }
  }

  for (const group of map.values()) {
    group.matchedProfiles.sort((a, b) => b.score - a.score);
  }

  return [...map.values()].sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return new Date(b.recommendedAt).getTime() - new Date(a.recommendedAt).getTime();
  });
}

export type NormalizedJob = {
  externalId?: string;
  company: string;
  title: string;
  location?: string;
  department?: string;
  employmentType?: string;
  applyUrl: string;
  description?: string;
  postedAt?: string;
};

export type JobStatus = "NEW" | "SAVED" | "APPLIED" | "SKIPPED";

export type Sponsorship = "YES" | "NO" | "UNKNOWN";

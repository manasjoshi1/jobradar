-- Add useGlobalDefaultSources to UserJobPreference.
-- Default: false — global sources are an explicit opt-in, NOT a silent fallback.
-- Users who want to use global sources must explicitly enable this flag.
ALTER TABLE "UserJobPreference" ADD COLUMN "useGlobalDefaultSources" BOOLEAN NOT NULL DEFAULT false;

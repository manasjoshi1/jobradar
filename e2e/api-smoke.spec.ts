/**
 * E2E — API smoke tests
 *
 * Uses Playwright's request context (no browser UI needed).
 * Proves every core API endpoint returns 200 with valid JSON.
 *
 * All requests are authenticated via the session cookie from login.
 * No real Slack/Telegram calls. No real sync.
 */
import { test, expect } from "@playwright/test";

// ── Shared auth context ──────────────────────────────────────────────────────
// Login once, reuse cookies for all API calls in this file.

let authCookies: Array<{ name: string; value: string; domain: string; path: string }> = [];

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
  const res = await ctx.post("/api/auth/login", { data: { password: "JobRadarE2E!" } });

  if (!res.ok()) {
    throw new Error(`Login failed during API smoke setup: ${res.status()} ${await res.text()}`);
  }

  // Extract session cookie from response headers
  const setCookie = res.headers()["set-cookie"] ?? "";
  const cookieMatch = setCookie.match(/jobradar_session=([^;]+)/);
  if (cookieMatch) {
    authCookies = [{
      name:   "jobradar_session",
      value:  cookieMatch[1],
      domain: "127.0.0.1",
      path:   "/",
    }];
  }

  await ctx.dispose();
});

// Helper that creates a request context with the session cookie.
async function authedCtx(playwright: Parameters<Parameters<typeof test>[1]>[0]["playwright"]) {
  const ctx = await playwright.request.newContext({
    baseURL:  "http://127.0.0.1:3000",
    extraHTTPHeaders: {
      Cookie: authCookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });
  return ctx;
}

// ── Unauthenticated guard ────────────────────────────────────────────────────

test("unauthenticated /api/me returns 401", async ({ playwright }) => {
  const ctx = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3000" });
  const res = await ctx.get("/api/me");
  expect(res.status()).toBe(401);
  await ctx.dispose();
});

// ── Auth endpoints ────────────────────────────────────────────────────────────

test("GET /api/auth/me returns current user", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/auth/me");
  expect(res.status()).toBe(200);
  const body = await res.json() as { user?: { name?: string } };
  expect(body.user).toBeDefined();
  expect(body.user?.name).toBe("Default User");
  await ctx.dispose();
});

// ── Jobs endpoints ────────────────────────────────────────────────────────────

test("GET /api/jobs returns 200 with jobs array", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/jobs?page=1&pageSize=10");
  expect(res.status()).toBe(200);
  const body = await res.json() as { jobs?: unknown[]; total?: number };
  expect(Array.isArray(body.jobs)).toBe(true);
  expect(typeof body.total).toBe("number");
  expect(body.total).toBeGreaterThanOrEqual(1); // we seeded 8 jobs
  await ctx.dispose();
});

test("GET /api/jobs/new-counts returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/jobs/new-counts");
  expect(res.status()).toBe(200);
  const body = await res.json() as Record<string, number>;
  expect(typeof body.last1h).toBe("number");
  expect(typeof body.last1d).toBe("number");
  await ctx.dispose();
});

// ── Recommendations endpoints ─────────────────────────────────────────────────

test("GET /api/recommendations/counts returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/recommendations/counts");
  expect(res.status()).toBe(200);
  const body = await res.json() as { uniqueJobs?: object; recommendations?: object };
  expect(body.uniqueJobs).toBeDefined();
  expect(body.recommendations).toBeDefined();
  await ctx.dispose();
});

test("GET /api/recommendations?groupByJob=true returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/recommendations?groupByJob=true&window=7d");
  expect(res.status()).toBe(200);
  // With groupByJob=true the API returns { jobs: [...], total, ... }
  const body = await res.json() as { jobs?: unknown[]; total?: number };
  expect(Array.isArray(body.jobs)).toBe(true);
  // We seeded 6 recommendation rows → at least 1 unique job grouped
  expect(body.total).toBeGreaterThanOrEqual(1);
  await ctx.dispose();
});

test("POST /api/recommendations/run returns 200 with small window", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  // Run with 1h window — only processes very recent jobs, fast and cheap
  const res = await ctx.post("/api/recommendations/run", {
    data: { windowHours: 1 },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { status?: string; jobsScanned?: number };
  expect(["SUCCESS", "PARTIAL_FAILURE"].includes(body.status ?? "")).toBe(true);
  expect(typeof body.jobsScanned).toBe("number");
  await ctx.dispose();
});

// ── Sources & sync ────────────────────────────────────────────────────────────

test("GET /api/sources/health returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/sources/health");
  expect(res.status()).toBe(200);
  await ctx.dispose();
});

// ── History ───────────────────────────────────────────────────────────────────

test("GET /api/history/sync-runs returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/history/sync-runs?page=1&pageSize=5");
  expect(res.status()).toBe(200);
  const body = await res.json() as { runs?: unknown[] };
  expect(Array.isArray(body.runs)).toBe(true);
  await ctx.dispose();
});

test("GET /api/history/recommendation-runs returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/history/recommendation-runs?page=1&pageSize=5");
  expect(res.status()).toBe(200);
  await ctx.dispose();
});

// ── Profile / user ────────────────────────────────────────────────────────────

test("GET /api/me returns full user profile with role profiles", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/me");
  expect(res.status()).toBe(200);
  const body = await res.json() as {
    user?: { name?: string; roleProfiles?: unknown[] };
    stats?: { totalRecommendations?: number };
  };
  expect(body.user?.name).toBe("Default User");
  expect(Array.isArray(body.user?.roleProfiles)).toBe(true);
  expect((body.user?.roleProfiles ?? []).length).toBeGreaterThanOrEqual(3);
  expect(body.stats).toBeDefined();
  await ctx.dispose();
});

test("GET /api/role-profiles returns 200", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const res = await ctx.get("/api/role-profiles");
  expect(res.status()).toBe(200);
  const body = await res.json() as { profiles?: unknown[] };
  expect(Array.isArray(body.profiles)).toBe(true);
  expect((body.profiles ?? []).length).toBeGreaterThanOrEqual(3);
  await ctx.dispose();
});

// ── Status update ─────────────────────────────────────────────────────────────

test("PATCH /api/jobs/:id/status updates UserJobStatus", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);

  // First get a job ID from the jobs list
  const jobsRes = await ctx.get("/api/jobs?page=1&pageSize=1");
  const jobsBody = await jobsRes.json() as { jobs?: Array<{ id: string }> };
  const jobId = jobsBody.jobs?.[0]?.id;

  if (!jobId) {
    test.skip(true, "No jobs found to test status update");
    return;
  }

  // Set status to SAVED
  const patchRes = await ctx.patch(`/api/jobs/${jobId}/status`, {
    data: { status: "SAVED" },
  });
  expect(patchRes.status()).toBe(200);
  const patchBody = await patchRes.json() as { id?: string; status?: string };
  expect(patchBody.status).toBe("SAVED");
  expect(patchBody.id).toBe(jobId);

  // Set it back to NEW
  await ctx.patch(`/api/jobs/${jobId}/status`, { data: { status: "NEW" } });
  await ctx.dispose();
});

// ── No 500s anywhere ──────────────────────────────────────────────────────────

test("no endpoint returns 500 under normal load", async ({ playwright }) => {
  const ctx = await authedCtx(playwright);
  const endpoints = [
    "/api/me",
    "/api/auth/me",
    "/api/jobs?page=1&pageSize=5",
    "/api/jobs/new-counts",
    "/api/recommendations?groupByJob=true&window=7d",
    "/api/recommendations/counts",
    "/api/role-profiles",
    "/api/history/sync-runs?page=1&pageSize=5",
    "/api/history/recommendation-runs?page=1&pageSize=5",
    "/api/sources/health",
  ];

  for (const ep of endpoints) {
    const res = await ctx.get(ep);
    expect(res.status(), `${ep} returned ${res.status()}`).toBeLessThan(500);
  }

  await ctx.dispose();
});

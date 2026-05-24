/**
 * Onboarding wizard data — role titles, hidden aliases, skill categories.
 * Shared between the wizard UI and the API handler.
 */

// ── Primary job titles ────────────────────────────────────────────────────────

export const PRIMARY_TITLES: string[] = [
  "Software Engineer",
  "Backend Developer",
  "Frontend Developer",
  "Full Stack Developer",
  "Java Developer",
  "Spring Boot Developer",
  "React Developer",
  "Node.js Developer",
  "Python Developer",
  "Cloud Engineer",
  "DevOps Engineer",
  "QA Automation Engineer",
  "SDET",
  "Data Engineer",
  "Data Analyst",
  "Business Analyst",
  "Systems Analyst",
  "Application Support Engineer",
  "Production Support Engineer",
  "Technical Support Engineer",
  "Implementation Engineer",
  "Integration Engineer",
  "Solutions Engineer",
  "Technical Consultant",
  "IT Analyst",
  "Software Developer Intern",
  "Software Engineer Intern",
  "New Grad Software Engineer",
  "Associate Software Engineer",
];

// ── Hidden / alias titles ─────────────────────────────────────────────────────
// Shown under an "Also match these hidden titles" toggle.
// Useful for ATS searches that use non-standard designations.

export const HIDDEN_TITLES: string[] = [
  "Application Developer",
  "Programmer Analyst",
  "Technology Analyst",
  "Associate Consultant",
  "Systems Engineer",
  "Software Analyst",
  "Product Engineer",
  "Platform Engineer",
  "Cloud Support Associate",
  "Site Reliability Engineer",
  "Release Engineer",
  "Build Engineer",
  "API Developer",
  "Integration Developer",
  "Implementation Specialist",
  "Technical Business Analyst",
  "Junior Developer",
  "Graduate Software Engineer",
];

// ── Skill categories ──────────────────────────────────────────────────────────

export interface SkillCategory {
  id: string;
  label: string;
  skills: string[];
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: "languages",
    label: "Languages",
    skills: ["Java", "JavaScript", "TypeScript", "Python", "SQL", "HTML", "CSS"],
  },
  {
    id: "backend",
    label: "Backend",
    skills: [
      "Spring Boot", "REST APIs", "Microservices", "Node.js", "Express.js",
      "Authentication", "Payment Systems", "API Integration",
    ],
  },
  {
    id: "frontend",
    label: "Frontend",
    skills: ["React", "Next.js", "Tailwind CSS", "Material UI", "Flutter"],
  },
  {
    id: "databases",
    label: "Databases",
    skills: ["PostgreSQL", "MongoDB", "MySQL", "Redis", "SQLite"],
  },
  {
    id: "cloud-devops",
    label: "Cloud / DevOps",
    skills: ["AWS", "EC2", "RDS", "S3", "Docker", "Nginx", "Linux", "CI/CD"],
  },
  {
    id: "testing",
    label: "Testing",
    skills: ["JUnit", "Postman", "API Testing", "QA Automation", "Selenium"],
  },
  {
    id: "data",
    label: "Data",
    skills: [
      "ETL", "Data Analysis", "Dashboards", "Excel", "Python Data Processing",
    ],
  },
];

// ── Location helpers ──────────────────────────────────────────────────────────

/** Build preferred locations array from wizard answers. */
export function buildLocationPrefs(opts: {
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
}): string[] {
  const locs: string[] = [];
  if (opts.remoteOk)  locs.push("remote");
  if (opts.hybridOk)  locs.push("hybrid");
  if (opts.onsiteOk)  locs.push("onsite");
  for (const city of opts.targetCities) {
    const c = city.trim().toLowerCase();
    if (c) locs.push(c);
  }
  // Default fallback
  if (locs.length === 0) locs.push("remote", "united states");
  return locs;
}

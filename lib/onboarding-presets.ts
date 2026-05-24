/**
 * Role presets for the onboarding wizard.
 * Shared between the wizard UI and the API handler.
 */

export interface RolePreset {
  id: string;
  label: string;
  emoji: string;
  titles: string[];
  mustHave: string[];
  niceHave: string[];
  negative: string[];
}

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: "backend-java",
    label: "Backend Java / Spring Boot",
    emoji: "☕",
    titles: ["Backend Engineer", "Software Engineer", "Java Engineer", "Java Developer", "Platform Engineer"],
    mustHave: ["java", "spring"],
    niceHave: ["aws", "kubernetes", "kafka", "microservices", "springboot"],
    negative: ["wordpress", "php", "intern"],
  },
  {
    id: "fullstack-react",
    label: "Full Stack React + Node",
    emoji: "⚛️",
    titles: ["Full Stack Engineer", "Software Engineer", "Full Stack Developer"],
    mustHave: ["react", "typescript"],
    niceHave: ["nodejs", "nextjs", "postgres", "graphql", "tailwind"],
    negative: ["wordpress", "php", "intern"],
  },
  {
    id: "payments-fintech",
    label: "Payments / Fintech",
    emoji: "💳",
    titles: ["Payments Engineer", "Platform Engineer", "Software Engineer", "Backend Engineer"],
    mustHave: ["payments"],
    niceHave: ["stripe", "fintech", "api", "distributed systems", "ledger"],
    negative: ["wordpress", "intern"],
  },
  {
    id: "python-backend",
    label: "Python Backend",
    emoji: "🐍",
    titles: ["Backend Engineer", "Software Engineer", "Python Developer", "Python Engineer"],
    mustHave: ["python"],
    niceHave: ["django", "fastapi", "flask", "aws", "postgres", "celery"],
    negative: ["wordpress", "intern"],
  },
  {
    id: "devops-sre",
    label: "DevOps / SRE / Infrastructure",
    emoji: "🏗️",
    titles: ["DevOps Engineer", "SRE", "Site Reliability Engineer", "Infrastructure Engineer", "Platform Engineer"],
    mustHave: ["kubernetes"],
    niceHave: ["terraform", "aws", "gcp", "azure", "helm", "prometheus", "grafana"],
    negative: ["intern"],
  },
  {
    id: "data-engineering",
    label: "Data Engineering",
    emoji: "📊",
    titles: ["Data Engineer", "Senior Data Engineer", "Analytics Engineer"],
    mustHave: ["data engineering"],
    niceHave: ["spark", "airflow", "kafka", "python", "dbt", "snowflake", "databricks"],
    negative: ["intern"],
  },
  {
    id: "golang-backend",
    label: "Go / Golang Backend",
    emoji: "🐹",
    titles: ["Backend Engineer", "Software Engineer", "Go Engineer", "Golang Developer"],
    mustHave: ["golang"],
    niceHave: ["kubernetes", "grpc", "microservices", "aws", "distributed"],
    negative: ["wordpress", "intern"],
  },
  {
    id: "ml-ai",
    label: "Machine Learning / AI",
    emoji: "🤖",
    titles: ["ML Engineer", "Machine Learning Engineer", "AI Engineer", "Research Engineer"],
    mustHave: ["machine learning"],
    niceHave: ["python", "pytorch", "tensorflow", "llm", "transformers", "computer vision"],
    negative: ["intern"],
  },
];

/** Build preferred locations array from wizard answers. */
export function buildLocationPrefs(opts: {
  remoteOk: boolean;
  hybridOk: boolean;
  onsiteOk: boolean;
  targetCities: string[];
}): string[] {
  const locs: string[] = [];
  if (opts.remoteOk) locs.push("remote");
  if (opts.hybridOk) locs.push("hybrid");
  if (opts.onsiteOk) locs.push("onsite");
  for (const city of opts.targetCities) {
    const c = city.trim().toLowerCase();
    if (c) locs.push(c);
  }
  // If nothing selected, default to remote + US
  if (locs.length === 0) locs.push("remote", "united states");
  return locs;
}

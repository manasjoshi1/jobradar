import { runRecommendations } from "../lib/services/recommendation-service.js";

async function main() {
  console.log("Running recommendations for the last 72 hours...");
  const result = await runRecommendations(72);
  console.log("Result:", result);
}

main()
  .catch(console.error);

import { sendRecommendationNotification } from "../lib/services/notification-service.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  console.log("Setting temporary environment variables to dry-run notification...");
  
  // Set env vars so it thinks Slack notifications are enabled
  process.env.NOTIFICATIONS_ENABLED = "true";
  process.env.NOTIFICATION_CHANNEL = "slack";
  process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/mock/webhook/url";
  process.env.APP_PUBLIC_URL = "http://localhost:3000";

  console.log("Running sendRecommendationNotification(lookbackHours = 72)...");
  
  // We expect this to fail during the actual POST send due to mock URL,
  // but it should print out the log and create a failed/skipped NotificationDelivery row in the DB with the message preview.
  try {
    await sendRecommendationNotification({ lookbackHours: 72 });
  } catch (err) {
    console.log("Caught expected send failure (since webhook URL is mock):", err.message);
  }

  // Retrieve the latest NotificationDelivery row to inspect the generated message preview
  const delivery = await prisma.notificationDelivery.findFirst({
    orderBy: { createdAt: "desc" }
  });

  console.log("\nCreated NotificationDelivery row in DB:");
  console.log(JSON.stringify(delivery, null, 2));

  // Let's print out what the message *would* look like by manually querying and formatting
  // to prove the grouping and deduplication works perfectly.
  const rawRecs = await prisma.jobRecommendation.findMany({
    where: {
      status: "UNSEEN",
      recommendedAt: { gte: new Date(Date.now() - 72 * 3600_000) },
      job: { isActive: true },
    },
    orderBy: { score: "desc" },
    include: {
      roleProfile: true,
      job: true,
    }
  });

  const { groupRecommendations } = await import("../lib/recommendation/group-recommendations.js");
  const grouped = groupRecommendations(rawRecs);

  console.log(`\nGrouped unique jobs to send: ${grouped.length} (from ${rawRecs.length} raw recommendations)`);
  if (grouped.length > 0) {
    console.log("\nSample Grouped Job [0]:");
    const g = grouped[0];
    console.log(`Company: ${g.job.company}`);
    console.log(`Title: ${g.job.title}`);
    console.log(`Best matched profile: ${g.bestRoleProfile.name} (Score: ${g.bestScore})`);
    console.log(`All matched profiles:`, g.matchedProfiles.map(p => `${p.name} (Score: ${p.score})`));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

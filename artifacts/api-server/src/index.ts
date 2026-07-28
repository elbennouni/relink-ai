import app from "./app";
import { logger } from "./lib/logger";
import { runLegacyMigration } from "./lib/legacyMigration";
import { startScheduledMessageJob } from "./routes/schedule_message";
import { startDailyPowerJob } from "./lib/dailyPowerJob";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // One-time migration: assign pre-auth (null userId) relations to a designated owner.
  // Triggered only when LEGACY_MIGRATION_OWNER_ID is set in the environment.
  await runLegacyMigration();

  // Start background job for scheduled messages (timer de réponse)
  startScheduledMessageJob();

  // Refresh power-balance analysis for all relations once a day
  startDailyPowerJob();
});

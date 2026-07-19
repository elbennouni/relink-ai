/**
 * One-time server-side migration for pre-auth legacy relations.
 *
 * Usage: set LEGACY_MIGRATION_OWNER_ID to the Clerk userId of the account that
 * should own existing null-userId relations, then restart the server. The
 * migration runs once at startup, assigns the rows, and logs the result.
 *
 * This is an admin-only operation — it requires direct server configuration
 * (env var), not an API endpoint, so no unauthenticated or cross-user access
 * is possible.
 */
import { db } from "@workspace/db";
import { relationsTable } from "@workspace/db";
import { isNull, eq } from "drizzle-orm";
import { logger } from "./logger";

export async function runLegacyMigration(): Promise<void> {
  const ownerId = process.env.LEGACY_MIGRATION_OWNER_ID?.trim();
  if (!ownerId) return; // Not configured — skip

  try {
    const unclaimed = await db
      .select({ id: relationsTable.id })
      .from(relationsTable)
      .where(isNull(relationsTable.userId));

    if (unclaimed.length === 0) {
      logger.info({ ownerId }, "Legacy migration: no unclaimed relations found");
      return;
    }

    await db
      .update(relationsTable)
      .set({ userId: ownerId })
      .where(isNull(relationsTable.userId));

    logger.info(
      { ownerId, count: unclaimed.length, ids: unclaimed.map((r) => r.id) },
      "Legacy migration: assigned pre-auth relations to owner. Remove LEGACY_MIGRATION_OWNER_ID from env.",
    );
  } catch (err) {
    logger.error({ err }, "Legacy migration failed");
  }
}

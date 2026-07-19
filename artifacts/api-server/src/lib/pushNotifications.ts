/**
 * Expo Push Notification sender.
 *
 * Uses expo-server-sdk to send push notifications via Expo's unified push
 * service (handles both FCM for Android and APNs for iOS automatically).
 *
 * For production: configure FCM credentials and APNs key in the EAS dashboard.
 * For development: Expo dev builds use a shared key — notifications work in
 * the Expo Go / dev-build environment without extra credentials.
 */
import Expo, { type ExpoPushMessage } from "expo-server-sdk";
import { db, pushTokensTable, relationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const expo = new Expo();

/**
 * Send a push notification to all devices belonging to the owner of a relation.
 * Silently swaps out expired tokens.
 */
export async function notifyRelationOwner(
  relationId: number,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  // Resolve the userId who owns this relation
  const [relation] = await db
    .select({ userId: relationsTable.userId })
    .from(relationsTable)
    .where(eq(relationsTable.id, relationId))
    .limit(1);

  if (!relation?.userId) return;

  // Get all push tokens for this user
  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, relation.userId));

  if (rows.length === 0) return;

  const messages: ExpoPushMessage[] = rows
    .filter((r) => Expo.isExpoPushToken(r.token))
    .map((r) => ({
      to: r.token,
      sound: "default" as const,
      title,
      body,
      data: { relationId, ...data },
      priority: "high" as const,
    }));

  if (messages.length === 0) return;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      // Remove invalid/expired tokens
      for (let i = 0; i < receipts.length; i++) {
        const receipt = receipts[i];
        if (receipt.status === "error") {
          const details = receipt.details as { error?: string } | undefined;
          if (details?.error === "DeviceNotRegistered") {
            const token = messages[i].to as string;
            console.log(`[Push] Removing stale token: ${token}`);
            await db.delete(pushTokensTable).where(eq(pushTokensTable.token, token));
          } else {
            console.warn(`[Push] Error for token ${messages[i].to}:`, receipt.message);
          }
        }
      }
    } catch (err) {
      console.error("[Push] Failed to send chunk:", err);
    }
  }
}

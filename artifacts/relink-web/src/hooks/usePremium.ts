import { useUser } from "@clerk/react";

/**
 * Returns true if the current user has an active premium subscription.
 * Premium status is stored in Clerk publicMetadata: { isPremium: true }
 * It can also be overridden via the VITE_FORCE_PREMIUM env var (dev only).
 */
export function usePremium(): { isPremium: boolean; isLoaded: boolean } {
  const { user, isLoaded } = useUser();

  // Dev override: set VITE_FORCE_PREMIUM=true to bypass paywall in development
  if (import.meta.env.VITE_FORCE_PREMIUM === "true") {
    return { isPremium: true, isLoaded: true };
  }

  if (!isLoaded) return { isPremium: false, isLoaded: false };
  if (!user) return { isPremium: false, isLoaded: true };

  const isPremium = (user.publicMetadata as Record<string, unknown>)?.isPremium === true;
  return { isPremium, isLoaded: true };
}

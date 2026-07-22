import { useUser } from "@clerk/react";

/**
 * Paywall désactivé temporairement — accès libre pour tous.
 * Réactiver quand les abonnements seront mis en place.
 */
export function usePremium(): { isPremium: boolean; isLoaded: boolean } {
  const { isLoaded } = useUser();
  return { isPremium: true, isLoaded };
}

import React, { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { ClerkProvider, ClerkLoaded, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { setAuthTokenGetter, setBaseUrl } from '@workspace/api-client-react';

// Production domain is the fallback so the app always works even without env vars.
// EXPO_PUBLIC_DOMAIN is baked in by the build script at build time.
const domain =
  process.env.EXPO_PUBLIC_DOMAIN ||
  'ai-agent-tool-mikam514.replit.app';
const BASE = `https://${domain}`;
setBaseUrl(BASE);

// Clerk proxy URL — always computed from the actual domain so it's correct
// in both dev and prod regardless of what was baked into the bundle.
const proxyUrl = `${BASE}/api/__clerk`;

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

/**
 * Registers the Clerk bearer token getter globally so every API call
 * includes the Authorization header. Also clears the QueryClient cache
 * whenever the signed-in state changes — preventing one user from seeing
 * another user's cached data after sign-out / sign-in on the same device.
 *
 * Must live inside <ClerkLoaded> so useAuth() is available.
 */
function ClerkAuthSync() {
  const { isSignedIn, getToken } = useAuth();
  const prevSignedInRef = useRef<boolean | null>(null);

  // Register (or clear) the bearer token getter whenever auth state changes.
  // Returns null when signed out so no Authorization header is sent.
  useEffect(() => {
    setAuthTokenGetter(isSignedIn ? () => getToken() : null);
  }, [getToken, isSignedIn]);

  // Clear ALL cached query data when the sign-in state flips.
  // This prevents user A's relations/messages from leaking to user B.
  useEffect(() => {
    if (prevSignedInRef.current !== null && prevSignedInRef.current !== isSignedIn) {
      queryClient.clear();
    }
    prevSignedInRef.current = isSignedIn ?? false;
  }, [isSignedIn]);

  return null;
}

function RootLayoutNav() {
  const router = useRouter();

  // Reset badge count whenever the app comes to the foreground
  useEffect(() => {
    Notifications.setBadgeCountAsync(0); // clear on mount (app just opened)
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        Notifications.setBadgeCountAsync(0);
      }
    });
    return () => appStateSub.remove();
  }, []);

  // Navigate to the relation's conversation when user taps a push notification
  useEffect(() => {
    // Handle notification tap when app was in background / foreground
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { relationId?: number };
      if (data?.relationId) {
        router.push(`/relations/${data.relationId}` as any);
        Notifications.setBadgeCountAsync(0);
      }
    });

    // Handle the notification that *launched* the app (killed state)
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as { relationId?: number };
      if (data?.relationId) {
        router.push(`/relations/${data.relationId}` as any);
        Notifications.setBadgeCountAsync(0);
      }
    });

    return () => sub.remove();
  }, [router]);

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen
        name="relations/new"
        options={{
          title: 'Nouvelle relation',
          presentation: 'modal',
          headerStyle: { backgroundColor: '#F7F4EE' },
          headerTintColor: '#1B2035',
          headerTitleStyle: { fontFamily: 'Inter_600SemiBold' },
        }}
      />
      <Stack.Screen
        name="relations/[id]"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="oauth-native-callback"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // Fetch the Clerk publishable key from the API server at runtime.
  // This makes the same bundle work in both dev (pk_test_) and prod (pk_live_)
  // without needing to rebuild — the server returns the correct key for its env.
  useEffect(() => {
    fetch(`${BASE}/api/config`)
      .then((r) => r.json())
      .then((data) => {
        const key = data?.clerkPublishableKey;
        if (key) {
          setPublishableKey(key);
        } else {
          // Server responded but key missing — use baked-in fallback
          setPublishableKey(
            process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
            'pk_test_cmVsZXZhbnQtamVubmV0LTU4LmNsZXJrLmFjY291bnRzLmRldiQ'
          );
        }
      })
      .catch(() => {
        // Network error — fall back to whatever was baked in at build time
        setPublishableKey(
          process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
          'pk_test_cmVsZXZhbnQtamVubmV0LTU4LmNsZXJrLmFjY291bnRzLmRldiQ'
        );
      });
  }, []);

  // Keep splash screen up until both fonts AND the Clerk key are ready
  useEffect(() => {
    if ((fontsLoaded || fontError) && publishableKey) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, publishableKey]);

  // Render nothing until both are ready — splash screen covers the blank state
  if ((!fontsLoaded && !fontError) || !publishableKey) return null;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        {/* Registers bearer token getter and clears cache on auth changes — must be inside ClerkLoaded */}
        <ClerkAuthSync />
        <SafeAreaProvider>
          <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </ErrorBoundary>
        </SafeAreaProvider>
      </ClerkLoaded>
    </ClerkProvider>
  );
}

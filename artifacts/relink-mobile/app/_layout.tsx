import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
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

// ---------------------------------------------------------------------------
// Stable module-level token getter — eliminates the React useEffect timing gap.
//
// Problem: if setAuthTokenGetter is called inside useEffect, there is a brief
// window (between first render and effects running) where the getter is null,
// causing the first API calls to go out without a token and get 401.
//
// Solution: register ONE stable function at module load time that always reads
// from a ref. ClerkAuthSync updates the ref synchronously during render, so by
// the time any child component fires a fetch, the ref already points to the
// correct getToken function.
// ---------------------------------------------------------------------------
let _currentGetToken: (() => Promise<string | null>) | null = null;

setAuthTokenGetter(async () => {
  if (!_currentGetToken) return null;
  try {
    return await _currentGetToken();
  } catch {
    return null;
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

/**
 * Keeps the module-level _currentGetToken in sync with Clerk's auth state.
 * Updates synchronously during render (not in an effect) so there is no gap.
 * Must live inside <ClerkLoaded> so useAuth() is available.
 */
function ClerkAuthSync() {
  const { isSignedIn, getToken } = useAuth();
  const prevSignedInRef = useRef<boolean | null>(null);

  // Update the ref synchronously during render — no timing gap.
  _currentGetToken = isSignedIn ? getToken : null;

  // Mirror in an effect for safety / cleanup.
  useEffect(() => {
    _currentGetToken = isSignedIn ? getToken : null;
  }, [getToken, isSignedIn]);

  // Clear ALL cached query data when the sign-in state flips.
  // Prevents user A's data from leaking to user B on the same device.
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
          setPublishableKey(
            process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ||
            'pk_test_cmVsZXZhbnQtamVubmV0LTU4LmNsZXJrLmFjY291bnRzLmRldiQ'
          );
        }
      })
      .catch(() => {
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

  // On web (Expo Web in browser), don't use AsyncStorage-backed tokenCache.
  // Using it can restore a stale session from a previous Clerk instance (e.g.
  // a pk_test_ session left over from dev), which the production API server
  // (using sk_live_) rejects with 401. On web, Clerk manages sessions via
  // cookies automatically — no cache needed.
  const cache = Platform.OS === 'web' ? undefined : tokenCache;

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={cache}
      proxyUrl={proxyUrl}
    >
      <ClerkLoaded>
        {/* Keeps _currentGetToken in sync — must be inside ClerkLoaded */}
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

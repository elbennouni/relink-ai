import { useAuth } from '@clerk/expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthLayout() {
  const { isSignedIn } = useAuth();

  // If already signed in, redirect to main app.
  // /(tabs) is the canonical path for the tab group root.
  if (isSignedIn) return <Redirect href="/(tabs)" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}

import React from 'react';
import { Stack } from 'expo-router';
import { Redirect } from 'expo-router';
import { useAuth } from '@clerk/expo';

export default function RelationLayout() {
  const { isSignedIn } = useAuth();

  // Guard: deep-link into a relation without being signed in → sign-in screen
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="agent"
        options={{
          title: 'ReLink AI',
          headerBackTitle: 'Retour',
          headerStyle: { backgroundColor: '#F7F4EE' },
          headerTintColor: '#1B2035',
          headerTitleStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
        }}
      />
      <Stack.Screen
        name="import"
        options={{
          title: 'Importer',
          headerBackTitle: 'Retour',
          headerStyle: { backgroundColor: '#F7F4EE' },
          headerTintColor: '#1B2035',
          headerTitleStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
        }}
      />
      <Stack.Screen
        name="memory"
        options={{
          title: 'Mémoire',
          headerBackTitle: 'Retour',
          headerStyle: { backgroundColor: '#F7F4EE' },
          headerTintColor: '#1B2035',
          headerTitleStyle: { fontFamily: 'Inter_600SemiBold', fontSize: 17 },
        }}
      />
    </Stack>
  );
}

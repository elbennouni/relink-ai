import React from 'react';
import { Stack } from 'expo-router';

export default function RelationLayout() {
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

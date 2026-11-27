import React from 'react';
import { Stack } from 'expo-router';
import { FavoritesProvider } from '../context/FavoritesContext';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <FavoritesProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#ffffff' },
          headerTintColor: '#111827',
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#f9fafb' },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="detail/[id]"
          options={{
            title: '10초 요약 브리핑',
            presentation: 'card',
          }}
        />
      </Stack>
    </FavoritesProvider>
  );
}

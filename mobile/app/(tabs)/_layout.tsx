import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#9ca3af',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f3f4f6',
          elevation: 0,
          shadowOpacity: 0,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
        headerStyle: { backgroundColor: '#ffffff' },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '경매 떠먹기',
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20 }}>🥄</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{
          title: '관심 매물',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20 }}>⭐</Text>
          ),
          headerTitle: '이지경매 · 관심 매물',
          headerTitleStyle: { fontSize: 18, fontWeight: '800', color: '#111827' },
        }}
      />
    </Tabs>
  );
}

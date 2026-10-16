import React from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../store';
import { ROW, useTheme } from '../theme';
import AdminOrders from './AdminOrders';
import AdminKitchen from './AdminKitchen';
import AdminMenu from './AdminMenu';
import AdminMore from './AdminMore';

export function AdminTabBar() {
  const { tab, go } = useApp();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const tabs = [['orders', '🧾', 'الطلبات'], ['kitchen', '👩‍🍳', 'المطبخ'], ['menu', '🍽️', 'المنيو'], ['more', '☰', 'المزيد']];
  return (
    <View style={{ flexDirection: ROW, backgroundColor: c.card, borderTopWidth: 1, borderColor: c.line, paddingBottom: insets.bottom }}>
      {tabs.map(([k, ic, label]) => (
        <Pressable key={k} testID={`atab-${k}`} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => go(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
          <Text style={{ fontSize: 21 }}>{ic}</Text>
          <Text style={{ fontSize: 12, color: tab === k ? c.teal : c.mute, fontWeight: tab === k ? '700' : '500' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function AdminShell() {
  const { tab, bump } = useApp();
  const Screen = { orders: AdminOrders, kitchen: AdminKitchen, menu: AdminMenu, more: AdminMore }[tab] || AdminOrders;
  return (
    <ScrollView testID="admin-screen" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={false} onRefresh={bump} />}>
      <Screen />
    </ScrollView>
  );
}

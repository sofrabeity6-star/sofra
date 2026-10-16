import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/store';
import { useTheme, ROW } from './src/theme';
import { B, Btn, Sheet, T } from './src/ui';
import { n } from './src/format';
import { totals } from './src/cart';
import { setupNotifications, listenForTaps } from './src/push';
import AdminShell, { AdminTabBar } from './src/admin/AdminShell';
import AdminOrderSheet from './src/admin/AdminOrderSheet';
import AdminItemSheet from './src/admin/AdminItemSheet';
import AuthScreen from './src/screens/AuthScreen';
import ServerForm from './src/screens/ServerForm';
import MenuScreen from './src/screens/MenuScreen';
import CartScreen from './src/screens/CartScreen';
import OrdersScreen from './src/screens/OrdersScreen';
import MeScreen from './src/screens/MeScreen';
import MealSheet from './src/sheets/MealSheet';
import CheckoutSheet from './src/sheets/CheckoutSheet';
import OrderSheet from './src/sheets/OrderSheet';
import { MoveSheet, NotesSheet } from './src/sheets/MiscSheets';

function Header() {
  const { cfg, user, notes, open } = useApp();
  const staff = !!user && user.role !== 'customer';
  const c = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ backgroundColor: c.teal, paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14, flexDirection: ROW, alignItems: 'center', justifyContent: 'space-between' }}>
      <View style={{ flexDirection: ROW, alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.gold, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 19 }}>🍽️</Text></View>
        <View><Text style={{ color: c.onTeal, fontWeight: '700', fontSize: 17, textAlign: 'right' }}>{cfg ? cfg.kitchen_name : 'سفرة / بيتي'}</Text><Text style={{ color: c.onTeal, opacity: 0.85, fontSize: 11, textAlign: 'right' }}>{staff ? 'لوحة الإدارة' : 'أكل بيتي بالجدولة'}</Text></View>
      </View>
      {user && !staff ? (
        <Pressable testID="bell" accessibilityLabel="الإشعارات" onPress={() => open({ t: 'notes' })} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 18 }}>🔔</Text>
          {notes.unread ? <View testID="bell-badge" style={{ position: 'absolute', top: -4, right: -4, backgroundColor: c.gold, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: c.onGold, fontSize: 11, fontWeight: '700' }}>{n(notes.unread)}</Text></View> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

function TabBar() {
  const { tab, go, cart, menu, cfg, orders } = useApp();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const active = orders.filter((o) => !['delivered', 'cancelled'].includes(o.stage)).length;
  const tabs = [['menu', '🍲', 'المنيو', 0], ['cart', '🗓️', 'جدولي', totals(cart, menu, cfg).meals], ['orders', '🧾', 'طلباتي', active], ['me', '👤', 'حسابي', 0]];
  return (
    <View style={{ flexDirection: ROW, backgroundColor: c.card, borderTopWidth: 1, borderColor: c.line, paddingBottom: insets.bottom }}>
      {tabs.map(([k, ic, label, badge]) => (
        <Pressable key={k} testID={`tab-${k}`} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} onPress={() => go(k)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
          <View>
            <Text style={{ fontSize: 21 }}>{ic}</Text>
            {badge ? <View style={{ position: 'absolute', top: -4, right: -10, backgroundColor: c.gold, borderRadius: 10, paddingHorizontal: 5 }}><Text style={{ color: c.onGold, fontSize: 11, fontWeight: '700' }}>{n(badge)}</Text></View> : null}
          </View>
          <Text style={{ fontSize: 12, color: tab === k ? c.teal : c.mute, fontWeight: tab === k ? '700' : '500' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function SheetHost() {
  const { sheet, close } = useApp();
  let body = null;
  if (sheet) {
    if (sheet.t === 'meal') body = <MealSheet id={sheet.id} mode={sheet.mode} />;
    else if (sheet.t === 'checkout') body = <CheckoutSheet />;
    else if (sheet.t === 'order') body = <OrderSheet id={sheet.id} key={sheet.id} />;
    else if (sheet.t === 'aitem') body = <AdminItemSheet id={sheet.id} categoryId={sheet.categoryId} key={`${sheet.id}-${sheet.categoryId}`} />;
    else if (sheet.t === 'aorder') body = <AdminOrderSheet id={sheet.id} key={sheet.id} />;
    else if (sheet.t === 'move') body = <MoveSheet from={sheet.from} />;
    else if (sheet.t === 'notes') body = <NotesSheet />;
  }
  return <Sheet visible={!!sheet} onClose={close}>{body}</Sheet>;
}

function Toast() {
  const { toastMsg } = useApp();
  const c = useTheme();
  const insets = useSafeAreaInsets();
  if (!toastMsg) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 64, left: 12, right: 12, zIndex: 100 }}>
      <View testID="toast" style={{ backgroundColor: toastMsg.isErr ? c.bad : c.ink, borderRadius: 12, padding: 12 }}>
        <Text style={{ color: toastMsg.isErr ? '#fff' : c.bg, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' }}>{toastMsg.msg}</Text>
      </View>
    </View>
  );
}

setupNotifications();

function Shell() {
  const { boot, bootErr, user, tab, startBoot, cfg, open } = useApp();
  const staff = !!user && user.role !== 'customer';
  useEffect(() => (user ? listenForTaps((id) => open({ t: staff ? 'aorder' : 'order', id })) : undefined), [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const c = useTheme();
  let body;
  if (boot === 'loading') body = <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={c.teal} /></View>;
  else if (boot === 'error') {
    body = (
      <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
        <T size={44} style={{ textAlign: 'center' }}>📡</T>
        <T testID="boot-error" style={{ textAlign: 'center' }}>{bootErr}</T>
        <Btn kind="primary" title="إعادة المحاولة" onPress={startBoot} />
        <ServerForm />
        <T size={13} mute style={{ textAlign: 'center' }}>تأكد أن خادم سفرة يعمل (npm start) وأن الهاتف والكمبيوتر على نفس الشبكة.</T>
      </ScrollView>
    );
  } else if (!user) body = <ScrollView keyboardShouldPersistTaps="handled"><AuthScreen /></ScrollView>;
  else if (staff) body = <AdminShell />;
  else {
    const Screen = { menu: MenuScreen, cart: CartScreen, orders: OrdersScreen, me: MeScreen }[tab];
    body = <ScrollView testID="screen" keyboardShouldPersistTaps="handled"><Screen /></ScrollView>;
  }
  // على الويب: عمود مركزي بعرض مناسب (أضيق للعميل وأوسع للإدارة)، وعلى الموبايل ملء الشاشة
  const col = Platform.OS === 'web' ? { flex: 1, width: '100%', maxWidth: staff ? 960 : 560, alignSelf: 'center' } : { flex: 1 };
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
    <View style={col}>
      <StatusBar style="light" />
      <Header />
      <View style={{ flex: 1 }}>{body}</View>
      {user && cfg ? (staff ? <AdminTabBar /> : <TabBar />) : null}
      <Toast />
      {user ? <SheetHost /> : null}
    </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

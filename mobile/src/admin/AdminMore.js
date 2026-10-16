import React, { useState } from 'react';
import { View } from 'react-native';
import { B, Btn, Card, T } from '../ui';
import { useApp } from '../store';
import AdminOverview from './AdminOverview';
import AdminSettings from './AdminSettings';
import AdminTeam from './AdminTeam';

// «المزيد»: التقارير، الإعدادات، الفريق والعملاء (للمدير)، وحسابي
export default function AdminMore() {
  const { user, logout } = useApp();
  const [view, setView] = useState(null);
  const isAdmin = user.role === 'admin';
  if (view) {
    const Body = { overview: AdminOverview, settings: AdminSettings, team: AdminTeam }[view];
    return <View style={{ padding: 16 }}><Btn testID="more-back" sm kind="ghost" title="› رجوع" onPress={() => setView(null)} style={{ alignSelf: 'flex-end', marginBottom: 8 }} /><Body /></View>;
  }
  const item = (k, ic, title, sub) => (
    <Card key={k} testID={`more-${k}`} onPress={() => setView(k)}><B>{ic} {title}</B><T size={13} mute>{sub}</T></Card>
  );
  return (
    <View style={{ padding: 16 }}>
      <B size={20}>المزيد</B>
      <Card style={{ marginTop: 10 }}><B>{user.name}</B><T mute>{isAdmin ? 'مدير' : 'موظف مطبخ'}</T><T mute style={{ writingDirection: 'ltr' }}>{user.phone}</T></Card>
      {item('overview', '📊', 'نظرة عامة', 'المبيعات والنقدية والمتأخر وآخر ١٤ يوماً')}
      {isAdmin ? item('settings', '⚙️', 'الإعدادات', 'ساعات العمل، الرسوم، الطلب الفوري، حسابات التحويل') : null}
      {isAdmin ? item('team', '👥', 'الفريق والعملاء', 'إضافة موظفين وتعطيلهم، وقائمة العملاء') : null}
      <Btn testID="logout" kind="danger" wide style={{ marginTop: 12 }} title="تسجيل الخروج" onPress={logout} />
    </View>
  );
}

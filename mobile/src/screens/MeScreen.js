import React, { useState } from 'react';
import { Linking, View } from 'react-native';
import { B, Btn, Card, Field, Row, T } from '../ui';
import { useApp } from '../store';

export default function MeScreen() {
  const { user, addresses, addAddress, delAddress, logout, cfg, toast, fail } = useApp();
  const [na, setNa] = useState({ label: '', text: '' });
  const add = async () => { try { await addAddress(na.label, na.text); setNa({ label: '', text: '' }); toast('تم حفظ العنوان'); } catch (e) { fail(e); } };
  return (
    <View style={{ padding: 16 }}>
      <B size={20}>حسابي</B>
      <Card style={{ marginTop: 10 }}><B>{user.name}</B><T mute style={{ writingDirection: 'ltr' }}>{user.phone}</T></Card>
      <T weight="700" style={{ marginVertical: 8 }}>عناوين التوصيل</T>
      {addresses.map((a) => (
        <Card key={a.id}><Row between><View style={{ flex: 1 }}><B>{a.label}</B><T mute>{a.text}</T></View><Btn sm kind="danger" title="حذف" onPress={() => delAddress(a.id).catch(fail)} /></Row></Card>
      ))}
      <Card>
        <B>إضافة عنوان</B>
        <Field label="التسمية" value={na.label} onChangeText={(v) => setNa({ ...na, label: v })} placeholder="مثلاً: العمل" />
        <Field label="العنوان" multiline value={na.text} onChangeText={(v) => setNa({ ...na, text: v })} />
        <Btn kind="primary" sm title="حفظ العنوان" onPress={add} />
      </Card>
      {cfg.kitchen_phone ? <Btn kind="ghost" wide title={`اتصل بالمطبخ: ${cfg.kitchen_phone}`} onPress={() => Linking.openURL(`tel:${cfg.kitchen_phone}`)} /> : null}
      <Btn testID="logout" kind="danger" wide style={{ marginTop: 12 }} title="تسجيل الخروج" onPress={logout} />
    </View>
  );
}

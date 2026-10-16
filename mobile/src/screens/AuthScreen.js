import React, { useState } from 'react';
import { View } from 'react-native';
import { B, Btn, Card, Chip, Field, Row, T } from '../ui';
import { useApp } from '../store';
import ServerForm from './ServerForm';

export default function AuthScreen() {
  const { login, register, fail } = useApp();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', phone: '', password: '', label: 'البيت', text: '' });
  const [busy, setBusy] = useState(false);
  const [showSrv, setShowSrv] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const reg = mode === 'register';
  const adm = mode === 'admin';
  const submit = async () => {
    setBusy(true);
    try { if (reg) await register(f); else await login(f.phone, f.password, adm); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <View style={{ padding: 16 }}>
      <B size={26} style={{ marginTop: 10 }}>أهلاً بك في سفرة</B>
      <T mute>{adm ? 'دخول فريق المطبخ والمدير لمتابعة الطلبات.' : 'اطلب وجبتك الآن، أو جدول طلبك لوقت لاحق.'}</T>
      <Row style={{ marginVertical: 14 }}>
        <Chip testID="mode-login" on={!reg && !adm} label="دخول" onPress={() => setMode('login')} />
        <Chip testID="mode-register" on={reg} label="حساب جديد" onPress={() => setMode('register')} />
        <Chip testID="mode-admin" on={adm} label="دخول الإدارة" onPress={() => setMode('admin')} />
      </Row>
      <Card>
        {reg ? <Field testID="f-name" label="الاسم" value={f.name} onChangeText={set('name')} autoComplete="name" /> : null}
        <Field testID="f-phone" label="رقم الموبايل" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="01xxxxxxxxx" ltr autoComplete="tel" />
        <Field testID="f-password" label={reg ? 'كلمة المرور (8 أحرف على الأقل)' : 'كلمة المرور'} value={f.password} onChangeText={set('password')} secureTextEntry autoComplete={reg ? 'new-password' : 'current-password'} />
        {reg ? <Field label="تسمية العنوان" value={f.label} onChangeText={set('label')} /> : null}
        {reg ? <Field testID="f-text" label="عنوان التوصيل" multiline value={f.text} onChangeText={set('text')} placeholder="المحافظة، الشارع، رقم العقار" /> : null}
        <Btn testID="auth-submit" kind="primary" wide loading={busy} title={reg ? 'إنشاء الحساب' : adm ? 'دخول الإدارة' : 'دخول'} onPress={submit} />
      </Card>
      <Btn kind="ghost" sm title={showSrv ? 'إخفاء إعدادات الخادم' : 'إعدادات الخادم'} onPress={() => setShowSrv(!showSrv)} />
      {showSrv ? <ServerForm /> : null}
    </View>
  );
}

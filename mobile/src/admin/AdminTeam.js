import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Card, Chip, Field, Row, T } from '../ui';
import { useApp } from '../store';
import { api } from '../api';
import { n } from '../format';
import { usePoll } from './util';

export default function AdminTeam() {
  const { user, toast, fail } = useApp();
  const [team, setTeam] = useState({ staff: [], customers: [] });
  const [f, setF] = useState({ name: '', phone: '', password: '', role: 'staff' });
  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api('GET', '/api/admin/users'), api('GET', '/api/admin/users?role=customer')]);
      setTeam({ staff: a.users, customers: b.users });
    } catch (e) { fail(e); }
  }, [fail]);
  usePoll(load, 60000, [load]);
  const add = async () => {
    try { await api('POST', '/api/admin/users', { json: f }); setF({ name: '', phone: '', password: '', role: 'staff' }); toast('تمت الإضافة'); load(); } catch (e) { fail(e); }
  };
  const toggle = async (u) => { try { await api('PATCH', `/api/admin/users/${u.id}`, { json: { active: !u.active } }); load(); } catch (e) { fail(e); } };
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  return (
    <View>
      <B size={20}>الفريق والعملاء</B>
      <Card style={{ marginTop: 10 }}>
        <B>إضافة عضو في الفريق</B>
        <Field testID="team-name" label="الاسم" value={f.name} onChangeText={set('name')} />
        <Field testID="team-phone" label="الموبايل" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" ltr />
        <Field testID="team-pass" label="كلمة المرور (8 أحرف على الأقل)" value={f.password} onChangeText={set('password')} secureTextEntry />
        <Row gap={8} style={{ marginBottom: 10 }}>
          <Chip on={f.role === 'staff'} label="موظف مطبخ" onPress={() => set('role')('staff')} />
          <Chip on={f.role === 'admin'} label="مدير" onPress={() => set('role')('admin')} />
        </Row>
        <Btn testID="team-add" kind="primary" wide title="إضافة" onPress={add} />
      </Card>
      <Card>
        <B>الفريق</B>
        {team.staff.map((u) => (
          <Row key={u.id} between style={{ paddingVertical: 8 }}>
            <View style={{ flex: 1 }}>
              <Row gap={6}><T weight="700">{u.name}</T><Badge kind={u.role === 'admin' ? 'info' : 'ok'}>{u.role === 'admin' ? 'مدير' : 'موظف'}</Badge>{u.active ? null : <Badge kind="bad">معطّل</Badge>}</Row>
              <T size={13} mute style={{ writingDirection: 'ltr' }}>{u.phone}</T>
            </View>
            {u.id !== user.id ? <Btn sm kind={u.active ? 'danger' : 'tile'} title={u.active ? 'تعطيل' : 'تفعيل'} onPress={() => toggle(u)} /> : <T size={12} mute>أنت</T>}
          </Row>
        ))}
      </Card>
      <Card>
        <B>آخر العملاء المسجلين</B>
        {team.customers.length ? team.customers.map((u) => (
          <Row key={u.id} between style={{ paddingVertical: 6 }}>
            <View><T weight="700">{u.name}</T><T size={13} mute style={{ writingDirection: 'ltr' }}>{u.phone}</T></View>
            <T size={13} mute>{n(u.orders_count)} طلب</T>
          </Row>
        )) : <T mute>لا يوجد عملاء بعد.</T>}
      </Card>
    </View>
  );
}

import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Card, Empty, Field, Row, T } from '../ui';
import { useApp } from '../store';
import { api } from '../api';
import { money } from '../format';
import { usePoll } from './util';

// المدير: إضافة/تعديل/حذف الوجبات والتصنيفات. الموظف: إيقاف/تشغيل الوجبة فقط (نفدت الكمية).
export default function AdminMenu() {
  const { rk, bump, open, user, fail, toast } = useApp();
  const isAdmin = user.role === 'admin';
  const [menu, setMenu] = useState(null);
  const [nc, setNc] = useState('');
  const [ed, setEd] = useState(null); // { id, name } تصنيف قيد إعادة التسمية
  const [delCat, setDelCat] = useState(null);
  const load = useCallback(async (loud) => { try { setMenu(await api('GET', '/api/admin/menu')); } catch (e) { if (loud) fail(e); } }, [fail]);
  usePoll(() => load(!menu), 30000, [load, rk]);

  const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); await load(true); bump(); } catch (e) { fail(e); } };
  const toggle = (it) => act(() => api('POST', `/api/admin/menu/${it.id}/availability`, { json: { available: !it.available } }), it.available ? `تم إيقاف «${it.name}»` : `«${it.name}» متاحة الآن`);
  if (!menu) return null;
  return (
    <View style={{ padding: 16 }}>
      <B size={20}>المنيو</B>
      <T size={13} mute style={{ marginBottom: 8 }}>أوقف أي وجبة نفدت بضغطة، وتختفي فوراً من تطبيق العملاء.{isAdmin ? '' : ' تعديل الوجبات للمدير فقط.'}</T>
      {isAdmin ? (
        <Card>
          <Row gap={8} center={false}>
            <View style={{ flex: 1 }}><Field testID="cat-new" label="تصنيف جديد" value={nc} onChangeText={setNc} style={{ marginTop: 0 }} /></View>
            <Btn testID="cat-add" kind="primary" title="إضافة" style={{ marginTop: 26 }} onPress={() => act(async () => { await api('POST', '/api/admin/categories', { json: { name: nc } }); setNc(''); }, 'تمت إضافة التصنيف')} />
          </Row>
        </Card>
      ) : null}
      {!menu.categories.length ? <Empty emoji="🍽️" text="لا توجد تصنيفات. أضف تصنيفاً ثم الوجبات." /> : null}
      {menu.categories.map((c) => {
        const its = menu.items.filter((i) => i.category_id === c.id);
        return (
          <Card key={c.id} testID={`acat-${c.id}`}>
            {ed && ed.id === c.id ? (
              <Row gap={8} center={false}>
                <View style={{ flex: 1 }}><Field value={ed.name} onChangeText={(v) => setEd({ ...ed, name: v })} style={{ marginTop: 0 }} /></View>
                <Btn sm kind="primary" title="حفظ" onPress={() => act(async () => { await api('PATCH', `/api/admin/categories/${c.id}`, { json: { name: ed.name } }); setEd(null); })} />
              </Row>
            ) : (
              <Row between>
                <Row gap={6}><B size={16}>{c.name}</B>{c.active ? null : <Badge kind="bad">مخفي</Badge>}</Row>
                {isAdmin ? (
                  <Row gap={6}>
                    <Btn testID={`add-item-${c.id}`} sm title="+ وجبة" onPress={() => open({ t: 'aitem', id: null, categoryId: c.id })} />
                    <Btn sm kind="ghost" title="تسمية" onPress={() => setEd({ id: c.id, name: c.name })} />
                    <Btn sm kind="ghost" title={c.active ? 'إخفاء' : 'إظهار'} onPress={() => act(() => api('PATCH', `/api/admin/categories/${c.id}`, { json: { active: !c.active } }))} />
                    <Btn sm kind="danger" title={delCat === c.id ? 'تأكيد' : 'حذف'} onPress={() => (delCat === c.id ? act(() => api('DELETE', `/api/admin/categories/${c.id}`), 'تم حذف التصنيف') : setDelCat(c.id))} />
                  </Row>
                ) : null}
              </Row>
            )}
            {its.length ? its.map((i) => (
              <Row key={i.id} between style={{ paddingVertical: 8 }}>
                <View style={{ flex: 1 }}>
                  <T weight="700">{i.emoji} {i.name}</T>
                  <Row gap={6} wrap><T size={13} mute>{money(i.price_cents)}</T>{i.asap_ok ? <Badge kind="rush">فوري</Badge> : <Badge kind="warn">مجدول فقط</Badge>}{i.popular ? <Badge kind="info">الأكثر طلباً</Badge> : null}</Row>
                </View>
                <Row gap={6}>
                  <Btn testID={`toggle-${i.id}`} sm kind={i.available ? 'tile' : 'danger'} title={i.available ? 'متاحة · إيقاف' : 'نفدت · تشغيل'} onPress={() => toggle(i)} />
                  {isAdmin ? <Btn testID={`edit-${i.id}`} sm kind="ghost" title="تعديل" onPress={() => open({ t: 'aitem', id: i.id })} /> : null}
                </Row>
              </Row>
            )) : <T size={13} mute style={{ marginTop: 6 }}>لا توجد وجبات في هذا التصنيف.</T>}
          </Card>
        );
      })}
    </View>
  );
}

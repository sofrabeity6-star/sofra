import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { B, Badge, Btn, Card, Chip, Empty, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { money, n } from '../format';
import { mediaUrl } from '../api';

function MealCard({ m, mode, asapOk, onAdd, onSchedule }) {
  const c = useTheme();
  const now = mode === 'now';
  const laterOnly = now && m.available && !m.asap_ok;
  const canNow = now && m.available && m.asap_ok && asapOk;
  const dim = !m.available || laterOnly || (now && !canNow);
  let action;
  if (!m.available) action = <Badge kind="bad">نفدت</Badge>;
  else if (now && !canNow) action = <Btn testID={`sched-${m.id}`} kind="ghost" sm title="جدولة" onPress={onSchedule} />;
  else action = <Btn testID={`add-${m.id}`} kind="primary" sm title={now ? 'اطلب' : 'إضافة'} onPress={onAdd} />;
  return (
    <Card testID={`meal-${m.id}`} style={{ opacity: dim ? 0.6 : 1, padding: 10 }}>
      <Row gap={12}>
        <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {m.image ? <Image source={{ uri: mediaUrl(m.image) }} style={{ width: 72, height: 72 }} /> : <T size={38}>{m.emoji}</T>}
        </View>
        <View style={{ flex: 1 }}>
          <Row gap={6} wrap><B>{m.name}</B>{laterOnly ? <Badge kind="warn">للطلب المجدول فقط</Badge> : null}{m.popular ? <Badge kind="info">الأكثر طلباً</Badge> : null}</Row>
          <T size={13} mute numberOfLines={2}>{m.description}</T>
          <B>{money(m.price_cents)}</B>
        </View>
        {action}
      </Row>
    </Card>
  );
}

export default function MenuScreen() {
  const { menu, cfg, open, om, setOm } = useApp();
  const c = useTheme();
  const [cat, setCat] = useState(0);
  const a = cfg.asap;
  const now = om === 'now';
  const asapOk = a.enabled && a.available;
  let list = menu.items.filter((m) => !cat || m.category_id === cat);
  list = list.slice().sort((x, y) => (now ? (y.asap_ok && y.available) - (x.asap_ok && x.available) : 0) || y.popular - x.popular);
  return (
    <View style={{ padding: 16 }}>
      {cfg.accepting_orders === false ? (
        <View testID="closed-banner" style={{ backgroundColor: c.badbg, borderRadius: 14, padding: 12, marginBottom: 12 }}><B color={c.bad}>المطبخ لا يستقبل طلبات حالياً</B>{cfg.closed_message ? <T>{cfg.closed_message}</T> : null}</View>
      ) : null}
      {cfg.announcement ? (
        <View testID="announcement" style={{ backgroundColor: c.warnbg, borderRadius: 14, padding: 12, marginBottom: 12 }}><T weight="700">📣 {cfg.announcement}</T></View>
      ) : null}
      <Row gap={8} style={{ marginBottom: 14 }} testID="order-mode">
        <View style={{ flex: 1 }}><Btn testID="mode-now" kind={now ? 'primary' : 'tile'} wide title="🛵 اطلب الآن" onPress={() => setOm('now')} /></View>
        <View style={{ flex: 1 }}><Btn testID="mode-later" kind={!now ? 'primary' : 'tile'} wide title="🗓️ جدولة طلب" onPress={() => setOm('later')} /></View>
      </Row>
      {now ? (
        <View testID="now-banner" style={{ flexDirection: 'row-reverse', gap: 12, alignItems: 'center', backgroundColor: asapOk ? c.rushbg : c.tile, borderRadius: 14, padding: 12, marginBottom: 14 }}>
          <T size={30}>🛵</T>
          <View style={{ flex: 1 }}>
            <B>طلب عادي: يتجهز ويصلك الآن</B>
            <T size={13}>{asapOk ? `يوصلك خلال حوالي ${n(a.minutes)} دقيقة · رسوم التوصيل ${money(a.fee_cents)}` : `${a.reason || 'الطلب الفوري غير متاح حالياً'} · يمكنك جدولة طلبك لوقت لاحق`}</T>
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: c.teal, borderRadius: 16, padding: 18, marginBottom: 14 }}>
          <B size={20} color={c.onTeal}>جدولة طلب</B>
          <T color={c.onTeal} style={{ opacity: 0.92 }}>اختر الوجبة وحدد يوم وساعة وصولها (حتى {n(cfg.max_days_ahead)} يوماً). يمكنك تجميع وجبات الأسبوع أو الشهر في طلب واحد.</T>
        </View>
      )}
      <Row wrap gap={8} style={{ marginBottom: 12 }}>
        <Chip testID="cat-all" on={!cat} label="الكل" onPress={() => setCat(0)} />
        {menu.categories.map((k) => <Chip key={k.id} testID={`cat-${k.id}`} on={cat === k.id} label={k.name} onPress={() => setCat(k.id)} />)}
      </Row>
      {list.length ? list.map((m) => (
        <MealCard key={m.id} m={m} mode={om} asapOk={asapOk}
          onAdd={() => open({ t: 'meal', id: m.id, mode: now ? 'asap' : 'later' })}
          onSchedule={() => { setOm('later'); open({ t: 'meal', id: m.id, mode: 'later' }); }} />
      )) : <Empty emoji="🍽️" text="لا توجد وجبات في هذا التصنيف الآن." />}
    </View>
  );
}

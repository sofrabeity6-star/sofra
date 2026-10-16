import React from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { B, Badge, Btn, Card, Empty, T } from '../ui';
import { useApp } from '../store';
import { STAGES, fmtDay, fmtTime, id as oid, money, n } from '../format';

const eta = (o) => { const m = o.minutes_to_delivery; return m === null || m === undefined ? '' : m < 0 ? 'الموعد حان' : m < 90 ? `بعد حوالي ${n(m)} دقيقة` : ''; };

export default function OrdersScreen() {
  const { orders, open, go } = useApp();
  if (!orders.length) return <Empty emoji="🧾" text="لا توجد طلبات بعد. ابدأ بجدولة أول وجباتك." action={<Btn kind="primary" title="تصفح المنيو" onPress={() => go('menu')} />} />;
  return (
    <View style={{ padding: 16 }}>
      <B size={20} style={{ marginBottom: 10 }}>طلباتي</B>
      {orders.map((o) => (
        <Card key={o.id} testID={`order-${o.id}`} onPress={() => open({ t: 'order', id: o.id })}>
          <View style={{ flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center' }}>
            <B>طلب رقم {oid(o.number)}{o.is_asap ? ' ⚡' : ''}</B><Badge kind={STAGES[o.stage][1]}>{STAGES[o.stage][0]}</Badge>
          </View>
          <T mute>{n(o.meals_count)} وجبة في {n(o.deliveries_count)} مواعيد · {money(o.total_cents)}</T>
          {o.next_delivery_at ? <T size={13} mute>أقرب موعد: {fmtDay(o.next_delivery_at)} {fmtTime(o.next_delivery_at)}{eta(o) ? ' · ' + eta(o) : ''}</T> : null}
          {o.stage === 'pending_phone_confirmation' ? <T size={13} weight="700" color="#B07A00">يمكنك التحويل للدفع المسبق قبل مكالمة التأكيد</T> : null}
          {o.stage === 'receipt_rejected' ? <T size={13} weight="700" color="#B93524">الإيصال مرفوض، ارفع إيصالاً جديداً</T> : null}
        </Card>
      ))}
    </View>
  );
}

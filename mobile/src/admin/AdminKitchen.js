import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Card, Empty, Row, T } from '../ui';
import { useApp } from '../store';
import { api } from '../api';
import { DL, addDays, dayLabel, fmtTime, id as oid, n, today } from '../format';
import { usePoll } from './util';

export default function AdminKitchen() {
  const { rk, bump, open, toast, fail } = useApp();
  const [date, setDate] = useState(today());
  const [k, setK] = useState(null);
  const load = useCallback(async (loud) => {
    try { setK(await api('GET', `/api/admin/kitchen?date=${date}`)); } catch (e) { if (loud) fail(e); }
  }, [date, fail]);
  usePoll(() => load(!k), 15000, [load, rk]);
  const prepare = async () => {
    try { const r = await api('POST', '/api/admin/prepare-today', { json: {} }); toast(r.prepared ? `بدأ تجهيز ${n(r.prepared)} موعد` : 'لا توجد مواعيد جديدة للتجهيز'); bump(); } catch (e) { fail(e); }
  };
  return (
    <View style={{ padding: 16 }}>
      <Card>
        <Row between>
          <Btn testID="k-prev" sm title="السابق" onPress={() => setDate(addDays(date, -1))} />
          <View style={{ alignItems: 'center' }}><B testID="k-date">{dayLabel(date)}</B>{date !== today() ? <Btn sm kind="ghost" title="اليوم" onPress={() => setDate(today())} /> : <Badge kind="ok">اليوم</Badge>}</View>
          <Btn testID="k-next" sm title="التالي" onPress={() => setDate(addDays(date, 1))} />
        </Row>
        <Btn testID="prepare-today" kind="gold" wide style={{ marginTop: 10 }} title="ابدأ تجهيز كل وجبات اليوم" onPress={prepare} />
      </Card>
      {!k ? null : !k.slots.length ? (
        <View><Empty emoji="👩‍🍳" text="لا توجد وجبات مؤكدة في هذا اليوم." />{k.pending_qty ? <T mute style={{ textAlign: 'center' }}>{n(k.pending_qty)} وجبة بانتظار التأكيد ولا تدخل في الطبخ.</T> : null}</View>
      ) : (
        <View>
          <Card>
            <B size={17}>المطلوب طبخه</B>
            {k.totals.map((t) => <Row key={t.name} between style={{ paddingVertical: 4 }}><T>{t.emoji} {t.name}</T><Badge kind="info">{n(t.qty)} وجبة</Badge></Row>)}
            {k.pending_qty ? <T size={13} mute>+ {n(k.pending_qty)} وجبة بانتظار التأكيد، لا تدخل في الطبخ.</T> : null}
          </Card>
          {k.slots.map((s) => (
            <View key={s.deliver_at}>
              <T weight="700" style={{ marginVertical: 8 }}>خروج الساعة {fmtTime(s.deliver_at)}{s.deliveries.some((d) => d.is_asap) ? ' 🛵' : ''}</T>
              {s.deliveries.map((d) => (
                <Card key={d.delivery_id} onPress={() => open({ t: 'aorder', id: d.order_id })}>
                  <Row between><B>{d.is_asap ? '🛵 ' : ''}طلب #{oid(d.number)} · {d.customer_name}</B><Badge kind={DL[d.status][1]}>{DL[d.status][0]}</Badge></Row>
                  {d.items.map((i, x) => <T key={x} size={14}>{i.emoji} {i.name} ×{n(i.qty)}</T>)}
                  <T size={13} mute>{d.address_text}</T>
                  <Badge kind={d.payment_method === 'cod' ? 'warn' : 'ok'}>{d.payment_method === 'cod' ? 'كاش' : 'مدفوع مسبقاً'}</Badge>
                </Card>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

import React from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Callout, Card, Empty, Qty, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { groups, totals } from '../cart';
import { dayNum, fmtHM, monthName, money, n, wd } from '../format';
import { slotWarning } from '../slots';
import { Sum } from '../sheets/parts';

export default function CartScreen() {
  const { cart, menu, cfg, setQty, removeItem, open, go, toast } = useApp();
  const c = useTheme();
  if (!cart.length) return <Empty emoji="🗓️" text="جدولك فارغ. اختر وجبة وحدد يوم وساعة التوصيل." action={<Btn kind="primary" title="تصفح المنيو" onPress={() => go('menu')} />} />;
  const t = totals(cart, menu, cfg);
  const item = (id) => menu.items.find((m) => m.id === id);
  const checkout = () => {
    if (cfg.accepting_orders === false) return toast(cfg.closed_message || 'المطبخ لا يستقبل طلبات حالياً', true);
    const bad = cart.find((x) => { const m = item(x.mid); return !m || !m.available || (x.slot === 'asap' && !m.asap_ok); });
    if (bad) return toast('احذف الوجبات التي نفدت أو غير المتاحة للتوصيل السريع أولاً', true);
    if (groups(cart).some(([s]) => slotWarning(cfg, s))) return toast('عدّل المواعيد المعلّمة بالأحمر أولاً', true);
    open({ t: 'checkout' });
  };
  return (
    <View style={{ padding: 16 }}>
      <B size={20} style={{ marginBottom: 10 }}>جدول وجباتك</B>
      {groups(cart).map(([slot, rows]) => {
        const asap = slot === 'asap';
        const [d, tm] = asap ? [] : slot.split('|');
        const warn = slotWarning(cfg, slot);
        return (
          <Card key={slot} testID={asap ? 'slip-asap' : `slip-${slot}`} style={{ padding: 0, overflow: 'hidden' }}>
            <Row gap={0} center={false}>
              <View style={{ width: 76, backgroundColor: asap ? c.rush : c.teal, alignItems: 'center', justifyContent: 'center', padding: 8 }}>
                {asap ? <><T size={26} color="#fff" style={{ textAlign: 'center' }}>⚡</T><T size={11} color="#fff" style={{ textAlign: 'center' }}>خلال {n(cfg.asap.minutes)} د</T></> : <><T size={12} color="#fff" style={{ textAlign: 'center' }}>{wd(d)}</T><B size={26} color="#fff" style={{ textAlign: 'center' }}>{dayNum(d)}</B><T size={12} color="#fff" style={{ textAlign: 'center' }}>{monthName(d)}</T></>}
              </View>
              <View style={{ flex: 1, padding: 12 }}>
                <Row between><B>{asap ? 'طلب عادي (الآن)' : `الساعة ${fmtHM(tm)}`}</B>{asap ? null : <Btn testID={`move-${slot}`} sm kind="ghost" title="تغيير الموعد" onPress={() => open({ t: 'move', from: slot })} />}</Row>
                {warn ? <Callout kind="bad"><T size={13}>{warn}</T></Callout> : null}
                {rows.map((x) => {
                  const m = item(x.mid);
                  return (
                    <View key={x.id} style={{ paddingVertical: 8, borderTopWidth: 1, borderColor: c.line, marginTop: 6 }}>
                      <B>{m ? `${m.emoji} ${m.name}` : 'وجبة محذوفة'}</B>
                      <Row gap={6} wrap>
                        <T size={13} mute>{m ? money(m.price_cents) : ''}</T>
                        {m && !m.available ? <Badge kind="bad">نفدت</Badge> : null}
                        {m && asap && !m.asap_ok ? <Badge kind="bad">للطلب المجدول فقط</Badge> : null}
                      </Row>
                      <Row between style={{ marginTop: 6 }}>
                        <Qty testID={`qty-${x.id}`} value={x.qty} onChange={(v) => setQty(x.id, v)} />
                        <Btn testID={`del-${x.id}`} sm kind="danger" title="حذف" onPress={() => removeItem(x.id)} />
                      </Row>
                    </View>
                  );
                })}
              </View>
            </Row>
          </Card>
        );
      })}
      <Sum rows={[['عدد الوجبات', n(t.meals)], ['مواعيد التوصيل', n(t.days)], ['الوجبات', money(t.sub)], ['رسوم التوصيل', money(t.fee)]]} total={money(t.total)} />
      <Btn testID="checkout" kind="primary" wide title="إتمام الطلب" onPress={checkout} />
    </View>
  );
}

import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { B, Card, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { api } from '../api';
import { dayNum, money, n } from '../format';
import { usePoll } from './util';

function Stat({ label, value, alert }) {
  const c = useTheme();
  return <Card style={{ flex: 1, minWidth: 140, marginBottom: 0, padding: 12 }}><B size={20} color={alert ? c.bad : undefined}>{value}</B><T size={12} mute>{label}</T></Card>;
}

export default function AdminOverview() {
  const { rk, fail } = useApp();
  const c = useTheme();
  const [s, setS] = useState(null);
  const load = useCallback(async () => { try { setS(await api('GET', '/api/admin/stats')); } catch (e) { fail(e); } }, [fail]);
  usePoll(load, 30000, [load, rk]);
  if (!s) return null;
  const max = Math.max(1, ...s.sales_series.map((x) => x.cents));
  return (
    <View>
      <B size={20}>نظرة عامة</B>
      <Row gap={8} wrap center={false} style={{ marginVertical: 10 }}>
        <Stat label="مواعيد متأخرة" value={n(s.late)} alert={s.late > 0} />
        <Stat label="🛵 طلبات فورية نشطة" value={n(s.asap_active)} />
        <Stat label="مكالمات منتظرة" value={n(s.pending_calls)} />
        <Stat label="إيصالات للمراجعة" value={n(s.pending_receipts)} />
        <Stat label={`مواعيد اليوم (${n(s.meals_today)} وجبة)`} value={n(s.deliveries_today)} />
        <Stat label={`مبيعات مسلَّمة اليوم (${n(s.delivered_today)} تسليم)`} value={money(s.sales_today_cents)} />
        <Stat label="نقدية محصّلة اليوم" value={money(s.cash_today_cents)} />
        <Stat label="مستحق للاسترداد" value={money(s.refunds_due_cents)} alert={s.refunds_due_cents > 0} />
      </Row>
      <Card>
        <B size={16}>المبيعات المسلَّمة آخر ١٤ يوماً</B>
        <View testID="sales-chart" style={{ flexDirection: 'row-reverse', alignItems: 'flex-end', height: 140, gap: 4, marginTop: 12 }}>
          {s.sales_series.map((x) => (
            <View key={x.date} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <View style={{ width: '100%', height: `${Math.max(2, Math.round((x.cents / max) * 100))}%`, backgroundColor: c.teal, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
              <T size={10} mute style={{ textAlign: 'center' }}>{dayNum(x.date)}</T>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

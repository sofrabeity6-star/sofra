import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Card, Chip, Empty, Field, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { api } from '../api';
import { PAY, STAGES, dayShort, fmtDT, fmtTime, id as oid, money, n } from '../format';
import { SCOPES, SORTS, countdown, usePoll } from './util';

function Stat({ label, value, alert, onPress, testID }) {
  const c = useTheme();
  return (
    <Card testID={testID} onPress={onPress} style={{ flex: 1, minWidth: 100, marginBottom: 0, padding: 10 }}>
      <B size={22} color={alert && value > 0 ? c.bad : undefined}>{n(value)}</B><T size={12} mute>{label}</T>
    </Card>
  );
}

function OrderCard({ o, onPress }) {
  const c = useTheme();
  const cd = countdown(o);
  return (
    <Card testID={`aorder-${o.id}`} onPress={onPress} style={{ borderColor: o.is_late ? c.bad : c.line, borderStartWidth: undefined }}>
      <Row between>
        <B>#{oid(o.number)}{o.is_asap ? ' ⚡' : ''} · {o.customer_name}</B>
        <Badge kind={STAGES[o.stage][1]}>{STAGES[o.stage][0]}</Badge>
      </Row>
      {o.sort_delivery_at ? (
        <Row gap={6} wrap style={{ marginTop: 4 }}>
          <T weight="700">{dayShort(o.sort_delivery_at)} · {fmtTime(o.sort_delivery_at)}</T>
          {o.deliveries_count > 1 ? <T size={13} mute>· {n(o.deliveries_count)} مواعيد</T> : null}
          {cd ? <T size={13} weight="700" color={cd.kind === 'late' ? c.bad : c.rush}>{cd.text}</T> : null}
        </Row>
      ) : null}
      <Row between style={{ marginTop: 4 }}>
        <T size={13} mute>{PAY[o.payment_method]} · طُلب {fmtDT(o.created_at)}</T>
        <B>{money(o.total_cents)}</B>
      </Row>
    </Card>
  );
}

export default function AdminOrders() {
  const { open, rk, fail } = useApp();
  const [scope, setScope] = useState('open');
  const [sort, setSort] = useState('delivery');
  const [dir, setDir] = useState('asc');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [limit, setLimit] = useState(30);
  const [data, setData] = useState({ orders: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (loud) => {
    try {
      const p = new URLSearchParams({ scope, sort, dir, limit: String(limit) });
      if (q) p.set('q', q);
      const [l, s] = await Promise.all([api('GET', `/api/admin/orders?${p}`), api('GET', '/api/admin/stats')]);
      setData(l); setStats(s); setLoaded(true);
    } catch (e) { if (loud) fail(e); }
  }, [scope, sort, dir, q, limit, fail]);
  usePoll(() => load(!loaded), 15000, [load, rk]);

  return (
    <View style={{ padding: 16 }}>
      {stats ? (
        <Row gap={8} wrap center={false} style={{ marginBottom: 12 }}>
          <Stat testID="stat-late" label="مواعيد متأخرة" value={stats.late} alert />
          <Stat testID="stat-calls" label="مكالمات منتظرة" value={stats.pending_calls} onPress={() => setScope('calls')} />
          <Stat testID="stat-receipts" label="إيصالات للمراجعة" value={stats.pending_receipts} onPress={() => setScope('receipts')} />
          <Stat label="⚡ طلبات فورية" value={stats.asap_active} />
        </Row>
      ) : null}
      <Row wrap gap={8} style={{ marginBottom: 10 }}>
        {SCOPES.map(([k, l]) => <Chip key={k} testID={`scope-${k}`} on={scope === k} label={l} onPress={() => { setScope(k); setLimit(30); }} />)}
      </Row>
      <T weight="700" size={13} style={{ marginBottom: 6 }}>ترتيب حسب</T>
      <Row wrap gap={8} style={{ marginBottom: 10 }}>
        {SORTS.map(([k, l]) => <Chip key={k} testID={`sort-${k}`} on={sort === k} label={l} onPress={() => setSort(k)} />)}
        <Btn testID="dir" sm kind="tile" title={dir === 'asc' ? '▲ تصاعدي' : '▼ تنازلي'} onPress={() => setDir(dir === 'asc' ? 'desc' : 'asc')} />
      </Row>
      <Field testID="search" value={qInput} onChangeText={setQInput} placeholder="بحث برقم الطلب أو اسم العميل أو موبايله" returnKeyType="search" onSubmitEditing={() => { setQ(qInput.trim()); setLimit(30); }} style={{ marginTop: 0 }} />
      <T size={12} mute style={{ marginBottom: 8 }}>
        {n(data.total)} طلب · {SORTS.find((s) => s[0] === sort)[1]} {dir === 'asc' ? (sort === 'delivery' ? '(الأقرب أولاً)' : '(تصاعدي)') : (sort === 'delivery' ? '(الأبعد أولاً)' : '(تنازلي)')}
      </T>
      {data.orders.length ? data.orders.map((o) => <OrderCard key={o.id} o={o} onPress={() => open({ t: 'aorder', id: o.id })} />)
        : <Empty emoji="📭" text={loaded ? 'لا توجد طلبات في هذا العرض.' : 'جارٍ التحميل...'} />}
      {data.total > data.orders.length ? <Btn testID="more" kind="ghost" wide title="عرض المزيد" onPress={() => setLimit(limit + 30)} /> : null}
    </View>
  );
}

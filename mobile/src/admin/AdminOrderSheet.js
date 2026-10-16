import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, View } from 'react-native';
import { B, Badge, Btn, Callout, Card, Chip, Field, Loading, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { api, getBase, getToken } from '../api';
import { DL, PAY, STAGES, dayShort, fmtDT, fmtTime, id as oid, money, n } from '../format';

const NEXT_LABEL = { scheduled: 'ابدأ التجهيز', preparing: 'خرج للتوصيل', out_for_delivery: 'تم التسليم' };
const REASONS = ['الصورة غير واضحة', 'المبلغ غير مطابق', 'رقم المرجع غير صحيح', 'لم يصل التحويل إلى حسابنا'];

export default function AdminOrderSheet({ id }) {
  const { bump, toast, fail } = useApp();
  const c = useTheme();
  const [o, setO] = useState(null);
  const [note, setNote] = useState('');
  const [cash, setCash] = useState(false);
  const [rr, setRr] = useState(REASONS[0]);
  const [rc, setRc] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [reason, setReason] = useState('');
  const [cc, setCc] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try { const r = await api('GET', `/api/admin/orders/${id}`); if (alive.current) setO(r.order); } catch (e) { if (alive.current) fail(e); }
  }, [id, fail]);
  useEffect(() => {
    alive.current = true; load();
    const t = setInterval(load, 10000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  if (!o) return <Loading />;
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); setO(r.order); setCash(false); setCc(false); setNote(''); bump(); if (okMsg) toast(okMsg); }
    catch (e) { fail(e); if (e.status === 409) load(); } finally { setBusy(false); }
  };
  const post = (path, json) => api('POST', `/api/admin/${path}`, { json: json || {} });
  const pendingRec = o.receipts.filter((r) => r.status === 'pending').pop();
  const hasLive = o.deliveries.some((d) => !['delivered', 'cancelled'].includes(d.status));
  const asap = o.deliveries.some((d) => d.is_asap && !['delivered', 'cancelled'].includes(d.status));

  return (
    <View>
      <Row between><B size={20}>طلب #{oid(o.number)}</B><Badge kind={STAGES[o.stage][1]} testID="a-stage">{STAGES[o.stage][0]}</Badge></Row>
      <T size={13} mute>أُنشئ {fmtDT(o.created_at)} · {PAY[o.payment_method]} · الإجمالي {money(o.total_cents)}</T>
      <Card style={{ marginTop: 10 }}>
        <B>{o.customer_name}</B>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`tel:${o.customer_phone}`)}><T color={c.info} style={{ writingDirection: 'ltr' }}>{o.customer_phone}</T></Pressable>
        <T size={13} mute>{o.address_label}: {o.address_text}</T>
        {o.notes ? <T>ملاحظات العميل: {o.notes}</T> : null}
      </Card>

      {o.status === 'pending_phone_confirmation' ? (
        <Callout kind={asap ? 'rush' : 'warn'}>
          <B>{asap ? '🛵 طلب فوري: اتصل الآن. ' : ''}مكالمة التأكيد (دفع عند الاستلام)</B>
          <Btn testID="a-call" kind="gold" wide title={`اتصال بالعميل · ${o.customer_phone}`} onPress={() => Linking.openURL(`tel:${o.customer_phone}`)} />
          <Field label="ملاحظات المكالمة" multiline value={note} onChangeText={setNote} maxLength={500} />
          <Row gap={8}>
            <View style={{ flex: 2 }}><Btn testID="a-confirm" kind="primary" wide loading={busy} title="تم التأكيد هاتفياً" onPress={() => run(() => post(`orders/${o.id}/call`, { outcome: 'confirmed', note }), 'تم تأكيد الطلب')} /></View>
            <View style={{ flex: 1 }}><Btn testID="a-noanswer" wide title="لم يرد" onPress={() => run(() => post(`orders/${o.id}/call`, { outcome: 'no_answer', note }), 'سُجّلت محاولة بدون رد')} /></View>
          </Row>
          <Btn testID="a-callcancel" kind="danger" wide title="إلغاء الطلب (اكتب السبب في الملاحظات)" onPress={() => (note.trim() ? run(() => post(`orders/${o.id}/call`, { outcome: 'cancelled', note }), 'تم إلغاء الطلب') : toast('اكتب سبب الإلغاء في الملاحظات أولاً', true))} />
        </Callout>
      ) : null}

      {o.status === 'receipt_review' && pendingRec ? (
        <Callout kind="warn">
          <B>إيصال بانتظار المراجعة · المطلوب {money(o.total_cents)}</B>
          <T size={13}>مرجع التحويل: {pendingRec.reference || 'غير مذكور'}</T>
          <Image testID="a-receipt" source={{ uri: `${getBase()}/api/admin/receipts/${pendingRec.id}/file`, headers: { Authorization: `Bearer ${getToken()}` } }} style={{ width: '100%', height: 320, resizeMode: 'contain', borderRadius: 10, backgroundColor: c.tile }} />
          <Btn testID="a-approve" kind="primary" wide loading={busy} title="اعتماد الإيصال" onPress={() => run(() => post(`orders/${o.id}/receipt/review`, { approve: true }), 'تم اعتماد الإيصال')} />
          <T weight="700" size={13}>سبب الرفض</T>
          <Row wrap gap={6}>{REASONS.map((r) => <Chip key={r} on={rr === r} label={r} onPress={() => setRr(r)} />)}</Row>
          <Field label="تفاصيل إضافية (اختياري)" value={rc} onChangeText={setRc} />
          <Btn testID="a-reject" kind="danger" wide loading={busy} title="رفض الإيصال وإرسال السبب" onPress={() => run(() => post(`orders/${o.id}/receipt/review`, { approve: false, reason: rc.trim() ? `${rr}: ${rc.trim()}` : rr }), 'تم رفض الإيصال وإبلاغ العميل')} />
        </Callout>
      ) : null}
      {o.status === 'receipt_rejected' ? <Callout kind="bad"><B>تم رفض الإيصال</B><T size={13}>بانتظار أن يرفع العميل إيصالاً جديداً.</T></Callout> : null}

      <T weight="700" style={{ marginTop: 14, marginBottom: 8 }}>مواعيد التسليم</T>
      {o.deliveries.map((d) => {
        const live = o.status === 'confirmed' && NEXT_LABEL[d.status];
        const cod = o.payment_method === 'cod' && d.status === 'out_for_delivery';
        return (
          <Card key={d.id}>
            <Row between><B style={{ flex: 1 }}>{d.is_asap ? '🛵 ' : ''}{dayShort(d.deliver_at)} · {fmtTime(d.deliver_at)}</B><Badge kind={DL[d.status][1]}>{DL[d.status][0]}</Badge></Row>
            {d.items.map((i) => <T key={i.id} size={14}>{i.emoji} {i.name} ×{n(i.qty)}</T>)}
            <T size={13} mute>{money(d.subtotal_cents + d.fee_cents)}{d.cash_collected_cents ? ` · حُصّل نقداً ${money(d.cash_collected_cents)}` : ''}</T>
            {cod ? (
              <Pressable testID="a-cash" accessibilityRole="checkbox" accessibilityState={{ checked: cash }} onPress={() => setCash(!cash)} style={{ flexDirection: 'row-reverse', alignItems: 'center', gap: 10, marginVertical: 8 }}>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.teal, backgroundColor: cash ? c.teal : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{cash ? <T color="#fff" size={14}>✓</T> : null}</View>
                <T style={{ flex: 1 }}>استلمت {money(d.subtotal_cents + d.fee_cents)} نقداً من العميل</T>
              </Pressable>
            ) : null}
            {live ? <Btn testID={`a-advance-${d.id}`} kind="primary" wide loading={busy} title={NEXT_LABEL[d.status]} style={{ marginTop: 6 }}
              onPress={() => (cod && !cash ? toast('أكّد استلام المبلغ النقدي أولاً', true) : run(() => post(`deliveries/${d.id}/advance`, { cash_confirmed: cash })))} /> : null}
          </Card>
        );
      })}

      {o.refund_due_cents > 0 ? <Callout kind="warn"><B>مستحق للاسترداد: {money(o.refund_due_cents)}</B><Btn testID="a-refund" kind="gold" wide title="تم رد المبلغ للعميل" onPress={() => run(() => post(`orders/${o.id}/refund`), 'تم تسجيل الاسترداد')} /></Callout> : null}
      {o.refunded_cents > 0 ? <T size={13} mute>تم استرداد {money(o.refunded_cents)} سابقاً.</T> : null}

      {o.status !== 'cancelled' && hasLive ? (
        showCancel ? (
          <Card style={{ marginTop: 8 }}>
            <Field label="سبب الإلغاء (يصل للعميل)" value={reason} onChangeText={setReason} />
            <Btn testID="a-cancel" kind="danger" wide loading={busy} title={cc ? 'تأكيد الإلغاء' : 'إلغاء الطلب'}
              onPress={() => (reason.trim().length < 3 ? toast('اكتب سبب الإلغاء', true) : cc ? run(() => post(`orders/${o.id}/cancel`, { reason }), 'تم إلغاء الطلب') : setCc(true))} />
          </Card>
        ) : <Btn testID="a-cancel-open" kind="ghost" wide style={{ marginTop: 8 }} title="إلغاء الطلب..." onPress={() => setShowCancel(true)} />
      ) : null}

      {o.calls && o.calls.length ? (
        <View><T weight="700" style={{ marginTop: 14, marginBottom: 6 }}>سجل المكالمات</T>
          {o.calls.map((x) => <T key={x.id} size={13} mute>{fmtDT(x.created_at)} · {x.staff_name || ''} · {{ confirmed: 'تم التأكيد', no_answer: 'لم يرد', cancelled: 'إلغاء' }[x.outcome]}{x.note ? ` · ${x.note}` : ''}</T>)}</View>
      ) : null}
      <T weight="700" style={{ marginTop: 14, marginBottom: 6 }}>السجل</T>
      {o.events.slice().reverse().map((e, i) => <T key={i} size={13} mute>{fmtDT(e.created_at)} · {e.message}{e.actor_name ? ` (${e.actor_name})` : ''}</T>)}
    </View>
  );
}

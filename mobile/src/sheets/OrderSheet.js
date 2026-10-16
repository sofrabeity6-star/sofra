import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { B, Badge, Btn, Callout, Card, Row, Stepper, T, Loading } from '../ui';
import { useApp } from '../store';
import { api, appendImage } from '../api';
import { DL, PAY, STAGES, fmtDT, fmtDay, fmtTime, id as oid, money, n, now } from '../format';
import { Sum } from './parts';
import ReceiptPicker from './ReceiptPicker';

const PENDING = ['pending_phone_confirmation', 'receipt_review', 'receipt_rejected'];

export default function OrderSheet({ id }) {
  const { refreshOrders, repeatOrder, go, toast, fail } = useApp();
  const [order, setOrder] = useState(null);
  const [mode, setMode] = useState('view'); // view | reup
  const [sw, setSw] = useState(false);
  const [asset, setAsset] = useState(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [cc, setCc] = useState(false);
  const [cd, setCd] = useState(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try { const r = await api('GET', `/api/orders/${id}`); if (alive.current) setOrder(r.order); } catch (e) { if (alive.current) fail(e); }
  }, [id, fail]);
  useEffect(() => {
    alive.current = true; load();
    const t = setInterval(load, 10000); // تحديث حي أثناء فتح الطلب
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  if (!order) return <Loading />;
  const o = order;
  const apply = (r) => { setOrder(r.order); setMode('view'); setCc(false); setCd(null); setAsset(null); setRef(''); refreshOrders(); };
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { apply(await fn()); if (okMsg) toast(okMsg); }
    catch (e) { fail(e); if (e.status === 409) load(); } finally { setBusy(false); }
  };
  const submitReceipt = () => {
    if (!asset) return toast('ارفع صورة الإيصال أولاً', true);
    return run(async () => {
      const fd = new FormData();
      fd.append('reference', ref || '');
      await appendImage(fd, 'receipt', asset);
      return api('POST', `/api/orders/${o.id}${sw ? '/switch-to-prepaid' : '/receipt'}`, { form: fd });
    }, sw ? 'تم التحويل إلى الدفع المسبق' : 'تم إرسال الإيصال للمراجعة');
  };

  if (mode === 'reup') {
    return (
      <View>
        <B size={20}>{sw ? 'الدفع المسبق لطلب رقم ' : 'إيصال جديد لطلب رقم '}{oid(o.number)}</B>
        <ReceiptPicker amount={o.total_cents} asset={asset} onAsset={setAsset} reference={ref} onReference={setRef} />
        <Btn testID="reup-submit" kind="primary" wide loading={busy} title={sw ? 'تحويل الطلب إلى دفع مسبق' : 'إرسال الإيصال للمراجعة'} onPress={submitReceipt} />
        <Btn kind="ghost" wide style={{ marginTop: 8 }} title="رجوع" onPress={() => setMode('view')} />
      </View>
    );
  }

  const nextD = o.deliveries.find((d) => !['delivered', 'cancelled'].includes(d.status));
  const liveDeliveries = o.deliveries.filter((d) => d.status !== 'cancelled').length;
  const mins = nextD ? Math.round((Date.parse(nextD.deliver_at) - now().getTime()) / 60000) : 0;
  const lastRec = o.receipts[o.receipts.length - 1];
  return (
    <View>
      <B size={20}>طلب رقم {oid(o.number)}</B>
      <Row style={{ marginTop: 6 }}><Badge kind={STAGES[o.stage][1]} testID="order-stage">{STAGES[o.stage][0]}</Badge><T mute>{PAY[o.payment_method]}</T></Row>
      <Stepper order={o} />
      {nextD && nextD.is_asap && ['confirmed', 'preparing', 'out_for_delivery'].includes(o.stage) ? (
        <Callout kind="rush"><B>🛵 طلب عادي</B><T>{mins > 0 ? `يصلك خلال حوالي ${n(mins)} دقيقة (${fmtTime(nextD.deliver_at)})` : 'يصلك في أي لحظة'}</T></Callout>
      ) : null}
      {o.can_switch_to_prepaid ? (
        <Callout kind="warn"><B>سيتصل بك المطبخ لتأكيد الطلب قبل التجهيز.</B>
          <Btn testID="switch-prepay" kind="gold" wide title="تفضل الدفع الإلكتروني الآن؟ اضغط لرفع الإيصال" onPress={() => { setSw(true); setMode('reup'); }} /></Callout>
      ) : null}
      {o.status === 'receipt_rejected' ? (
        <Callout kind="bad"><B>تم رفض الإيصال</B><T>{lastRec && lastRec.reject_reason}</T>
          <Btn testID="reup-open" kind="primary" wide title="ارفع إيصالاً جديداً" onPress={() => { setSw(false); setMode('reup'); }} /></Callout>
      ) : null}
      {o.status === 'receipt_review' ? <T mute>إيصالك قيد المراجعة، وسيصلك إشعار فور اعتماده.</T> : null}
      {o.refund_due_cents > 0 ? <Callout kind="warn"><B>مبلغ {money(o.refund_due_cents)} مستحق الاسترداد</B><T size={13}>سيتواصل معك المطبخ لإرجاعه.</T></Callout> : null}
      <T weight="700" style={{ marginTop: 14, marginBottom: 8 }}>مواعيد التسليم</T>
      {o.deliveries.map((d) => {
        const st = PENDING.includes(o.status) && d.status === 'scheduled' ? ['بانتظار التأكيد', 'warn'] : DL[d.status];
        return (
          <Card key={d.id}>
            <Row between><B style={{ flex: 1 }}>{d.is_asap ? '⚡ ' : ''}{fmtDay(d.deliver_at)} · {fmtTime(d.deliver_at)}</B><Badge kind={st[1]}>{st[0]}</Badge></Row>
            {d.items.map((i) => <T key={i.id} size={14}>{i.emoji} {i.name} ×{n(i.qty)}</T>)}
            <Row between style={{ marginTop: 6 }}>
              <T size={13} mute>{money(d.subtotal_cents + d.fee_cents)} شامل التوصيل</T>
              {o.status === 'confirmed' && d.status === 'scheduled' && liveDeliveries > 1 ? (
                <Btn testID={`cancel-day-${d.id}`} sm kind="danger" loading={busy && cd === d.id} title={cd === d.id ? 'نعم، ألغِ هذا الموعد' : 'إلغاء هذا الموعد'}
                  onPress={() => (cd === d.id ? run(() => api('POST', `/api/orders/${o.id}/deliveries/${d.id}/cancel`, { json: {} }), 'تم إلغاء الموعد') : setCd(d.id))} />
              ) : null}
            </Row>
          </Card>
        );
      })}
      <Sum rows={[['عنوان التوصيل', o.address_label]]} total={money(o.total_cents)} />
      <T size={13} mute>{o.address_text}</T>
      {o.can_cancel ? (
        <Btn testID="cancel-order" kind="danger" wide style={{ marginTop: 12 }} loading={busy} title={cc ? 'نعم، ألغِ الطلب بالكامل' : 'إلغاء الطلب'}
          onPress={() => (cc ? run(() => api('POST', `/api/orders/${o.id}/cancel`, { json: {} }), 'تم إلغاء الطلب') : setCc(true))} />
      ) : !['delivered', 'cancelled'].includes(o.stage) ? <T size={13} mute style={{ marginTop: 10 }}>بدأ تجهيز الطلب فلا يمكن إلغاؤه لتجنب هدر الخامات.</T> : null}
      <Btn testID="repeat-order" wide style={{ marginTop: 8 }} title="كرر نفس الجدول" onPress={() => { const c = repeatOrder(o); go('cart'); toast(c ? `أُعيد الجدول بدءاً من الغد (${n(c)} بنود). راجع المواعيد قبل التأكيد.` : 'لا توجد وجبات متاحة لإعادتها', !c); }} />
      <T weight="700" style={{ marginTop: 16, marginBottom: 6 }}>سجل الطلب</T>
      {o.events.slice().reverse().map((e, i) => <T key={i} size={13} mute>{fmtDT(e.created_at)} · {e.message}</T>)}
    </View>
  );
}

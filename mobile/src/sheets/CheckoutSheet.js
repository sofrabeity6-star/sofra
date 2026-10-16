import React, { useState } from 'react';
import { View } from 'react-native';
import { B, Btn, Callout, Field, Row, T } from '../ui';
import { useApp } from '../store';
import { api, appendImage } from '../api';
import { buildDeliveries, totals } from '../cart';
import { money, n } from '../format';
import { Opt, Sum } from './parts';
import ReceiptPicker from './ReceiptPicker';

export default function CheckoutSheet() {
  const { cfg, menu, cart, addresses, addAddress, clearCart, refreshOrders, go, open, toast, fail } = useApp();
  const t = totals(cart, menu, cfg);
  const [addr, setAddr] = useState(addresses[0] && addresses[0].id);
  const payOptions = [cfg.transfer_enabled && 'transfer', cfg.cod_enabled && 'cod'].filter(Boolean);
  const [pay, setPay] = useState(payOptions[0] || 'transfer');
  const closed = cfg.accepting_orders === false;
  const [asset, setAsset] = useState(null);
  const [ref, setRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [na, setNa] = useState({ label: '', text: '' });
  const [showNa, setShowNa] = useState(!addresses.length);

  const saveAddr = async () => {
    try { const a = await addAddress(na.label || 'عنوان', na.text); setAddr(a.id); setNa({ label: '', text: '' }); setShowNa(false); } catch (e) { fail(e); }
  };
  const place = async () => {
    if (closed) return toast(cfg.closed_message || 'المطبخ لا يستقبل طلبات حالياً', true);
    if (!addr) return toast('اختر عنوان التوصيل أو أضف عنواناً', true);
    if (pay === 'transfer' && !asset) return toast('ارفع صورة إيصال التحويل أولاً', true);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('payload', JSON.stringify({ address_id: addr, payment_method: pay, notes, receipt_reference: ref, deliveries: buildDeliveries(cart) }));
      if (pay === 'transfer') await appendImage(fd, 'receipt', asset);
      const r = await api('POST', '/api/orders', { form: fd });
      clearCart(); refreshOrders(); go('orders'); open({ t: 'order', id: r.order.id });
      toast('تم إرسال طلبك بنجاح');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <View>
      <B size={20}>إتمام الطلب</B>
      {closed ? <Callout kind="bad"><B>المطبخ لا يستقبل طلبات حالياً</B>{cfg.closed_message ? <T>{cfg.closed_message}</T> : null}</Callout> : null}
      <Sum rows={[[`${n(t.meals)} وجبة في ${n(t.days)} مواعيد`, money(t.sub)], ['رسوم التوصيل', money(t.fee)]]} total={money(t.total)} />
      <T weight="700" style={{ marginTop: 8, marginBottom: 8 }}>عنوان التوصيل</T>
      {addresses.map((a) => <Opt key={a.id} testID={`addr-${a.id}`} on={addr === a.id} onPress={() => setAddr(a.id)} title={a.label} sub={a.text} />)}
      {showNa ? (
        <View>
          <Field label="التسمية" value={na.label} onChangeText={(v) => setNa({ ...na, label: v })} />
          <Field label="العنوان" multiline value={na.text} onChangeText={(v) => setNa({ ...na, text: v })} />
          <Btn sm title="حفظ واستخدام العنوان" onPress={saveAddr} />
        </View>
      ) : <Btn sm kind="ghost" title="+ إضافة عنوان جديد" onPress={() => setShowNa(true)} />}
      <T weight="700" style={{ marginTop: 16, marginBottom: 8 }}>طريقة الدفع</T>
      {cfg.transfer_enabled ? <Opt testID="pay-transfer" on={pay === 'transfer'} onPress={() => setPay('transfer')} title="تحويل إلكتروني" sub="إنستاباي أو محفظة أو بنك، مع رفع الإيصال" /> : null}
      {cfg.cod_enabled ? <Opt testID="pay-cod" on={pay === 'cod'} onPress={() => setPay('cod')} title="دفع عند الاستلام" sub="يبدأ التجهيز بعد مكالمة تأكيد قصيرة" /> : null}
      {pay === 'transfer'
        ? <ReceiptPicker amount={t.total} asset={asset} onAsset={setAsset} reference={ref} onReference={setRef} />
        : <Callout kind="warn"><B>مهم قبل التأكيد</B><T>لن يبدأ المطبخ التجهيز إلا بعد مكالمة هاتفية قصيرة لتأكيد الطلب. يمكنك التحويل إلى الدفع المسبق قبل أن نتصل بك.</T></Callout>}
      <Field label="ملاحظات للمطبخ (اختياري)" multiline value={notes} onChangeText={setNotes} maxLength={500} />
      <Btn testID="place-order" kind="primary" wide loading={busy} disabled={closed} title="تأكيد الطلب" onPress={place} />
    </View>
  );
}

import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { B, Btn, Card, Check, Chip, Field, Loading, Row, T } from '../ui';
import { useApp } from '../store';
import { api, appendImage, qrUrl } from '../api';
import { pickImage } from '../imagepick';

const num = (v) => Number(String(v).replace(',', '.'));

export default function AdminSettings() {
  const { toast, fail } = useApp();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const toForm = (s) => ({ ...s, delivery_fee: String(s.delivery_fee_cents / 100), asap_fee: String(s.asap_fee_cents / 100), payment_accounts: s.payment_accounts.map((a) => ({ ...a })) });
  useEffect(() => { api('GET', '/api/admin/settings').then((r) => setF(toForm(r.settings))).catch(fail); }, [fail]);
  if (!f) return <Loading />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const field = (k, label, props) => <Field label={label} value={String(f[k] ?? '')} onChangeText={set(k)} {...props} />;
  const acc = (i, k, v) => setF((x) => ({ ...x, payment_accounts: x.payment_accounts.map((a, j) => (j === i ? { ...a, [k]: v } : a)) }));
  // رفع صورة QR للحساب: تُرفع فوراً ثم تُحفظ مع الإعدادات
  const uploadQr = async (i) => {
    try {
      const asset = await pickImage('gallery');
      if (!asset) return;
      const fd = new FormData();
      await appendImage(fd, 'image', asset, 'qr.png');
      const r = await api('POST', '/api/admin/payment-qr', { form: fd });
      acc(i, 'qr', r.file);
      toast('تم رفع الكود. اضغط «حفظ الإعدادات» لتثبيته');
    } catch (e) { fail(e); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const body = {
        kitchen_name: f.kitchen_name, kitchen_phone: f.kitchen_phone || '', timezone: f.timezone, open_time: f.open_time, close_time: f.close_time,
        delivery_fee_cents: Math.round(num(f.delivery_fee) * 100), asap_enabled: !!f.asap_enabled, asap_minutes: num(f.asap_minutes), asap_fee_cents: Math.round(num(f.asap_fee) * 100),
        min_lead_minutes: num(f.min_lead_minutes), max_days_ahead: num(f.max_days_ahead), auto_prepare_minutes: num(f.auto_prepare_minutes), max_pending_cod: num(f.max_pending_cod),
        slot_minutes: Number(f.slot_minutes), cod_enabled: !!f.cod_enabled, transfer_enabled: !!f.transfer_enabled,
        accepting_orders: !!f.accepting_orders, closed_message: f.closed_message || '', announcement: f.announcement || '',
        payment_accounts: f.payment_accounts.filter((a) => a.label.trim() && a.value.trim()).map((a) => ({ label: a.label, value: a.value, qr: a.qr || null })),
      };
      const r = await api('PUT', '/api/admin/settings', { json: body });
      setF(toForm(r.settings)); toast('تم حفظ الإعدادات');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <View>
      <B size={20}>الإعدادات</B>
      <Card style={{ marginTop: 10 }}>
        <B>استقبال الطلبات والإعلان</B>
        <Check testID="set-accepting" label="المطبخ يستقبل الطلبات الآن" value={f.accepting_orders} onChange={set('accepting_orders')} />
        {!f.accepting_orders ? field('closed_message', 'رسالة تظهر للعملاء عند الإيقاف', { placeholder: 'مثال: مغلقون اليوم، نعود غداً' }) : null}
        {field('announcement', 'إعلان يظهر أعلى المنيو (اختياري)', { multiline: true, placeholder: 'مثال: عرض خاص يوم الجمعة' })}
      </Card>
      <Card>
        <B>المطبخ</B>
        {field('kitchen_name', 'اسم المطبخ')}
        {field('kitchen_phone', 'رقم موبايل المطبخ (يظهر للعملاء للاستفسارات)', { keyboardType: 'phone-pad', ltr: true })}
        <Row gap={10} center={false}>
          <View style={{ flex: 1 }}>{field('open_time', 'ساعة الفتح (HH:MM)', { ltr: true, placeholder: '10:00' })}</View>
          <View style={{ flex: 1 }}>{field('close_time', 'ساعة الإغلاق (HH:MM)', { ltr: true, placeholder: '23:00' })}</View>
        </Row>
        {field('timezone', 'المنطقة الزمنية', { ltr: true, autoCapitalize: 'none' })}
      </Card>
      <Card>
        <B>التوصيل والجدولة</B>
        {field('delivery_fee', 'رسوم التوصيل لكل موعد (ج.م)', { keyboardType: 'decimal-pad', ltr: true })}
        <T size={14} weight="500" style={{ marginTop: 8, marginBottom: 6 }}>الفاصل بين أوقات التسليم المتاحة</T>
        <Row gap={8}>{[15, 30, 60].map((m) => <Chip key={m} testID={`slot-${m}`} on={Number(f.slot_minutes) === m} label={`${m} دقيقة`} onPress={() => set('slot_minutes')(m)} />)}</Row>
        {field('min_lead_minutes', 'أقل مهلة للطلب المجدول (دقيقة)', { keyboardType: 'number-pad', ltr: true })}
        {field('max_days_ahead', 'أقصى مدة للجدولة (يوم)', { keyboardType: 'number-pad', ltr: true })}
        {field('auto_prepare_minutes', 'بدء التجهيز التلقائي قبل الموعد (دقيقة، 0 = يدوي)', { keyboardType: 'number-pad', ltr: true })}
        {field('max_pending_cod', 'أقصى طلبات كاش معلقة للعميل', { keyboardType: 'number-pad', ltr: true })}
      </Card>
      <Card>
        <B>الطلب الفوري (العادي)</B>
        <Check label="مفعّل" value={f.asap_enabled} onChange={set('asap_enabled')} />
        {field('asap_minutes', 'مدة التجهيز والتوصيل (دقيقة)', { keyboardType: 'number-pad', ltr: true })}
        {field('asap_fee', 'رسوم توصيل الطلب الفوري (ج.م)', { keyboardType: 'decimal-pad', ltr: true })}
      </Card>
      <Card>
        <B>طرق الدفع</B>
        <Check testID="set-transfer" label="التحويل الإلكتروني (مع رفع الإيصال)" value={f.transfer_enabled} onChange={set('transfer_enabled')} />
        <Check testID="set-cod" label="الدفع عند الاستلام (بعد مكالمة التأكيد)" value={f.cod_enabled} onChange={set('cod_enabled')} />
      </Card>
      <Card>
        <B>حسابات التحويل</B>
        <T size={13} mute>تظهر للعميل تحت «تحويل إلكتروني»، ومعها كود QR إن أضفته ليمسحه ويحوّل مباشرة.</T>
        {f.payment_accounts.map((a, i) => (
          <View key={i} testID={`acc-${i}`} style={{ borderTopWidth: i ? 1 : 0, borderColor: '#8883', paddingTop: i ? 8 : 0, marginTop: 8 }}>
            <Row gap={6} center={false}>
              <View style={{ flex: 1 }}><Field value={a.label} onChangeText={(v) => acc(i, 'label', v)} placeholder="الاسم (إنستاباي، فودافون كاش...)" /></View>
              <View style={{ flex: 1 }}><Field value={a.value} onChangeText={(v) => acc(i, 'value', v)} placeholder="الرقم أو العنوان" ltr /></View>
            </Row>
            <Row gap={8} wrap>
              <Btn testID={`qr-upload-${i}`} sm title={a.qr ? 'تغيير كود QR' : 'رفع كود QR'} onPress={() => uploadQr(i)} />
              {a.qr ? <Btn sm kind="ghost" title="إزالة الكود" onPress={() => acc(i, 'qr', null)} /> : null}
              <Btn sm kind="danger" title="حذف الحساب" onPress={() => setF((x) => ({ ...x, payment_accounts: x.payment_accounts.filter((_, j) => j !== i) }))} />
            </Row>
            {a.qr ? <Image testID={`qr-preview-${i}`} source={{ uri: qrUrl(a.qr) }} style={{ width: 130, height: 130, marginTop: 8, borderRadius: 10, backgroundColor: '#fff' }} resizeMode="contain" /> : null}
          </View>
        ))}
        <Btn testID="acc-add" sm kind="ghost" title="+ إضافة حساب" style={{ marginTop: 10 }} onPress={() => setF((x) => ({ ...x, payment_accounts: [...x.payment_accounts, { label: '', value: '', qr: null }] }))} />
      </Card>
      <Btn testID="settings-save" kind="primary" wide loading={busy} title="حفظ الإعدادات" onPress={save} />
    </View>
  );
}

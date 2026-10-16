import React from 'react';
import { Image, Linking, Platform, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { pickImage as pick } from '../imagepick';
import { B, Btn, Card, Field, Row, T } from '../ui';
import { money } from '../format';
import { qrUrl } from '../api';
import { useTheme } from '../theme';
import { useApp } from '../store';

// حسابات التحويل (مع كود QR إن أضافه المدير) + رقم المطبخ للاستفسار + رقم المرجع + صورة الإيصال
export default function ReceiptPicker({ amount, asset, onAsset, reference, onReference }) {
  const { cfg, toast, fail } = useApp();
  const c = useTheme();
  const copy = async (v) => { try { await Clipboard.setStringAsync(v); toast('تم النسخ: ' + v); } catch (e) { fail(e); } };
  const choose = async (kind) => { try { const a = await pick(kind); if (a) onAsset(a); } catch (e) { fail(e); } };
  const accounts = cfg.payment_accounts || [];
  return (
    <Card style={{ marginTop: 6 }}>
      <B>حوّل {money(amount)} إلى أحد الحسابات</B>
      <T size={13} mute>امسح كود QR أو انسخ الرقم وحوّل المبلغ، ثم ارفع صورة الإيصال هنا.</T>
      {accounts.length ? accounts.map((a, i) => (
        <View key={a.label + a.value} testID={`account-${i}`} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: c.line, marginTop: i ? 6 : 8 }}>
          <Row between>
            <View style={{ flex: 1 }}><B size={16}>{a.label}</B><T style={{ writingDirection: 'ltr', textAlign: 'right', fontWeight: '700' }}>{a.value}</T></View>
            <Btn testID={`copy-${i}`} sm title="نسخ" onPress={() => copy(a.value)} />
          </Row>
          {a.qr ? (
            <View style={{ alignItems: 'center', marginTop: 10, gap: 4 }}>
              <Image testID={`qr-${i}`} source={{ uri: qrUrl(a.qr) }} style={{ width: 200, height: 200, borderRadius: 12, backgroundColor: '#fff' }} resizeMode="contain" />
              <T size={12} mute style={{ textAlign: 'center' }}>امسح الكود من تطبيق {a.label} لتحويل المبلغ مباشرة</T>
            </View>
          ) : null}
        </View>
      )) : <T mute style={{ marginTop: 8 }}>لم تُضَف حسابات التحويل بعد.</T>}
      <Row between style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderColor: c.line }}>
        <T size={13} mute style={{ flex: 1 }}>للاستفسارات تواصل مع المطبخ</T>
        {cfg.kitchen_phone ? <Btn testID="call-kitchen" sm kind="ghost" title={`📞 ${cfg.kitchen_phone}`} onPress={() => Linking.openURL(`tel:${cfg.kitchen_phone}`)} /> : null}
      </Row>
      <Field label="رقم مرجع التحويل (اختياري)" value={reference} onChangeText={onReference} keyboardType="number-pad" ltr />
      <T size={14} weight="500" style={{ marginBottom: 6 }}>صورة الإيصال</T>
      <Row gap={8}>
        <Btn testID="pick-gallery" sm title="من المعرض" onPress={() => choose('gallery')} />
        {Platform.OS !== 'web' ? <Btn testID="pick-camera" sm title="التقاط صورة" onPress={() => choose('camera')} /> : null}
      </Row>
      {asset ? <Image testID="receipt-preview" source={{ uri: asset.uri }} style={{ width: '100%', height: 200, resizeMode: 'contain', marginTop: 10, borderRadius: 10 }} /> : <T size={13} mute style={{ marginTop: 8 }}>لم يتم اختيار صورة بعد.</T>}
    </Card>
  );
}

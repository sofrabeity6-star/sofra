import React from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { ROW, useTheme } from './theme';

export function T({ size = 15, weight = '400', color, mute, style, children, ...rest }) {
  const c = useTheme();
  return <Text {...rest} style={[{ fontSize: size, fontWeight: weight, color: color || (mute ? c.mute : c.ink), textAlign: 'right', writingDirection: 'rtl', lineHeight: Math.round(size * 1.55) }, style]}>{children}</Text>;
}
export const B = (p) => <T weight="700" {...p} />;

export function Row({ gap = 10, wrap, between, center = true, style, children, ...rest }) {
  return <View {...rest} style={[{ flexDirection: ROW, alignItems: center ? 'center' : 'flex-start', gap, flexWrap: wrap ? 'wrap' : 'nowrap', justifyContent: between ? 'space-between' : 'flex-start' }, style]}>{children}</View>;
}

export function Card({ onPress, style, children, testID }) {
  const c = useTheme();
  const base = { backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 };
  if (onPress) return <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }, style]}>{children}</Pressable>;
  return <View testID={testID} style={[base, style]}>{children}</View>;
}

export function Btn({ title, onPress, kind = 'tile', sm, wide, disabled, loading, testID, style }) {
  const c = useTheme();
  const k = { primary: [c.teal, c.onTeal], gold: [c.gold, c.onGold], danger: [c.badbg, c.bad], tile: [c.tile, c.ink], ghost: ['transparent', c.ink] }[kind];
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={title} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => [{ backgroundColor: k[0], borderRadius: 10, paddingVertical: sm ? 7 : 12, paddingHorizontal: sm ? 12 : 16, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.85 : 1, alignSelf: wide ? 'stretch' : 'auto', borderWidth: kind === 'ghost' ? 1 : 0, borderColor: c.line }, style]}>
      {loading ? <ActivityIndicator color={k[1]} /> : <Text style={{ color: k[1], fontWeight: '700', fontSize: sm ? 13 : 15 }}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ kind = 'info', children, testID }) {
  const c = useTheme();
  const m = { warn: [c.warnbg, c.warn], bad: [c.badbg, c.bad], ok: [c.okbg, c.ok], info: [c.infobg, c.info], rush: [c.rushbg, c.rush] }[kind];
  return <View testID={testID} style={{ backgroundColor: m[0], borderRadius: 20, paddingHorizontal: 11, paddingVertical: 2, alignSelf: 'flex-start' }}><Text style={{ color: m[1], fontSize: 12.5, fontWeight: '700' }}>{children}</Text></View>;
}

export function Field({ label, style, inputStyle, ltr, multiline, ...rest }) {
  const c = useTheme();
  return (
    <View style={[{ marginVertical: 8 }, style]}>
      {label ? <T size={14} weight="500" style={{ marginBottom: 4 }}>{label}</T> : null}
      <TextInput {...rest} multiline={multiline} placeholderTextColor={c.mute}
        style={[{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: c.ink, textAlign: 'right', writingDirection: ltr ? 'ltr' : 'rtl', minHeight: multiline ? 80 : undefined, textAlignVertical: multiline ? 'top' : 'center' }, inputStyle]} />
    </View>
  );
}

export function Chip({ label, on, onPress, testID, disabled }) {
  const c = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={{ borderWidth: 1, borderColor: on ? c.teal : c.line, backgroundColor: on ? c.teal : c.card, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: on ? c.onTeal : c.ink, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}

export function Callout({ kind = 'warn', children }) {
  const c = useTheme();
  const bg = { warn: c.warnbg, bad: c.badbg, rush: c.rushbg, ok: c.okbg }[kind];
  return <View style={{ backgroundColor: bg, borderRadius: 12, padding: 12, marginVertical: 10, gap: 8 }}>{children}</View>;
}

export function Empty({ emoji, text, action }) {
  return <View style={{ alignItems: 'center', padding: 32, gap: 8 }}><Text style={{ fontSize: 44 }}>{emoji}</Text><T mute style={{ textAlign: 'center' }}>{text}</T>{action}</View>;
}

export function Qty({ value, onChange, testID }) {
  const c = useTheme();
  const b = { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: c.line, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center' };
  return (
    <Row gap={6} testID={testID}>
      <Pressable accessibilityLabel="زيادة" testID={testID && testID + '-plus'} style={b} onPress={() => onChange(value + 1)}><Text style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>+</Text></Pressable>
      <T weight="700" style={{ minWidth: 24, textAlign: 'center' }}>{String(value).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d])}</T>
      <Pressable accessibilityLabel="إنقاص" testID={testID && testID + '-minus'} style={b} onPress={() => onChange(value - 1)}><Text style={{ color: c.ink, fontWeight: '700', fontSize: 18 }}>−</Text></Pressable>
    </Row>
  );
}

export function Stepper({ order }) {
  const c = useTheme();
  if (order.stage === 'cancelled') return <Badge kind="bad">تم إلغاء الطلب</Badge>;
  const STEP = { pending_phone_confirmation: 1, receipt_review: 1, receipt_rejected: 1, confirmed: 2, preparing: 2, out_for_delivery: 3, delivered: 5 };
  const labels = ['تم الطلب', order.payment_method === 'cod' ? 'تأكيد المكالمة' : 'تأكيد الدفع', 'المطبخ يجهز', 'في الطريق', 'تم التسليم'];
  const done = STEP[order.stage];
  return (
    <Row center={false} gap={0} style={{ marginVertical: 14 }} testID="stepper">
      {labels.map((l, i) => (
        <View key={l} style={{ flex: 1, alignItems: 'center' }}>
          <View style={{ flexDirection: ROW, alignItems: 'center', width: '100%' }}>
            <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : (i <= done ? c.teal : c.line) }} />
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: i < done ? c.teal : i === done ? c.gold : c.line, backgroundColor: i < done ? c.teal : i === done ? c.gold : c.tile }}>
              {i < done ? <Text style={{ color: c.onTeal, fontSize: 12, fontWeight: '700' }}>✓</Text> : null}
            </View>
            <View style={{ flex: 1, height: 2, backgroundColor: i === labels.length - 1 ? 'transparent' : (i < done ? c.teal : c.line) }} />
          </View>
          <T size={11} weight={i <= done ? '700' : '400'} mute={i > done} style={{ textAlign: 'center', marginTop: 4 }}>{l}</T>
        </View>
      ))}
    </Row>
  );
}

// نافذة سفلية: خلفية معتمة، ومحتوى قابل للتمرير
export function Sheet({ visible, onClose, children }) {
  const c = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="إغلاق" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.scrim }} onPress={onClose} />
        <View style={{ maxHeight: '92%', width: '100%', maxWidth: 720, alignSelf: 'center', backgroundColor: c.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }} testID="sheet">
          <Pressable testID="sheet-close" accessibilityLabel="إغلاق" onPress={onClose} style={{ position: 'absolute', top: 10, left: 12, zIndex: 5, width: 34, height: 34, borderRadius: 17, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: c.ink, fontSize: 15 }}>✕</Text>
          </Pressable>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 22, paddingBottom: 34 }}>{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const Loading = () => <View style={{ padding: 30 }}><ActivityIndicator /></View>;

// خانة اختيار (تشغيل/إيقاف) بنص
export function Check({ label, value, onChange, testID }) {
  const c = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: !!value }} onPress={() => onChange(!value)} style={{ flexDirection: ROW, alignItems: 'center', gap: 10, paddingVertical: 8 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: c.teal, backgroundColor: value ? c.teal : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {value ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>✓</Text> : null}
      </View>
      <T style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}

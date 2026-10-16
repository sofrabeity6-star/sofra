import React from 'react';
import { Pressable, View } from 'react-native';
import { T, B, Row } from '../ui';
import { useTheme } from '../theme';

// خيار قابل للاختيار (طريقة دفع، عنوان، وقت توصيل...)
export function Opt({ on, onPress, title, sub, disabled, testID }) {
  const c = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: !!on, disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ borderWidth: 1.5, borderColor: on ? c.teal : c.line, backgroundColor: c.card, borderRadius: 12, padding: 12, marginBottom: 8, opacity: disabled ? 0.55 : 1 }}>
      <B size={15}>{title}</B>
      {sub ? <T size={13} mute>{sub}</T> : null}
    </Pressable>
  );
}

export function Sum({ rows, total }) {
  const c = useTheme();
  return (
    <View style={{ backgroundColor: c.card, borderColor: c.line, borderWidth: 1, borderRadius: 14, padding: 14, marginVertical: 10 }}>
      {rows.map(([k, v]) => <Row key={k} between style={{ paddingVertical: 2 }}><T>{k}</T><B>{v}</B></Row>)}
      <Row between style={{ borderTopWidth: 1, borderColor: c.line, borderStyle: 'dashed', marginTop: 6, paddingTop: 8 }}><B size={18}>الإجمالي</B><B size={18}>{total}</B></Row>
    </View>
  );
}

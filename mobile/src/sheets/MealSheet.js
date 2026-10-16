import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { B, Btn, Callout, Qty, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { dayLabel, fmtHM, money, n } from '../format';
import { firstSlot, fixTime, timesFor } from '../slots';
import { mediaUrl } from '../api';
import SlotPicker from './SlotPicker';

export default function MealSheet({ id, mode }) {
  const { cfg, menu, addToCart, close, toast } = useApp();
  const c = useTheme();
  const m = menu.items.find((x) => x.id === id);
  const a = cfg.asap;
  const [qty, setQty] = useState(1);
  const [slot, setSlot] = useState(firstSlot(cfg));
  const add = () => {
    const s = fixTime(cfg, slot);
    if (mode === 'later' && !timesFor(cfg, s.date).length) return;
    addToCart(m.id, qty, mode === 'asap' ? 'asap' : `${s.date}|${s.time}`);
    close();
    toast(mode === 'asap' ? 'أُضيفت إلى طلبك الفوري' : `أُضيفت إلى جدولك: ${dayLabel(s.date)} ${fmtHM(s.time)}`);
  };
  return (
    <View>
      <Row gap={12} style={{ marginBottom: 6 }}>
        <View style={{ width: 72, height: 72, borderRadius: 12, backgroundColor: c.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {m.image ? <Image source={{ uri: mediaUrl(m.image) }} style={{ width: 72, height: 72 }} /> : <T size={38}>{m.emoji}</T>}
        </View>
        <View style={{ flex: 1 }}><B size={20}>{m.name}</B><T size={13} mute>{m.description}</T><B>{money(m.price_cents)}</B></View>
      </Row>
      {mode === 'asap' ? (
        <Callout kind="rush"><B>🛵 طلب عادي</B><T size={13}>يتجهز ويصلك خلال حوالي {n(a.minutes)} دقيقة · رسوم التوصيل {money(a.fee_cents)}</T></Callout>
      ) : <SlotPicker cfg={cfg} value={slot} onChange={setSlot} />}
      <T weight="700" style={{ marginTop: 14, marginBottom: 8 }}>الكمية</T>
      <Row style={{ marginBottom: 16 }}><Qty testID="meal-qty" value={qty} onChange={(v) => setQty(Math.max(1, Math.min(50, v)))} /></Row>
      <Btn testID="add-cart" kind="primary" wide disabled={mode === 'later' && !timesFor(cfg, fixTime(cfg, slot).date).length} title={`${mode === 'asap' ? 'أضف إلى الطلب' : 'أضف إلى جدولي'} · ${money(m.price_cents * qty)}`} onPress={add} />
    </View>
  );
}

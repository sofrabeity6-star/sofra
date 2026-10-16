import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { B, Btn, T, Card } from '../ui';
import { useApp } from '../store';
import { fmtDT } from '../format';
import { fixTime } from '../slots';
import SlotPicker from './SlotPicker';

export function MoveSheet({ from }) {
  const { cfg, moveSlot, close, toast } = useApp();
  const [d, t] = from.split('|');
  const [slot, setSlot] = useState({ date: d, time: t });
  const save = () => { const s = fixTime(cfg, slot); moveSlot(from, `${s.date}|${s.time}`); close(); toast('تم تغيير الموعد'); };
  return (
    <View>
      <B size={20}>تغيير موعد التوصيل</B>
      <SlotPicker cfg={cfg} value={slot} onChange={setSlot} />
      <Btn kind="primary" wide style={{ marginTop: 16 }} title="حفظ الموعد الجديد" onPress={save} />
    </View>
  );
}

export function NotesSheet() {
  const { notes, markNotesRead, fail } = useApp();
  const [snapshot] = useState(notes.list);
  useEffect(() => { if (notes.unread) markNotesRead().catch(fail); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View>
      <B size={20}>الإشعارات</B>
      {snapshot.length ? snapshot.map((x) => (
        <Card key={x.id} style={{ marginTop: 8, marginBottom: 0 }}><T weight={x.read ? '400' : '700'}>{x.message}</T><T size={12} mute>{fmtDT(x.created_at)}</T></Card>
      )) : <T mute style={{ marginTop: 10 }}>لا توجد إشعارات.</T>}
    </View>
  );
}

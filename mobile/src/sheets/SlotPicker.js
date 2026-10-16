import React, { useState } from 'react';
import { View } from 'react-native';
import { Chip, Callout, Row, T } from '../ui';
import { addDays, dayNum, fmtHM, today, wd } from '../format';
import { fixTime, timesFor } from '../slots';

// اختيار يوم وساعة التوصيل. القيمة: { date, time }
export default function SlotPicker({ cfg, value, onChange }) {
  const [more, setMore] = useState(false);
  const v = fixTime(cfg, value);
  const count = more ? cfg.max_days_ahead + 1 : 14;
  const days = Array.from({ length: count }, (_, i) => addDays(today(), i));
  const times = timesFor(cfg, v.date);
  return (
    <View>
      <T weight="700" style={{ marginTop: 14, marginBottom: 8 }}>يوم التوصيل</T>
      <Row wrap gap={8} testID="day-chips">
        {days.map((d) => (
          <Chip key={d} testID={`day-${d}`} on={v.date === d} disabled={!timesFor(cfg, d).length} label={`${wd(d)} ${dayNum(d)}`} onPress={() => onChange(fixTime(cfg, { date: d, time: v.time }))} />
        ))}
        {!more && cfg.max_days_ahead > 13 ? <Chip label="المزيد من الأيام" onPress={() => setMore(true)} /> : null}
      </Row>
      <T weight="700" style={{ marginTop: 14, marginBottom: 8 }}>ساعة الوصول</T>
      {times.length ? (
        <Row wrap gap={8} testID="time-chips">
          {times.map((t) => <Chip key={t} testID={`time-${t}`} on={v.time === t} label={fmtHM(t)} onPress={() => onChange({ date: v.date, time: t })} />)}
        </Row>
      ) : <Callout kind="bad"><T size={13}>لا توجد مواعيد متاحة في هذا اليوم. اختر يوماً آخر.</T></Callout>}
    </View>
  );
}

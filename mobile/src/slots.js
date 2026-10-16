import { addDays, now, parts, today, tmin } from './format';

// أقرب وقت مسموح للطلب المجدول = الآن + المهلة الدنيا
export const minAllowed = (cfg) => parts(new Date(now().getTime() + cfg.min_lead_minutes * 60000));

// الأوقات المتاحة (كل 30 دقيقة) داخل ساعات عمل المطبخ لتاريخ معين
export function timesFor(cfg, date) {
  const a = tmin(cfg.open_time), b = tmin(cfg.close_time), min = minAllowed(cfg);
  if (date < min.date) return [];
  const out = [];
  const step = cfg.slot_minutes || 30;
  for (let m = a; m <= b; m += step) {
    if (date === min.date && m < min.minutes) continue;
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

export function firstSlot(cfg) {
  for (let i = 0; i < 14; i++) {
    const d = addDays(today(), i), t = timesFor(cfg, d);
    if (t.length) return { date: d, time: t.find((x) => x >= '14:00') || t[0] };
  }
  return { date: addDays(today(), 1), time: '14:00' };
}

export function fixTime(cfg, slot) {
  const t = timesFor(cfg, slot.date);
  if (t.length && !t.includes(slot.time)) return { ...slot, time: t.find((x) => x >= slot.time) || t[0] };
  return slot;
}

export function slotWarning(cfg, slot) {
  if (slot === 'asap') return cfg.asap.available ? '' : cfg.asap.reason;
  const [d, t] = slot.split('|'), min = minAllowed(cfg);
  if (d < min.date || (d === min.date && tmin(t) < min.minutes)) return 'هذا الموعد أصبح قريباً جداً. غيّر الموعد أو اطلب الآن (طلب عادي).';
  return '';
}

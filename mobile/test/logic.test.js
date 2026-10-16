import { digits, money, n, id, parts, addDays, fmtHM, dayLabel, setClock, wd } from '../src/format';
import { timesFor, firstSlot, slotWarning } from '../src/slots';
import { groups, totals, buildDeliveries, repeatItems } from '../src/cart';

const cfg = { open_time: '10:00', close_time: '23:00', min_lead_minutes: 120, max_days_ahead: 45, delivery_fee_cents: 2000, asap: { available: true, enabled: true, minutes: 60, fee_cents: 3000, reason: null } };
// 2026-10-03 09:00Z = 12:00 بتوقيت القاهرة
beforeEach(() => setClock('Africa/Cairo', '2026-10-03T09:00:00.000Z'));

test('تنسيق الأرقام والمال بالعربية', () => {
  expect(digits('2026')).toBe('٢٠٢٦');
  expect(n(1234567)).toBe('١٬٢٣٤٬٥٦٧');
  expect(id(1003)).toBe('١٠٠٣');
  expect(money(14500)).toBe('١٤٥ ج.م');
  expect(money(14550)).toBe('١٤٥٫٥ ج.م');
  expect(money(2000)).toBe('٢٠ ج.م');
});

test('الوقت والتواريخ بتوقيت القاهرة', () => {
  expect(parts('2026-10-05T11:00:00.000Z')).toEqual({ date: '2026-10-05', time: '14:00', minutes: 840 });
  expect(parts('2026-12-01T12:00:00.000Z').time).toBe('14:00'); // شتوي UTC+2
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(fmtHM('14:30')).toBe('٢:٣٠ م');
  expect(fmtHM('00:05')).toBe('١٢:٠٥ ص');
  expect(dayLabel('2026-10-05')).toBe('الاثنين ٥ أكتوبر');
  expect(wd('2026-10-03')).toBe('السبت');
});

test('المواعيد المتاحة تحترم ساعات العمل والمهلة الدنيا', () => {
  const today = timesFor(cfg, '2026-10-03');
  expect(today[0]).toBe('14:00'); // الآن 12:00 + ساعتان
  expect(today[today.length - 1]).toBe('23:00');
  expect(timesFor(cfg, '2026-10-02')).toEqual([]);
  expect(timesFor(cfg, '2026-10-04')[0]).toBe('10:00');
  expect(firstSlot(cfg)).toEqual({ date: '2026-10-03', time: '14:00' });
  expect(slotWarning(cfg, '2026-10-03|13:00')).toMatch(/قريباً/);
  expect(slotWarning(cfg, '2026-10-03|15:00')).toBe('');
  expect(slotWarning({ ...cfg, asap: { ...cfg.asap, available: false, reason: 'مغلق' } }, 'asap')).toBe('مغلق');
});

test('فاصل الأوقات قابل للضبط من الإدارة', () => {
  const t60 = timesFor({ ...cfg, slot_minutes: 60 }, '2026-10-04');
  expect(t60.slice(0, 3)).toEqual(['10:00', '11:00', '12:00']);
  const t15 = timesFor({ ...cfg, slot_minutes: 15 }, '2026-10-04');
  expect(t15.slice(0, 3)).toEqual(['10:00', '10:15', '10:30']);
});

const menu = { items: [{ id: 1, price_cents: 14500, available: 1, asap_ok: 0 }, { id: 2, price_cents: 13000, available: 1, asap_ok: 1 }] };
test('السلة: التجميع بالمواعيد والإجماليات وبناء الطلب', () => {
  const cart = [{ id: 'a', mid: 1, qty: 2, slot: '2026-10-06|14:00' }, { id: 'b', mid: 2, qty: 1, slot: 'asap' }, { id: 'c', mid: 2, qty: 1, slot: '2026-10-05|12:00' }];
  expect(groups(cart).map((g) => g[0])).toEqual(['asap', '2026-10-05|12:00', '2026-10-06|14:00']);
  expect(totals(cart, menu, cfg)).toEqual({ meals: 4, days: 3, sub: 29000 + 13000 + 13000, fee: 3000 + 2000 + 2000, total: 55000 + 7000 });
  expect(buildDeliveries(cart)[0]).toEqual({ asap: true, items: [{ menu_item_id: 2, qty: 1 }] });
  expect(buildDeliveries(cart)[1]).toEqual({ date: '2026-10-05', time: '12:00', items: [{ menu_item_id: 2, qty: 1 }] });
});

test('تكرار الطلب: يزاح لبدء الغد ويتجاوز غير المتاح', () => {
  const order = { status: 'confirmed', deliveries: [
    { status: 'delivered', is_asap: 0, deliver_at: '2026-09-20T11:00:00.000Z', items: [{ menu_item_id: 1, qty: 2 }] },
    { status: 'scheduled', is_asap: 0, deliver_at: '2026-09-23T11:00:00.000Z', items: [{ menu_item_id: 2, qty: 1 }, { menu_item_id: 99, qty: 1 }] },
    { status: 'cancelled', is_asap: 0, deliver_at: '2026-09-25T11:00:00.000Z', items: [{ menu_item_id: 1, qty: 1 }] },
  ] };
  const out = repeatItems(order, menu);
  expect(out.map((x) => [x.mid, x.qty, x.slot])).toEqual([[1, 2, '2026-10-04|14:00'], [2, 1, '2026-10-07|14:00']]);
});

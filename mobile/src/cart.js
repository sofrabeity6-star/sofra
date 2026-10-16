import { addDays, dayDiff, parts, today } from './format';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const feeFor = (cfg, slot) => (slot === 'asap' ? cfg.asap.fee_cents : cfg.delivery_fee_cents);

// المجموعات حسب الموعد: التوصيل السريع أولاً ثم الأقرب تاريخاً
export function groups(cart) {
  const m = new Map();
  cart.forEach((c) => { if (!m.has(c.slot)) m.set(c.slot, []); m.get(c.slot).push(c); });
  return [...m.entries()].sort((a, b) => (a[0] === 'asap' ? -1 : b[0] === 'asap' ? 1 : a[0].localeCompare(b[0])));
}

export function totals(cart, menu, cfg) {
  const gs = groups(cart);
  const find = (id) => menu.items.find((m) => m.id === id);
  const sub = cart.reduce((s, c) => s + (find(c.mid) ? find(c.mid).price_cents * c.qty : 0), 0);
  const fee = gs.reduce((s, g) => s + feeFor(cfg, g[0]), 0);
  return { meals: cart.reduce((s, c) => s + c.qty, 0), days: gs.length, sub, fee, total: sub + fee };
}

export function buildDeliveries(cart) {
  return groups(cart).map(([slot, rows]) => {
    const items = rows.map((c) => ({ menu_item_id: c.mid, qty: c.qty }));
    if (slot === 'asap') return { asap: true, items };
    const [date, time] = slot.split('|');
    return { date, time, items };
  });
}

// «كرر نفس الجدول»: يُزاح أول موعد ليبدأ غداً مع الحفاظ على الفروق بين الأيام، ويُتجاوز ما لم يعد متاحاً
export function repeatItems(order, menu) {
  const live = order.deliveries.filter((d) => d.status !== 'cancelled' || order.status === 'cancelled');
  const dates = live.filter((d) => !d.is_asap).map((d) => parts(d.deliver_at).date).sort();
  const shift = dates.length ? dayDiff(dates[0], addDays(today(), 1)) : 0;
  const out = [];
  live.forEach((d) => d.items.forEach((i) => {
    const m = menu.items.find((x) => x.id === i.menu_item_id);
    if (!m || !m.available) return;
    let slot;
    if (d.is_asap) { if (!m.asap_ok) return; slot = 'asap'; } else { const p = parts(d.deliver_at); slot = `${addDays(p.date, shift)}|${p.time}`; }
    out.push({ id: uid(), mid: m.id, qty: i.qty, slot });
  }));
  return out;
}

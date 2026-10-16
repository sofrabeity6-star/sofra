'use strict';
const { AppError } = require('./errors');
const { getSettings } = require('./db');
const { localToUtc, localParts, addDaysStr, timeToMinutes, dayRangeUtc } = require('./time');

const UNCONF = ['pending_phone_confirmation', 'receipt_review', 'receipt_rejected'];
const FINISHED = ['delivered', 'cancelled'];
const NEXT = { scheduled: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered' };
const STAGE_NAMES = { 1: 'pending_phone_confirmation', 2: 'receipt_review', 3: 'receipt_rejected', 4: 'confirmed', 5: 'preparing', 6: 'out_for_delivery', 7: 'delivered', 8: 'cancelled' };
const DL_AR = { scheduled: 'مجدول', preparing: 'قيد التجهيز', out_for_delivery: 'جاري التوصيل', delivered: 'تم التسليم', cancelled: 'ملغي' };

// الترتيب المسموح به في لوحة الإدارة (whitelist لمنع حقن SQL)
const SORT_COLUMNS = {
  delivery: 'sort_delivery_at', // وقت التسليم (أقرب موعد نشط للطلب)
  created: 'created_at',        // وقت إنشاء الطلب
  total: 'total_cents',         // سعر الطلب
  stage: 'stage_rank',          // المرحلة التي يقف عندها الطلب
};

const SCOPE_WHERE = {
  open: 'stage_rank BETWEEN 1 AND 6',
  calls: 'stage_rank = 1',
  receipts: 'stage_rank = 2',
  kitchen: 'stage_rank BETWEEN 4 AND 6',
  done: 'stage_rank IN (7, 8)',
  all: '1 = 1',
};

function createOrdersService({ db, clock, hub, push }) {
  const settings = () => getSettings(db);
  const nowMs = () => clock.now().getTime();
  const ts = () => clock.now().toISOString();
  const money = (c) => `${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ج.م`;

  /* ---------- أدوات مشتركة ---------- */
  async function logEvent(orderId, deliveryId, actorId, type, message) {
    (await db.run('INSERT INTO order_events(order_id,delivery_id,actor_id,type,message,created_at) VALUES(?,?,?,?,?,?)', orderId, deliveryId || null, actorId || null, type, message, ts()));
  }
  async function notifyUser(userId, orderId, message) {
    const id = (await db.run('INSERT INTO notifications(user_id,order_id,message,created_at) VALUES(?,?,?,?) RETURNING id', userId, orderId, message, ts())).id;
    hub.toUser(userId, 'notification', { id: Number(id), order_id: orderId, message });
    if (push) push.send(userId, { title: (await settings()).kitchen_name, body: message, data: { order_id: orderId } });
  }
  const STAFF_PUSH = new Set(['new_order', 'receipt_uploaded', 'cancelled']);
  function pingStaff(type, orderId, message) {
    hub.toStaff('order', { type, order_id: orderId, message });
    if (push && STAFF_PUSH.has(type)) push.sendToStaff({ title: 'سفرة · الإدارة', body: message, data: { order_id: orderId, staff: true } });
  }
  async function getOrder(id) {
    return (await db.one('SELECT * FROM orders WHERE id=?', id));
  }
  async function mustOrder(id) {
    const o = await getOrder(id);
    if (!o) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    return o;
  }
  async function deliveriesOf(orderId) {
    return (await db.all('SELECT * FROM order_deliveries WHERE order_id=? ORDER BY deliver_at, id', orderId));
  }
  const activeOf = (dls) => dls.filter((d) => !FINISHED.includes(d.status));

  function stageOf(o, dls) {
    if (o.status === 'cancelled') return 'cancelled';
    if (UNCONF.includes(o.status)) return o.status;
    const active = activeOf(dls);
    if (!active.length) return dls.some((d) => d.status === 'delivered') ? 'delivered' : 'cancelled';
    const s = active[0].status;
    return s === 'scheduled' ? 'confirmed' : s;
  }
  function canCancel(o, dls) {
    if (o.status === 'cancelled') return false;
    if (UNCONF.includes(o.status)) return true;
    const active = activeOf(dls);
    return o.status === 'confirmed' && active.length > 0 && active.every((d) => d.status === 'scheduled');
  }
  async function recalcTotals(orderId) {
    const r = (await db.one("SELECT COALESCE(SUM(subtotal_cents),0) s, COALESCE(SUM(fee_cents),0) f FROM order_deliveries WHERE order_id=? AND status<>'cancelled'", orderId));
    (await db.run('UPDATE orders SET subtotal_cents=?, fee_cents=?, total_cents=?, updated_at=? WHERE id=?', r.s, r.f, r.s + r.f, ts(), orderId));
  }

  /* ---------- قراءة الطلب كاملاً ---------- */
  async function hydrate(o, { admin = false } = {}) {
    if (!o) return null;
    const deliveries = await deliveriesOf(o.id);
    const items = (await db.all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', o.id));
    for (const d of deliveries) d.items = items.filter((i) => i.delivery_id === d.id);
    const receipts = (await db.all('SELECT id,reference,status,reject_reason,uploaded_at,reviewed_at FROM receipts WHERE order_id=? ORDER BY id', o.id));
    const events = (await db.all(`SELECT e.type,e.message,e.created_at,u.name AS actor_name FROM order_events e
      LEFT JOIN users u ON u.id=e.actor_id WHERE e.order_id=? ORDER BY e.id`, o.id));
    const out = {
      ...o, deliveries, receipts, events,
      stage: stageOf(o, deliveries),
      can_cancel: canCancel(o, deliveries),
      can_switch_to_prepaid: o.status === 'pending_phone_confirmation' && o.payment_method === 'cod',
    };
    if (admin) {
      out.calls = (await db.all(`SELECT c.id,c.outcome,c.note,c.created_at,u.name AS staff_name FROM call_log c
        LEFT JOIN users u ON u.id=c.staff_id WHERE c.order_id=? ORDER BY c.id`, o.id));
      const cb = o.confirmed_by ? (await db.one('SELECT name FROM users WHERE id=?', o.confirmed_by)) : null;
      out.confirmed_by_name = cb ? cb.name : null;
    }
    return out;
  }
  const getForUser = async (userId, id) => {
    const o = await getOrder(id);
    if (!o || o.user_id !== userId) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    return hydrate(o);
  };
  const getForAdmin = async (id) => await hydrate(await mustOrder(id), { admin: true });

  /* ---------- الطلب الفوري ---------- */
  async function asapStatus() {
    const s = await settings();
    if (!s.accepting_orders) return { enabled: true, available: false, minutes: s.asap_minutes, fee_cents: s.asap_fee_cents, reason: s.closed_message || 'المطبخ لا يستقبل طلبات حالياً' };
    if (!s.asap_enabled) return { enabled: false, available: false, minutes: s.asap_minutes, fee_cents: s.asap_fee_cents, reason: 'الطلب الفوري غير مفعّل حالياً' };
    const open = timeToMinutes(s.open_time);
    const close = timeToMinutes(s.close_time);
    const nowM = localParts(clock.now(), s.timezone).minutes;
    const atM = localParts(new Date(nowMs() + s.asap_minutes * 60000), s.timezone).minutes;
    const ok = nowM >= open && nowM <= close && atM >= open && atM <= close;
    return {
      enabled: true, available: ok, minutes: s.asap_minutes, fee_cents: s.asap_fee_cents,
      reason: ok ? null : `الطلب الفوري متاح خلال مواعيد العمل فقط (${s.open_time} - ${s.close_time})`,
    };
  }

  function assertWithinHours(at, s, what) {
    const m = localParts(at, s.timezone).minutes;
    if (m < timeToMinutes(s.open_time) || m > timeToMinutes(s.close_time)) {
      throw new AppError(400, `${what} خارج مواعيد عمل المطبخ (${s.open_time} - ${s.close_time})`, 'closed');
    }
  }

  /* ---------- إنشاء الطلب ---------- */
  async function createOrder({ user, payload, receiptFile }) {
    const s = await settings();
    if (!s.accepting_orders) throw new AppError(400, s.closed_message || 'المطبخ لا يستقبل طلبات حالياً', 'closed_now');
    if (payload.payment_method === 'cod' && !s.cod_enabled) throw new AppError(400, 'الدفع عند الاستلام غير متاح حالياً. استخدم التحويل الإلكتروني.', 'pay_disabled');
    if (payload.payment_method === 'transfer' && !s.transfer_enabled) throw new AppError(400, 'التحويل الإلكتروني غير متاح حالياً. اختر الدفع عند الاستلام.', 'pay_disabled');
    const addr = (await db.one('SELECT * FROM addresses WHERE id=? AND user_id=?', payload.address_id, user.id));
    if (!addr) throw new AppError(400, 'عنوان التوصيل غير صحيح', 'bad_address');
    if (payload.payment_method === 'transfer' && !receiptFile) throw new AppError(400, 'ارفع صورة إيصال التحويل لإتمام الطلب', 'receipt_required');
    if (payload.payment_method === 'cod') {
      const c = (await db.one("SELECT COUNT(*) c FROM orders WHERE user_id=? AND status='pending_phone_confirmation'", user.id)).c;
      if (c >= s.max_pending_cod) throw new AppError(429, 'لديك عدة طلبات دفع عند الاستلام بانتظار التأكيد. انتظر مكالمة المطبخ أو استخدم التحويل المسبق.', 'too_many_cod');
    }

    // 1) حلّ مواعيد التسليم
    const slots = new Map();
    for (const d of payload.deliveries) {
      let at;
      if (d.asap) {
        const a = await asapStatus();
        if (!a.available) throw new AppError(400, a.reason, 'asap_unavailable');
        at = new Date(nowMs() + s.asap_minutes * 60000);
      } else {
        at = localToUtc(d.date, d.time, s.timezone);
        if (at.getTime() - nowMs() < s.min_lead_minutes * 60000) {
          throw new AppError(400, `أقرب موعد للطلب المجدول بعد ${s.min_lead_minutes} دقيقة من الآن. للأسرع اختر «اطلب الآن» (طلب عادي يصلك خلال ${s.asap_minutes} دقيقة).`, 'too_soon');
        }
        const limit = localParts(clock.now(), s.timezone).date;
        if (d.date > addDaysStr(limit, s.max_days_ahead)) throw new AppError(400, `لا يمكن الجدولة لأكثر من ${s.max_days_ahead} يوماً`, 'too_far');
        assertWithinHours(at, s, 'موعد التسليم');
        if (timeToMinutes(d.time) % s.slot_minutes) throw new AppError(400, `ساعة التسليم يجب أن تكون من الأوقات المتاحة (كل ${s.slot_minutes} دقيقة)`, 'bad_slot');
      }
      const key = d.asap ? 'asap' : at.toISOString();
      if (!slots.has(key)) slots.set(key, { at, asap: !!d.asap, items: new Map() });
      const slot = slots.get(key);
      for (const it of d.items) slot.items.set(it.menu_item_id, (slot.items.get(it.menu_item_id) || 0) + it.qty);
    }

    // 2) الأصناف: الأسعار والتوفر دائماً من قاعدة البيانات
    const getItem = (id) => db.one(`SELECT m.* FROM menu_items m JOIN categories c ON c.id=m.category_id
      WHERE m.id=? AND m.archived=0 AND c.active=1`, id);
    const resolved = [];
    for (const slot of slots.values()) {
      const items = [];
      let subtotal = 0;
      for (const [id, qty] of slot.items) {
        if (qty > 50) throw new AppError(400, 'الحد الأقصى 50 وجبة من الصنف الواحد في الموعد الواحد', 'qty');
        const m = await getItem(id);
        if (!m || !m.available) throw new AppError(400, `الوجبة «${m ? m.name : id}» غير متاحة حالياً. احذفها من الجدول وأعد المحاولة.`, 'unavailable');
        if (slot.asap && !m.asap_ok) throw new AppError(400, `الوجبة «${m.name}» غير متاحة للتوصيل السريع`, 'asap_item');
        items.push({ m, qty });
        subtotal += m.price_cents * qty;
      }
      const fee = slot.asap ? s.asap_fee_cents : s.delivery_fee_cents;
      resolved.push({ slot, items, subtotal, fee });
    }

    const subtotal = resolved.reduce((a, r) => a + r.subtotal, 0);
    const fee = resolved.reduce((a, r) => a + r.fee, 0);
    const now = ts();
    const status = payload.payment_method === 'transfer' ? 'receipt_review' : 'pending_phone_confirmation';

    const orderId = await db.tx(async () => {
      // رقم الطلب من تسلسل Postgres (order_number_seq) فلا يتكرر حتى مع الطلبات المتزامنة
      const oid = (await db.run(`INSERT INTO orders(user_id,customer_name,customer_phone,address_label,address_text,payment_method,status,notes,
        subtotal_cents,fee_cents,total_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id`, user.id, user.name, user.phone, addr.label, addr.text, payload.payment_method, status, payload.notes || '',
          subtotal, fee, subtotal + fee, now, now)).id;
      for (const r of resolved) {
        const did = (await db.run('INSERT INTO order_deliveries(order_id,deliver_at,is_asap,subtotal_cents,fee_cents,updated_at) VALUES(?,?,?,?,?,?) RETURNING id', oid, r.slot.at.toISOString(), r.slot.asap ? 1 : 0, r.subtotal, r.fee, now)).id;
        for (const { m, qty } of r.items) {
          (await db.run('INSERT INTO order_items(delivery_id,order_id,menu_item_id,name,emoji,price_cents,qty) VALUES(?,?,?,?,?,?,?)', did, oid, m.id, m.name, m.emoji, m.price_cents, qty));
        }
      }
      if (status === 'receipt_review') {
        (await db.run('INSERT INTO receipts(order_id,file,reference,uploaded_at) VALUES(?,?,?,?)', oid, receiptFile, payload.receipt_reference || '', now));
      }
      await logEvent(oid, null, user.id, 'created', status === 'receipt_review' ? 'تم إنشاء الطلب ورفع إيصال التحويل' : 'تم إنشاء الطلب (دفع عند الاستلام)');
      return Number(oid);
    });

    const hasAsap = resolved.some((r) => r.slot.asap);
    pingStaff('new_order', orderId, `${hasAsap ? 'طلب عاجل ' : 'طلب جديد '}من ${user.name}`);
    return await getForUser(user.id, orderId);
  }

  /* ---------- تأكيد الطلب (من المكالمة أو الإيصال) ---------- */
  async function onConfirmed(order, actorId, how) {
    const asap = (await db.all("SELECT id FROM order_deliveries WHERE order_id=? AND is_asap=1 AND status='scheduled'", order.id));
    for (const d of asap) {
      (await db.run("UPDATE order_deliveries SET status='preparing', updated_at=? WHERE id=? AND status='scheduled'", ts(), d.id));
      await logEvent(order.id, d.id, actorId, 'delivery_preparing', 'بدأ تجهيز الطلب العاجل فوراً');
    }
    await notifyUser(order.user_id, order.id, `تم تأكيد طلبك رقم ${order.number} ${how}`);
    pingStaff('confirmed', order.id, `تم تأكيد الطلب ${order.number}`);
    await prepareUntil(new Date(nowMs() + (await settings()).auto_prepare_minutes * 60000).toISOString(), null, true);
  }

  async function recordCall({ orderId, staff, outcome, note }) {
    const o = await mustOrder(orderId);
    const now = ts();
    if (o.status !== 'pending_phone_confirmation') {
      throw new AppError(409, 'تغيّرت حالة الطلب ولم يعد بانتظار المكالمة (ربما حوّله العميل إلى دفع مسبق). حدّث الصفحة.', 'stale');
    }
    if (outcome === 'confirmed') {
      const r = (await db.run("UPDATE orders SET status='confirmed', confirmed_at=?, confirmed_by=?, updated_at=? WHERE id=? AND status='pending_phone_confirmation' AND payment_method='cod'", now, staff.id, now, orderId));
      if (!r.changes) throw new AppError(409, 'تغيّرت حالة الطلب. حدّث الصفحة.', 'stale');
      (await db.run('INSERT INTO call_log(order_id,staff_id,outcome,note,created_at) VALUES(?,?,?,?,?)', orderId, staff.id, 'confirmed', note || '', now));
      await logEvent(orderId, null, staff.id, 'call_confirmed', `تم التأكيد هاتفياً بواسطة ${staff.name}`);
      await onConfirmed(await mustOrder(orderId), staff.id, 'هاتفياً');
    } else if (outcome === 'no_answer') {
      (await db.run('INSERT INTO call_log(order_id,staff_id,outcome,note,created_at) VALUES(?,?,?,?,?)', orderId, staff.id, 'no_answer', note || '', now));
      await logEvent(orderId, null, staff.id, 'call_no_answer', 'لم يرد العميل على المكالمة');
      pingStaff('call_logged', orderId, `محاولة اتصال بدون رد للطلب ${o.number}`);
    } else {
      (await db.run('INSERT INTO call_log(order_id,staff_id,outcome,note,created_at) VALUES(?,?,?,?,?)', orderId, staff.id, 'cancelled', note || '', now));
      await cancelAll(o, { by: 'staff', reason: note || 'تعذر تأكيد الطلب هاتفياً', actor: staff });
    }
    return await getForAdmin(orderId);
  }

  /* ---------- الإيصالات ---------- */
  async function saveReceiptRow(orderId, file, reference) {
    (await db.run('INSERT INTO receipts(order_id,file,reference,uploaded_at) VALUES(?,?,?,?)', orderId, file, reference || '', ts()));
  }

  // التحويل من كاش إلى دفع مسبق: مسموح فقط قبل أن يؤكد الأدمن الطلب هاتفياً
  async function switchToPrepaid({ user, orderId, file, reference }) {
    const o = await getOrder(orderId);
    if (!o || o.user_id !== user.id) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    if (!file) throw new AppError(400, 'ارفع صورة الإيصال', 'receipt_required');
    await db.tx(async () => {
      const r = (await db.run("UPDATE orders SET payment_method='transfer', status='receipt_review', updated_at=? WHERE id=? AND user_id=? AND status='pending_phone_confirmation' AND payment_method='cod'", ts(), orderId, user.id));
      if (!r.changes) throw new AppError(409, 'لا يمكن التحويل إلى الدفع المسبق: تم تأكيد الطلب هاتفياً أو تغيّرت حالته.', 'locked');
      await saveReceiptRow(orderId, file, reference);
      await logEvent(orderId, null, user.id, 'switched_to_prepaid', 'حوّل العميل الطلب من دفع عند الاستلام إلى دفع مسبق ورفع الإيصال');
    });
    pingStaff('receipt_uploaded', orderId, `إيصال جديد للطلب ${o.number}`);
    return await getForUser(user.id, orderId);
  }

  async function reuploadReceipt({ user, orderId, file, reference }) {
    const o = await getOrder(orderId);
    if (!o || o.user_id !== user.id) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    if (!file) throw new AppError(400, 'ارفع صورة الإيصال', 'receipt_required');
    await db.tx(async () => {
      const r = (await db.run("UPDATE orders SET status='receipt_review', updated_at=? WHERE id=? AND user_id=? AND status='receipt_rejected'", ts(), orderId, user.id));
      if (!r.changes) throw new AppError(409, 'لا يمكن رفع إيصال جديد لهذا الطلب الآن', 'locked');
      await saveReceiptRow(orderId, file, reference);
      await logEvent(orderId, null, user.id, 'receipt_reuploaded', 'رفع العميل إيصالاً جديداً');
    });
    pingStaff('receipt_uploaded', orderId, `إيصال جديد للطلب ${o.number}`);
    return await getForUser(user.id, orderId);
  }

  async function reviewReceipt({ orderId, staff, approve, reason }) {
    const o = await mustOrder(orderId);
    const rec = (await db.one("SELECT * FROM receipts WHERE order_id=? AND status='pending' ORDER BY id DESC LIMIT 1", orderId));
    if (o.status !== 'receipt_review' || !rec) throw new AppError(409, 'لا يوجد إيصال بانتظار المراجعة لهذا الطلب. حدّث الصفحة.', 'stale');
    const now = ts();
    if (approve) {
      await db.tx(async () => {
        const r = (await db.run("UPDATE orders SET status='confirmed', confirmed_at=?, confirmed_by=?, updated_at=? WHERE id=? AND status='receipt_review'", now, staff.id, now, orderId));
        if (!r.changes) throw new AppError(409, 'تغيّرت حالة الطلب. حدّث الصفحة.', 'stale');
        (await db.run("UPDATE receipts SET status='approved', reviewed_by=?, reviewed_at=? WHERE id=?", staff.id, now, rec.id));
        await logEvent(orderId, null, staff.id, 'receipt_approved', `تم اعتماد الإيصال بواسطة ${staff.name}`);
      });
      await onConfirmed(await mustOrder(orderId), staff.id, 'بعد اعتماد الإيصال');
    } else {
      if (!reason || reason.trim().length < 3) throw new AppError(400, 'اكتب سبب رفض الإيصال ليصل للعميل', 'reason_required');
      await db.tx(async () => {
        const r = (await db.run("UPDATE orders SET status='receipt_rejected', updated_at=? WHERE id=? AND status='receipt_review'", now, orderId));
        if (!r.changes) throw new AppError(409, 'تغيّرت حالة الطلب. حدّث الصفحة.', 'stale');
        (await db.run("UPDATE receipts SET status='rejected', reject_reason=?, reviewed_by=?, reviewed_at=? WHERE id=?", reason.trim(), staff.id, now, rec.id));
        await logEvent(orderId, null, staff.id, 'receipt_rejected', `تم رفض الإيصال: ${reason.trim()}`);
      });
      await notifyUser(o.user_id, o.id, `تم رفض إيصال طلبك رقم ${o.number}: ${reason.trim()}. ارفع إيصالاً جديداً.`);
      pingStaff('receipt_rejected', orderId, `تم رفض إيصال الطلب ${o.number}`);
    }
    return await getForAdmin(orderId);
  }

  /* ---------- الإلغاء والاسترداد ---------- */
  // يلغي كل التسليمات غير المكتملة. يُحسب المبلغ المستحق للاسترداد إذا كان العميل قد حوّل مبلغاً.
  async function cancelAll(o, { by, reason, actor }) {
    const now = ts();
    await db.tx(async () => {
      const dls = await deliveriesOf(o.id);
      const active = activeOf(dls);
      const hadPaid = o.payment_method === 'transfer' && ['receipt_review', 'confirmed'].includes(o.status);
      const refund = hadPaid ? active.reduce((a, d) => a + d.subtotal_cents + d.fee_cents, 0) : 0;
      (await db.run("UPDATE order_deliveries SET status='cancelled', updated_at=? WHERE order_id=? AND status NOT IN ('delivered','cancelled')", now, o.id));
      const anyDelivered = dls.some((d) => d.status === 'delivered');
      (await db.run('UPDATE orders SET status=?, cancel_reason=?, cancelled_by=?, refund_due_cents=refund_due_cents+?, updated_at=? WHERE id=?', anyDelivered ? 'confirmed' : 'cancelled', reason, by, refund, now, o.id));
      if (o.status === 'receipt_review') {
        (await db.run("UPDATE receipts SET status='rejected', reject_reason='أُلغي الطلب', reviewed_at=? WHERE order_id=? AND status='pending'", now, o.id));
      }
      await recalcTotals(o.id);
      await logEvent(o.id, null, actor && actor.id, 'cancelled', `${by === 'customer' ? 'ألغى العميل الطلب' : `أُلغي الطلب بواسطة ${actor ? actor.name : 'المطبخ'}`}${reason ? `: ${reason}` : ''}`);
    });
    if (by === 'customer') pingStaff('cancelled', o.id, `العميل ألغى الطلب ${o.number}`);
    else await notifyUser(o.user_id, o.id, `تم إلغاء طلبك رقم ${o.number}${reason ? `: ${reason}` : ''}`);
  }

  async function cancelByCustomer({ user, orderId }) {
    const o = await getOrder(orderId);
    if (!o || o.user_id !== user.id) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    if (o.status === 'cancelled') throw new AppError(409, 'الطلب ملغي بالفعل', 'stale');
    if (!canCancel(o, await deliveriesOf(o.id))) {
      throw new AppError(409, 'لا يمكن إلغاء الطلب بعد بدء التجهيز لتجنب هدر الخامات. الأيام التي لم يبدأ تجهيزها يمكن إلغاؤها منفردة.', 'locked');
    }
    await cancelAll(o, { by: 'customer', reason: 'ألغاه العميل' });
    return await getForUser(user.id, orderId);
  }

  async function cancelDeliveryByCustomer({ user, orderId, deliveryId }) {
    const o = await getOrder(orderId);
    if (!o || o.user_id !== user.id) throw new AppError(404, 'الطلب غير موجود', 'not_found');
    if (o.status !== 'confirmed') {
      if (canCancel(o, await deliveriesOf(o.id))) return await cancelByCustomer({ user, orderId });
      throw new AppError(409, 'لا يمكن إلغاء هذا الموعد الآن', 'locked');
    }
    const now = ts();
    await db.tx(async () => {
      const d = (await db.one('SELECT * FROM order_deliveries WHERE id=? AND order_id=?', deliveryId, orderId));
      if (!d) throw new AppError(404, 'الموعد غير موجود', 'not_found');
      const r = (await db.run("UPDATE order_deliveries SET status='cancelled', updated_at=? WHERE id=? AND status='scheduled'", now, deliveryId));
      if (!r.changes) throw new AppError(409, 'بدأ تجهيز هذا الموعد ولا يمكن إلغاؤه.', 'locked');
      const refund = o.payment_method === 'transfer' ? d.subtotal_cents + d.fee_cents : 0;
      (await db.run('UPDATE orders SET refund_due_cents=refund_due_cents+?, updated_at=? WHERE id=?', refund, now, orderId));
      await recalcTotals(orderId);
      const left = await deliveriesOf(orderId);
      if (!activeOf(left).length && !left.some((x) => x.status === 'delivered')) {
        (await db.run("UPDATE orders SET status='cancelled', cancelled_by='customer', cancel_reason='أُلغيت كل المواعيد', updated_at=? WHERE id=?", now, orderId));
      }
      await logEvent(orderId, deliveryId, user.id, 'delivery_cancelled', 'ألغى العميل أحد مواعيد التسليم');
    });
    pingStaff('cancelled', orderId, `العميل ألغى موعداً من الطلب ${o.number}`);
    return await getForUser(user.id, orderId);
  }

  async function cancelByStaff({ orderId, staff, reason }) {
    const o = await mustOrder(orderId);
    if (o.status === 'cancelled') throw new AppError(409, 'الطلب ملغي بالفعل', 'stale');
    if (!activeOf(await deliveriesOf(orderId)).length) throw new AppError(409, 'لا توجد مواعيد نشطة لإلغائها', 'stale');
    if (!reason || reason.trim().length < 3) throw new AppError(400, 'اكتب سبب الإلغاء', 'reason_required');
    await cancelAll(o, { by: 'staff', reason: reason.trim(), actor: staff });
    return await getForAdmin(orderId);
  }

  async function markRefunded({ orderId, staff }) {
    const o = await mustOrder(orderId);
    if (o.refund_due_cents <= 0) throw new AppError(409, 'لا يوجد مبلغ مستحق للاسترداد', 'stale');
    (await db.run('UPDATE orders SET refunded_cents=refunded_cents+refund_due_cents, refund_due_cents=0, updated_at=? WHERE id=?', ts(), orderId));
    await logEvent(orderId, null, staff.id, 'refunded', `تم تسجيل استرداد ${money(o.refund_due_cents)} للعميل`);
    await notifyUser(o.user_id, o.id, `تم استرداد ${money(o.refund_due_cents)} من طلبك رقم ${o.number}`);
    return await getForAdmin(orderId);
  }

  /* ---------- مراحل التنفيذ ---------- */
  async function advanceDelivery({ deliveryId, staff, cashConfirmed }) {
    const d = (await db.one(`SELECT d.*, o.status AS order_status, o.payment_method, o.user_id, o.number
      FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE d.id=?`, deliveryId));
    if (!d) throw new AppError(404, 'الموعد غير موجود', 'not_found');
    if (d.order_status !== 'confirmed') throw new AppError(409, 'لا يمكن تنفيذ الطلب قبل تأكيده', 'unconfirmed');
    const next = NEXT[d.status];
    if (!next) throw new AppError(409, 'هذا الموعد منتهٍ أو ملغي', 'stale');
    let cash = 0;
    if (next === 'delivered' && d.payment_method === 'cod') {
      if (!cashConfirmed) throw new AppError(400, 'أكّد استلام المبلغ النقدي من العميل لتسوية الكاش', 'cash_required');
      cash = d.subtotal_cents + d.fee_cents;
    }
    const now = ts();
    const r = (await db.run('UPDATE order_deliveries SET status=?, cash_collected_cents=?, delivered_at=?, updated_at=? WHERE id=? AND status=?', next, cash, next === 'delivered' ? now : null, now, deliveryId, d.status));
    if (!r.changes) throw new AppError(409, 'تغيّرت حالة الموعد. حدّث الصفحة.', 'stale');
    await logEvent(d.order_id, deliveryId, staff.id, `delivery_${next}`, `${DL_AR[next]}${cash ? ` (تحصيل ${money(cash)} نقداً)` : ''}`);
    await notifyUser(d.user_id, d.order_id, `طلبك رقم ${d.number}: ${DL_AR[next]}`);
    pingStaff('delivery', d.order_id, `الطلب ${d.number}: ${DL_AR[next]}`);
    return await getForAdmin(d.order_id);
  }

  // تحويل المواعيد القريبة إلى «قيد التجهيز» (تلقائي بالمؤقت، أو يدوي بزر الأدمن)
  async function prepareUntil(limitIso, actorId, silent) {
    const rows = (await db.all(`SELECT d.id, d.order_id, o.user_id, o.number FROM order_deliveries d JOIN orders o ON o.id=d.order_id
      WHERE o.status='confirmed' AND d.status='scheduled' AND d.deliver_at<=?`, limitIso));
    let n = 0;
    for (const d of rows) {
      const r = (await db.run("UPDATE order_deliveries SET status='preparing', updated_at=? WHERE id=? AND status='scheduled'", ts(), d.id));
      if (!r.changes) continue;
      n += 1;
      await logEvent(d.order_id, d.id, actorId, 'delivery_preparing', actorId ? 'بدأ التجهيز (تجهيز جماعي)' : 'بدأ التجهيز تلقائياً');
      await notifyUser(d.user_id, d.order_id, `طلبك رقم ${d.number}: بدأ التجهيز`);
    }
    if (n && !silent) pingStaff('delivery', null, `بدأ تجهيز ${n} موعد`);
    return n;
  }
  async function autoPrepare() {
    const m = (await settings()).auto_prepare_minutes;
    if (!(m > 0)) return 0;
    return await prepareUntil(new Date(nowMs() + m * 60000).toISOString(), null, false);
  }
  async function prepareToday(staff) {
    const s = await settings();
    const today = localParts(clock.now(), s.timezone).date;
    const end = dayRangeUtc(today, s.timezone)[1];
    const n = await prepareUntil(end, staff.id, false);
    return n;
  }

  /* ---------- القوائم والترتيب ---------- */
  const BASE_SELECT = `
    WITH nd AS (
      SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.order_id ORDER BY d.deliver_at, d.id) AS rn
      FROM order_deliveries d WHERE d.status NOT IN ('delivered','cancelled')
    ),
    ld AS (
      SELECT order_id, MAX(deliver_at) AS last_at, COUNT(*) FILTER (WHERE status='delivered') AS delivered_count
      FROM order_deliveries GROUP BY order_id
    )
    SELECT o.*,
      COALESCE(nd.deliver_at, ld.last_at) AS sort_delivery_at,
      nd.deliver_at AS next_delivery_at,
      nd.id AS next_delivery_id,
      COALESCE(nd.is_asap, 0) AS next_is_asap,
      CASE
        WHEN o.status='cancelled' THEN 8
        WHEN o.status='pending_phone_confirmation' THEN 1
        WHEN o.status='receipt_review' THEN 2
        WHEN o.status='receipt_rejected' THEN 3
        WHEN nd.id IS NULL THEN CASE WHEN COALESCE(ld.delivered_count,0)>0 THEN 7 ELSE 8 END
        WHEN nd.status='scheduled' THEN 4
        WHEN nd.status='preparing' THEN 5
        ELSE 6
      END AS stage_rank,
      (SELECT COUNT(*) FROM order_deliveries x WHERE x.order_id=o.id AND x.status<>'cancelled') AS deliveries_count,
      (SELECT COALESCE(SUM(i.qty),0) FROM order_items i JOIN order_deliveries x ON x.id=i.delivery_id WHERE i.order_id=o.id AND x.status<>'cancelled') AS meals_count
    FROM orders o
    LEFT JOIN nd ON nd.order_id=o.id AND nd.rn=1
    LEFT JOIN ld ON ld.order_id=o.id`;

  function decorate(row) {
    const next = row.next_delivery_at ? Date.parse(row.next_delivery_at) : null;
    const out = { ...row, stage: STAGE_NAMES[row.stage_rank] };
    out.minutes_to_delivery = next === null ? null : Math.round((next - nowMs()) / 60000);
    out.is_late = next !== null && row.stage_rank <= 6 && next < nowMs();
    out.is_asap = !!row.next_is_asap;
    return out;
  }

  async function adminList({ scope = 'open', q = '', sort = 'delivery', dir = 'asc', page = 1, limit = 30, payment = '', stage = '' }) {
    const col = SORT_COLUMNS[sort] || SORT_COLUMNS.delivery;
    const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    const where = [SCOPE_WHERE[scope] || SCOPE_WHERE.open];
    const params = [];
    if (payment === 'cod' || payment === 'transfer') { where.push('payment_method = ?'); params.push(payment); }
    const stageRank = Object.entries(STAGE_NAMES).find(([, v]) => v === stage);
    if (stageRank) { where.push('stage_rank = ?'); params.push(Number(stageRank[0])); }
    if (q && q.trim()) {
      const like = `%${q.trim()}%`;
      where.push('(CAST(number AS TEXT) LIKE ? OR customer_name ILIKE ? OR customer_phone LIKE ?)');
      params.push(like, like, like);
    }
    // ترتيب ثانوي ثابت: عند تساوي القيمة يظهر الأقرب موعداً أولاً ثم الأقدم رقماً
    const order = col === 'sort_delivery_at' ? `sort_delivery_at ${direction}, id ${direction}` : `${col} ${direction}, sort_delivery_at ASC, id ASC`;
    const lim = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const off = (Math.max(Number(page) || 1, 1) - 1) * lim;
    const inner = BASE_SELECT;
    const total = (await db.one(`SELECT COUNT(*) c FROM (${inner}) q WHERE ${where.join(' AND ')}`, ...params)).c;
    const rows = (await db.all(`SELECT * FROM (${inner}) q WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, lim, off));
    return { orders: rows.map(decorate), total, page: Math.max(Number(page) || 1, 1), limit: lim, sort: col === 'sort_delivery_at' ? 'delivery' : sort, dir: direction.toLowerCase() };
  }

  async function listForUser(userId) {
    const rows = (await db.all(`SELECT * FROM (${BASE_SELECT}) q WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100`, userId));
    return rows.map(decorate);
  }

  /* ---------- أجندة المطبخ والإحصاءات ---------- */
  async function kitchen(dateStr) {
    const s = await settings();
    const [start, end] = dayRangeUtc(dateStr, s.timezone);
    const rows = (await db.all(`SELECT d.id AS delivery_id, d.deliver_at, d.is_asap, d.status AS delivery_status, o.id AS order_id, o.number,
        o.customer_name, o.customer_phone, o.address_text, o.payment_method, i.menu_item_id, i.name, i.emoji, i.qty
      FROM order_deliveries d JOIN orders o ON o.id=d.order_id JOIN order_items i ON i.delivery_id=d.id
      WHERE d.deliver_at>=? AND d.deliver_at<? AND o.status='confirmed' AND d.status<>'cancelled'
      ORDER BY d.deliver_at, d.id, i.id`, start, end));
    const slotsMap = new Map();
    const totals = new Map();
    for (const r of rows) {
      if (!slotsMap.has(r.deliver_at)) slotsMap.set(r.deliver_at, { deliver_at: r.deliver_at, deliveries: new Map() });
      const slot = slotsMap.get(r.deliver_at);
      if (!slot.deliveries.has(r.delivery_id)) {
        slot.deliveries.set(r.delivery_id, {
          delivery_id: r.delivery_id, order_id: r.order_id, number: r.number, customer_name: r.customer_name, customer_phone: r.customer_phone,
          address_text: r.address_text, payment_method: r.payment_method, status: r.delivery_status, is_asap: !!r.is_asap, items: [],
        });
      }
      slot.deliveries.get(r.delivery_id).items.push({ name: r.name, emoji: r.emoji, qty: r.qty });
      const t = totals.get(r.menu_item_id) || { name: r.name, emoji: r.emoji, qty: 0 };
      t.qty += r.qty;
      totals.set(r.menu_item_id, t);
    }
    const pending = (await db.one(`SELECT COALESCE(SUM(i.qty),0) q FROM order_items i JOIN order_deliveries d ON d.id=i.delivery_id JOIN orders o ON o.id=d.order_id
      WHERE d.deliver_at>=? AND d.deliver_at<? AND o.status IN ('pending_phone_confirmation','receipt_review','receipt_rejected')`, start, end)).q;
    return {
      date: dateStr,
      slots: [...slotsMap.values()].map((x) => ({ deliver_at: x.deliver_at, deliveries: [...x.deliveries.values()] })),
      totals: [...totals.values()].sort((a, b) => b.qty - a.qty),
      pending_qty: pending,
    };
  }

  async function stats() {
    const s = await settings();
    const today = localParts(clock.now(), s.timezone).date;
    const [start, end] = dayRangeUtc(today, s.timezone);
    const one = (sql, ...p) => db.one(sql, ...p);
    const nowIso = ts();
    const delivered = await one("SELECT COALESCE(SUM(subtotal_cents+fee_cents),0) v, COALESCE(SUM(cash_collected_cents),0) cash, COUNT(*) c FROM order_deliveries WHERE status='delivered' AND delivered_at>=? AND delivered_at<?", start, end);
    const since = dayRangeUtc(require('./time').addDaysStr(today, -13), s.timezone)[0];
    const series = new Map();
    for (let i = 13; i >= 0; i--) series.set(require('./time').addDaysStr(today, -i), 0);
    for (const r of (await db.all("SELECT delivered_at, subtotal_cents+fee_cents AS v FROM order_deliveries WHERE status='delivered' AND delivered_at>=?", since))) {
      const k = localParts(new Date(r.delivered_at), s.timezone).date;
      if (series.has(k)) series.set(k, series.get(k) + r.v);
    }
    return {
      today,
      sales_today_cents: delivered.v,
      cash_today_cents: delivered.cash,
      delivered_today: delivered.c,
      deliveries_today: (await one(`SELECT COUNT(*) c FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE o.status='confirmed' AND d.status<>'cancelled' AND d.deliver_at>=? AND d.deliver_at<?`, start, end)).c,
      meals_today: (await one(`SELECT COALESCE(SUM(i.qty),0) q FROM order_items i JOIN order_deliveries d ON d.id=i.delivery_id JOIN orders o ON o.id=d.order_id WHERE o.status='confirmed' AND d.status<>'cancelled' AND d.deliver_at>=? AND d.deliver_at<?`, start, end)).q,
      pending_calls: (await one("SELECT COUNT(*) c FROM orders WHERE status='pending_phone_confirmation'")).c,
      pending_receipts: (await one("SELECT COUNT(*) c FROM orders WHERE status='receipt_review'")).c,
      asap_active: (await one("SELECT COUNT(*) c FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE d.is_asap=1 AND d.status NOT IN ('delivered','cancelled') AND o.status IN ('pending_phone_confirmation','receipt_review','confirmed')")).c,
      late: (await one("SELECT COUNT(*) c FROM order_deliveries d JOIN orders o ON o.id=d.order_id WHERE o.status='confirmed' AND d.status NOT IN ('delivered','cancelled') AND d.deliver_at<?", nowIso)).c,
      refunds_due_cents: (await one('SELECT COALESCE(SUM(refund_due_cents),0) v FROM orders')).v,
      sales_series: [...series.entries()].map(([date, cents]) => ({ date, cents })),
    };
  }

  async function pendingReceipts() {
    const { orders } = await adminList({ scope: 'receipts', limit: 100, sort: 'delivery', dir: 'asc' });
    const out = [];
    for (const o of orders) {
      const receipt = await db.one("SELECT id, reference, uploaded_at FROM receipts WHERE order_id=? AND status='pending' ORDER BY id DESC LIMIT 1", o.id);
      if (receipt) out.push({ ...o, receipt });
    }
    return out;
  }

  return {
    pendingReceipts, createOrder, getForUser, getForAdmin, listForUser, adminList, asapStatus,
    recordCall, switchToPrepaid, reuploadReceipt, reviewReceipt,
    cancelByCustomer, cancelDeliveryByCustomer, cancelByStaff, markRefunded,
    advanceDelivery, autoPrepare, prepareToday, kitchen, stats,
    notifyUser,
  };
}

module.exports = { createOrdersService, SORT_COLUMNS, STAGE_NAMES };

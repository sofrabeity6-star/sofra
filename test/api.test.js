'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, receiptForm, dl, place } = require('./helpers');
const { localToUtc } = require('../src/time');

/* ---------- الوقت ---------- */
test('تحويل توقيت القاهرة إلى UTC (صيفي وشتوي)', () => {
  assert.equal(localToUtc('2026-10-05', '14:00', 'Africa/Cairo').toISOString(), '2026-10-05T11:00:00.000Z');
  assert.equal(localToUtc('2026-12-01', '14:00', 'Africa/Cairo').toISOString(), '2026-12-01T12:00:00.000Z');
});

/* ---------- المصادقة والأمان ---------- */
test('التسجيل وتسجيل الدخول وفصل جلسة الإدارة عن العميل', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    assert.equal((await c.get('/api/auth/me')).data.user.phone, '01012345678');
    // العميل لا يدخل لوحة الإدارة
    assert.equal((await c.get('/api/admin/stats')).status, 401);
    // الأدمن لا يدخل من بوابة العملاء
    const bad = await c.post('/api/auth/login', { phone: '01000000000', password: 'password123' });
    assert.equal(bad.status, 403);
    // كلمة مرور خاطئة
    assert.equal((await c.post('/api/auth/login', { phone: '01012345678', password: 'wrong-pass' })).status, 401);
    // رقم مكرر وبصيغة +20
    assert.equal((await c.post('/api/auth/register', { name: 'x y', phone: '+201012345678', password: 'password123' })).status, 409);
    // الموظف لا يغيّر الإعدادات
    assert.equal((await t.staff.put('/api/admin/settings', { delivery_fee_cents: 100 })).status, 403);
    assert.equal((await t.admin.put('/api/admin/settings', { delivery_fee_cents: 2500 })).status, 200);
  } finally { await t.close(); }
});

test('الطلبات المغيرة للحالة بدون ترويسة CSRF مرفوضة', async () => {
  const t = await boot();
  try {
    const r = await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
  } finally { await t.close(); }
});

/* ---------- إنشاء الطلب والتحقق ---------- */
test('طلب كاش مجدول: الحالة بانتظار المكالمة والأسعار من الخادم', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const r = await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 2 }], '2026-10-05', '14:00')]);
    assert.equal(r.status, 201);
    const o = r.data.order;
    assert.equal(o.status, 'pending_phone_confirmation');
    assert.equal(o.subtotal_cents, 29000);
    assert.equal(o.fee_cents, 2000);
    assert.equal(o.total_cents, 31000);
    assert.equal(o.deliveries[0].deliver_at, '2026-10-05T11:00:00.000Z');
    assert.equal(o.can_switch_to_prepaid, true);
    // تغيير سعر الوجبة لاحقاً لا يغيّر الطلب القائم
    await t.admin.patch(`/api/admin/menu/${t.items.bamya}`, { category_id: 1, name: 'بامية', price_cents: 99900 });
    assert.equal((await c.get(`/api/orders/${o.id}`)).data.order.total_cents, 31000);
  } finally { await t.close(); }
});

test('قواعد المواعيد: الحد الأدنى، ساعات العمل، وأقصى مدة', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const one = [{ menu_item_id: t.items.kofta, qty: 1 }];
    const soon = await place(c, [dl(one, '2026-10-03', '13:00')]); // بعد ساعة فقط
    assert.equal(soon.status, 400);
    assert.equal(soon.data.error.code, 'too_soon');
    assert.equal((await place(c, [dl(one, '2026-10-06', '23:30')])).data.error.code, 'closed');
    assert.equal((await place(c, [dl(one, '2026-10-06', '08:00')])).data.error.code, 'closed');
    assert.equal((await place(c, [dl(one, '2027-03-01', '14:00')])).data.error.code, 'too_far');
    assert.equal((await place(c, [dl(one, '2026-02-30', '14:00')])).status, 400);
    assert.equal((await place(c, [])).status, 400);
    // وجبة غير متاحة
    await t.admin.post(`/api/admin/menu/${t.items.kofta}/availability`, { available: false });
    assert.equal((await place(c, [dl(one, '2026-10-06', '14:00')])).data.error.code, 'unavailable');
  } finally { await t.close(); }
});

test('التحويل المسبق يتطلب إيصالاً ويبدأ بمراجعة الإيصال', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const items = [{ menu_item_id: t.items.kofta, qty: 1 }];
    const payload = { address_id: c.addr, payment_method: 'transfer', deliveries: [dl(items, '2026-10-05', '14:00')] };
    const { orderForm } = require('./helpers');
    const noFile = await c.req('POST', '/api/orders', { form: orderForm(payload, false) });
    assert.equal(noFile.status, 400);
    assert.equal(noFile.data.error.code, 'receipt_required');
    const ok = await place(c, [dl(items, '2026-10-05', '14:00')], 'transfer');
    assert.equal(ok.status, 201);
    assert.equal(ok.data.order.status, 'receipt_review');
    assert.equal(ok.data.order.receipts.length, 1);
  } finally { await t.close(); }
});

test('رفع ملف ليس صورة مرفوض', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const f = new FormData();
    f.set('payload', JSON.stringify({ address_id: c.addr, payment_method: 'transfer', deliveries: [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')] }));
    f.set('receipt', new Blob([Buffer.from('<script>alert(1)</script>')], { type: 'image/png' }), 'x.png');
    const r = await c.req('POST', '/api/orders', { form: f });
    assert.equal(r.status, 400);
  } finally { await t.close(); }
});

/* ---------- التحويل من كاش إلى دفع مسبق ---------- */
test('التحويل من كاش إلى دفع مسبق مسموح قبل تأكيد المكالمة فقط', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const o1 = (await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    const sw = await c.req('POST', `/api/orders/${o1.id}/switch-to-prepaid`, { form: receiptForm('777') });
    assert.equal(sw.status, 200);
    assert.equal(sw.data.order.status, 'receipt_review');
    assert.equal(sw.data.order.payment_method, 'transfer');
    // الأدمن لم يعد يستطيع تأكيده بمكالمة
    const call = await t.admin.post(`/api/admin/orders/${o1.id}/call`, { outcome: 'confirmed' });
    assert.equal(call.status, 409);

    // طلب ثانٍ: الأدمن يؤكد أولاً ثم العميل يحاول التحويل
    const o2 = (await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 1 }], '2026-10-06', '14:00')])).data.order;
    assert.equal((await t.admin.post(`/api/admin/orders/${o2.id}/call`, { outcome: 'confirmed', note: 'تم' })).status, 200);
    const late = await c.req('POST', `/api/orders/${o2.id}/switch-to-prepaid`, { form: receiptForm() });
    assert.equal(late.status, 409);
    const after = (await c.get(`/api/orders/${o2.id}`)).data.order;
    assert.equal(after.payment_method, 'cod');
    assert.equal(after.status, 'confirmed');
    assert.equal(after.can_switch_to_prepaid, false);
  } finally { await t.close(); }
});

test('مراجعة الإيصال: الرفض يتطلب سبباً، وإعادة الرفع ثم الاعتماد', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const o = (await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 2 }], '2026-10-05', '14:00')], 'transfer')).data.order;
    assert.equal((await t.admin.post(`/api/admin/orders/${o.id}/receipt/review`, { approve: false })).status, 400);
    const rej = await t.admin.post(`/api/admin/orders/${o.id}/receipt/review`, { approve: false, reason: 'المبلغ غير مطابق' });
    assert.equal(rej.data.order.status, 'receipt_rejected');
    const notes = (await c.get('/api/notifications')).data;
    assert.match(notes.notifications[0].message, /المبلغ غير مطابق/);
    const re = await c.req('POST', `/api/orders/${o.id}/receipt`, { form: receiptForm('999') });
    assert.equal(re.data.order.status, 'receipt_review');
    const ok = await t.staff.post(`/api/admin/orders/${o.id}/receipt/review`, { approve: true });
    assert.equal(ok.data.order.status, 'confirmed');
    assert.equal(ok.data.order.confirmed_by_name, 'موظف');
    // اعتماد ثانٍ على نفس الطلب مرفوض
    assert.equal((await t.admin.post(`/api/admin/orders/${o.id}/receipt/review`, { approve: true })).status, 409);
  } finally { await t.close(); }
});

/* ---------- التوصيل السريع (خلال ساعة) ---------- */
test('التوصيل السريع: يحسب الموعد بعد ساعة، يقيّد الأصناف، ويبدأ التجهيز فور التأكيد', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const cfg = (await c.get('/api/config')).data;
    assert.equal(cfg.asap.available, true);
    // وجبة غير مخصصة للتوصيل السريع
    const bad = await place(c, [{ asap: true, items: [{ menu_item_id: t.items.bamya, qty: 1 }] }]);
    assert.equal(bad.data.error.code, 'asap_item');
    const r = await place(c, [{ asap: true, items: [{ menu_item_id: t.items.kofta, qty: 1 }] }]);
    assert.equal(r.status, 201);
    const o = r.data.order;
    assert.equal(o.deliveries[0].is_asap, 1);
    assert.equal(o.deliveries[0].deliver_at, '2026-10-03T10:00:00.000Z'); // الآن + 60 دقيقة
    assert.equal(o.fee_cents, 3000); // رسوم التوصيل السريع
    // الأدمن يؤكد هاتفياً فيبدأ التجهيز فوراً
    const conf = await t.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    assert.equal(conf.data.order.deliveries[0].status, 'preparing');
    assert.equal(conf.data.order.stage, 'preparing');
    // لا يمكن للعميل إلغاؤه بعد بدء التجهيز
    assert.equal((await c.post(`/api/orders/${o.id}/cancel`)).status, 409);
    // خارج مواعيد العمل لا يتوفر
    t.clock.t = new Date('2026-10-03T20:30:00Z'); // 23:30 بتوقيت القاهرة
    assert.equal((await c.get('/api/config')).data.asap.available, false);
    assert.equal((await place(c, [{ asap: true, items: [{ menu_item_id: t.items.kofta, qty: 1 }] }])).data.error.code, 'asap_unavailable');
    // وعند إيقافه من الإعدادات
    t.clock.t = new Date('2026-10-03T09:00:00Z');
    await t.admin.put('/api/admin/settings', { asap_enabled: false });
    assert.equal((await c.get('/api/config')).data.asap.available, false);
  } finally { await t.close(); }
});

/* ---------- الإلغاء والاسترداد ---------- */
test('الإلغاء: مسموح قبل التجهيز، ممنوع بعده، وإلغاء يوم منفرد مع الاسترداد', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const o1 = (await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    assert.equal((await c.post(`/api/orders/${o1.id}/cancel`)).data.order.status, 'cancelled');

    // طلب مدفوع مسبقاً بيومين
    const o2 = (await place(c, [
      dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00'),
      dl([{ menu_item_id: t.items.salad, qty: 2 }], '2026-10-07', '15:00'),
    ], 'transfer')).data.order;
    await t.admin.post(`/api/admin/orders/${o2.id}/receipt/review`, { approve: true });
    const [d1, d2] = o2.deliveries;
    // يبدأ تجهيز اليوم الأول
    await t.admin.post(`/api/admin/deliveries/${d1.id}/advance`, {});
    // إلغاء الطلب كاملاً ممنوع، لكن اليوم الثاني يمكن إلغاؤه
    assert.equal((await c.post(`/api/orders/${o2.id}/cancel`)).status, 409);
    assert.equal((await c.post(`/api/orders/${o2.id}/deliveries/${d1.id}/cancel`)).status, 409);
    const cd = await c.post(`/api/orders/${o2.id}/deliveries/${d2.id}/cancel`);
    assert.equal(cd.status, 200);
    assert.equal(cd.data.order.refund_due_cents, 2 * 8500 + 2000);
    assert.equal(cd.data.order.total_cents, 13000 + 2000);
    // الأدمن يسجل الاسترداد
    const rf = await t.admin.post(`/api/admin/orders/${o2.id}/refund`);
    assert.equal(rf.data.order.refund_due_cents, 0);
    assert.equal(rf.data.order.refunded_cents, 19000);
  } finally { await t.close(); }
});

test('عميل لا يرى ولا يلغي طلب غيره، والإيصالات محمية', async () => {
  const t = await boot();
  try {
    const a = await t.customer('أحمد', '01111111111');
    const b = await t.customer('بسمة', '01122222222');
    const o = (await place(a, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')], 'transfer')).data.order;
    assert.equal((await b.get(`/api/orders/${o.id}`)).status, 404);
    assert.equal((await b.post(`/api/orders/${o.id}/cancel`)).status, 404);
    const rid = o.receipts[0].id;
    assert.equal((await b.get(`/api/receipts/${rid}/file`)).status, 404);
    assert.equal((await a.get(`/api/receipts/${rid}/file`)).status, 200);
    assert.equal((await t.staff.get(`/api/admin/receipts/${rid}/file`)).status, 200);
    const anon = await fetch(`${t.base}/api/admin/receipts/${rid}/file`);
    assert.equal(anon.status, 401);
  } finally { await t.close(); }
});

/* ---------- التنفيذ ---------- */
test('مراحل التنفيذ وتسوية الكاش وحدود الطلبات المعلقة', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const o = (await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 2 }], '2026-10-05', '14:00')])).data.order;
    const did = o.deliveries[0].id;
    // لا تنفيذ قبل التأكيد
    assert.equal((await t.admin.post(`/api/admin/deliveries/${did}/advance`, {})).status, 409);
    await t.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    await t.admin.post(`/api/admin/deliveries/${did}/advance`, {}); // preparing
    await t.admin.post(`/api/admin/deliveries/${did}/advance`, {}); // out
    const noCash = await t.admin.post(`/api/admin/deliveries/${did}/advance`, {});
    assert.equal(noCash.status, 400);
    assert.equal(noCash.data.error.code, 'cash_required');
    const done = await t.admin.post(`/api/admin/deliveries/${did}/advance`, { cash_confirmed: true });
    assert.equal(done.data.order.stage, 'delivered');
    assert.equal(done.data.order.deliveries[0].cash_collected_cents, 31000);
    const st = (await t.admin.get('/api/admin/stats')).data;
    assert.equal(st.cash_today_cents, 31000);
    assert.equal(st.sales_today_cents, 31000);
    assert.equal(st.delivered_today, 1);
  } finally { await t.close(); }
});

test('حد طلبات الكاش المعلقة للعميل الواحد', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const items = [{ menu_item_id: t.items.kofta, qty: 1 }];
    for (let i = 0; i < 3; i++) assert.equal((await place(c, [dl(items, '2026-10-06', '14:00')])).status, 201);
    const r = await place(c, [dl(items, '2026-10-06', '15:00')]);
    assert.equal(r.status, 429);
    // لكن التحويل المسبق لا يزال متاحاً
    assert.equal((await place(c, [dl(items, '2026-10-06', '15:00')], 'transfer')).status, 201);
  } finally { await t.close(); }
});

test('التجهيز التلقائي حسب قرب موعد التسليم', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const o = (await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-03', '16:00')])).data.order; // 16:00 بتوقيت القاهرة = 13:00Z
    await t.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    // الآن 12:00 بتوقيت القاهرة، والموعد بعد 4 ساعات (> 180 دقيقة): لم يبدأ بعد
    assert.equal((await t.admin.get(`/api/admin/orders/${o.id}`)).data.order.deliveries[0].status, 'scheduled');
    t.clock.advance(70); // بقي 170 دقيقة
    assert.equal(await t.svc.autoPrepare(), 1);
    assert.equal((await t.admin.get(`/api/admin/orders/${o.id}`)).data.order.deliveries[0].status, 'preparing');
  } finally { await t.close(); }
});

/* ---------- الترتيب في لوحة الإدارة ---------- */
test('ترتيب الطلبات: الافتراضي حسب وقت التسليم من الأقرب للأبعد + كل أنواع الترتيب تصاعدياً وتنازلياً', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    // A: كاش، غداً 18:00، 165 ج.م
    const A = (await place(c, [dl([{ menu_item_id: t.items.bamya, qty: 1 }], '2026-10-04', '18:00')])).data.order;
    t.clock.advance(5);
    // B: تحويل مدفوع، غداً 12:00، 410 ج.م  (يُعتمد ثم يبدأ تجهيزه)
    const B = (await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 3 }], '2026-10-04', '12:00')], 'transfer')).data.order;
    t.clock.advance(5);
    // C: كاش عاجل (خلال ساعة)، 115 ج.م
    const C = (await place(c, [{ asap: true, items: [{ menu_item_id: t.items.salad, qty: 1 }] }])).data.order;
    await t.admin.post(`/api/admin/orders/${B.id}/receipt/review`, { approve: true });
    await t.admin.post(`/api/admin/deliveries/${B.deliveries[0].id}/advance`, {}); // B -> preparing

    const ids = async (qs) => (await t.admin.get('/api/admin/orders?' + qs)).data.orders.map((o) => o.number);
    const [a, b, cc] = [A.number, B.number, C.number];

    // الافتراضي: وقت التسليم تصاعدي (العاجل أولاً)
    assert.deepEqual(await ids(''), [cc, b, a]);
    assert.deepEqual(await ids('sort=delivery&dir=asc'), [cc, b, a]);
    assert.deepEqual(await ids('sort=delivery&dir=desc'), [a, b, cc]);
    // وقت الطلب
    assert.deepEqual(await ids('sort=created&dir=asc'), [a, b, cc]);
    assert.deepEqual(await ids('sort=created&dir=desc'), [cc, b, a]);
    // السعر
    assert.deepEqual(await ids('sort=total&dir=asc'), [cc, a, b]);
    assert.deepEqual(await ids('sort=total&dir=desc'), [b, a, cc]);
    // المرحلة: A و C بانتظار المكالمة (1)، B قيد التجهيز (5)
    assert.deepEqual(await ids('sort=stage&dir=asc'), [cc, a, b]);
    assert.deepEqual(await ids('sort=stage&dir=desc'), [b, cc, a]);
    // ترتيب غير معروف يرجع للافتراضي (لا حقن SQL)
    assert.deepEqual(await ids('sort=id;DROP TABLE orders&dir=asc'), [cc, b, a]);

    // الطلب العاجل موسوم ومعه الدقائق المتبقية
    const first = (await t.admin.get('/api/admin/orders')).data.orders[0];
    assert.equal(first.is_asap, true);
    assert.equal(first.minutes_to_delivery, 60);
    assert.equal(first.is_late, false);

    // فلاتر النطاق
    assert.deepEqual((await ids('scope=calls&sort=delivery')), [cc, a]);
    assert.deepEqual(await ids('scope=receipts'), []);
    assert.deepEqual(await ids('scope=kitchen'), [b]);
    assert.deepEqual(await ids('payment=transfer&scope=all'), [b]);
    assert.deepEqual(await ids(`q=${a}&scope=all`), [a]);
    assert.deepEqual(await ids('stage=preparing&scope=all'), [b]);

    // تأخر الموعد يظهر كمتأخر
    t.clock.advance(120);
    const late = (await t.admin.get('/api/admin/orders')).data.orders[0];
    assert.equal(late.number, cc);
    assert.equal(late.is_late, true);

    // الطلب المنتهي يخرج من «النشطة» ويظهر في «المنتهية»
    await t.admin.post(`/api/admin/orders/${A.id}/call`, { outcome: 'cancelled', note: 'لم يرد' });
    assert.deepEqual(await ids('scope=done'), [a]);
    assert.ok(!(await ids('')).includes(a));
  } finally { await t.close(); }
});

test('الطلب متعدد المواعيد يُرتَّب بأقرب موعد نشط ثم ينتقل للموعد التالي', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const items = [{ menu_item_id: t.items.kofta, qty: 1 }];
    const X = (await place(c, [dl(items, '2026-10-05', '12:00'), dl(items, '2026-10-09', '12:00')], 'transfer')).data.order;
    const Y = (await place(c, [dl(items, '2026-10-07', '12:00')], 'transfer')).data.order;
    await t.admin.post(`/api/admin/orders/${X.id}/receipt/review`, { approve: true });
    await t.admin.post(`/api/admin/orders/${Y.id}/receipt/review`, { approve: true });
    const nums = async () => (await t.admin.get('/api/admin/orders')).data.orders.map((o) => o.number);
    assert.deepEqual(await nums(), [X.number, Y.number]);
    // تسليم أول موعد لـ X فيصبح موعده التالي 9 أكتوبر
    const d = X.deliveries[0].id;
    await t.admin.post(`/api/admin/deliveries/${d}/advance`, {});
    await t.admin.post(`/api/admin/deliveries/${d}/advance`, {});
    await t.admin.post(`/api/admin/deliveries/${d}/advance`, {});
    assert.deepEqual(await nums(), [Y.number, X.number]);
  } finally { await t.close(); }
});

/* ---------- المطبخ والمنيو والتحديث اللحظي ---------- */
test('أجندة المطبخ تجمّع الكميات بالساعة وتستثني غير المؤكد', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const k = (n) => [{ menu_item_id: t.items.kofta, qty: n }];
    const o1 = (await place(c, [dl(k(3), '2026-10-05', '14:00')], 'transfer')).data.order;
    const o2 = (await place(c, [dl(k(2), '2026-10-05', '14:00')], 'transfer')).data.order;
    await place(c, [dl(k(4), '2026-10-05', '16:00')]); // غير مؤكد
    await t.admin.post(`/api/admin/orders/${o1.id}/receipt/review`, { approve: true });
    await t.admin.post(`/api/admin/orders/${o2.id}/receipt/review`, { approve: true });
    const k1 = (await t.admin.get('/api/admin/kitchen?date=2026-10-05')).data;
    assert.equal(k1.slots.length, 1);
    assert.equal(k1.slots[0].deliveries.length, 2);
    assert.equal(k1.totals[0].qty, 5);
    assert.equal(k1.pending_qty, 4);
  } finally { await t.close(); }
});

test('إدارة المنيو والتصنيفات (مدير فقط) وحذف ناعم', async () => {
  const t = await boot();
  try {
    assert.equal((await t.staff.post('/api/admin/categories', { name: 'حلويات' })).status, 403);
    const cat = (await t.admin.post('/api/admin/categories', { name: 'حلويات', sort_order: 5 })).data.category;
    assert.equal((await t.admin.post('/api/admin/categories', { name: 'حلويات' })).status, 409);
    const it = (await t.admin.post('/api/admin/menu', { category_id: cat.id, name: 'كنافة', price_cents: 6000, asap_ok: true })).data.item;
    assert.equal(it.asap_ok, 1);
    assert.equal((await t.admin.del(`/api/admin/categories/${cat.id}`)).status, 409);
    // موظف المطبخ يستطيع إيقاف وجبة نفدت
    assert.equal((await t.staff.post(`/api/admin/menu/${it.id}/availability`, { available: false })).status, 200);
    const pub = (await t.admin.get('/api/menu')).data;
    assert.equal(pub.items.find((x) => x.id === it.id).available, 0);
    assert.equal((await t.admin.del(`/api/admin/menu/${it.id}`)).status, 200);
    assert.ok(!(await t.admin.get('/api/menu')).data.items.some((x) => x.id === it.id));
  } finally { await t.close(); }
});

test('الإعدادات: التحقق من القيم وتأثيرها', async () => {
  const t = await boot();
  try {
    assert.equal((await t.admin.put('/api/admin/settings', { open_time: '23:00', close_time: '10:00' })).status, 400);
    assert.equal((await t.admin.put('/api/admin/settings', { timezone: 'Mars/Base' })).status, 400);
    assert.equal((await t.admin.put('/api/admin/settings', { asap_minutes: 5 })).status, 400);
    const ok = await t.admin.put('/api/admin/settings', { asap_minutes: 45, delivery_fee_cents: 1500 });
    assert.equal(ok.data.settings.asap_minutes, 45);
    const c = await t.customer();
    const o = (await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    assert.equal(o.fee_cents, 1500);
  } finally { await t.close(); }
});

test('التحديث اللحظي: الأدمن يستلم حدث الطلب الجديد عبر SSE', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const res = await fetch(`${t.base}/api/admin/events`, { headers: { Cookie: `sofra_staff=${t.admin.cookies.sofra_staff}` } });
    assert.equal(res.status, 200);
    const reader = res.body.getReader();
    await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')]);
    let text = '';
    const dec = new TextDecoder();
    const deadline = Date.now() + 3000;
    while (!text.includes('new_order') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    await reader.cancel();
    assert.match(text, /event: order/);
    assert.match(text, /new_order/);
  } finally { await t.close(); }
});

test('تطبيق الموبايل: مصادقة Bearer بدون كوكي، وCORS لنسخة الويب', async () => {
  const t = await boot();
  try {
    const r = await fetch(t.base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sofra' }, body: JSON.stringify({ name: 'مها', phone: '01255554444', password: 'password123' }) });
    const { token, user } = await r.json();
    assert.ok(token && user.role === 'customer');
    const me = await fetch(t.base + '/api/auth/me', { headers: { Authorization: 'Bearer ' + token, 'X-Requested-With': 'sofra' } });
    assert.equal(me.status, 200);
    assert.equal((await fetch(t.base + '/api/auth/me', { headers: { Authorization: 'Bearer bad', 'X-Requested-With': 'sofra' } })).status, 401);
    // توكن عميل لا يفتح لوحة الإدارة
    assert.equal((await fetch(t.base + '/api/admin/stats', { headers: { Authorization: 'Bearer ' + token, 'X-Requested-With': 'sofra' } })).status, 401);
    const pre = await fetch(t.base + '/api/orders', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8081', 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  } finally { await t.close(); }
});

/* ---------- إشعارات الهاتف (Push) ---------- */
const TOKEN = 'ExponentPushToken[abcdefghijklmnop1234]';
const okFetch = (calls, tickets) => async (url, init) => {
  const messages = JSON.parse(init.body);
  calls.push({ url, messages, headers: init.headers });
  return { json: async () => ({ data: messages.map((_, i) => (tickets ? tickets[i] : { status: 'ok', id: 'x' + i })) }) };
};

test('تسجيل توكن الإشعارات: تحقق الصيغة، الصلاحية، ونقل الجهاز بين الحسابات', async () => {
  const t = await boot();
  try {
    const a = await t.customer('أحمد', '01111111111');
    const b = await t.customer('بسمة', '01122222222');
    assert.equal((await a.post('/api/push-token', { token: 'not-a-token', platform: 'android' })).status, 400);
    assert.equal((await t.admin.post('/api/push-token', { token: TOKEN })).status, 401); // الأدمن ليس عميلاً
    assert.equal((await a.post('/api/push-token', { token: TOKEN, platform: 'android' })).status, 200);
    assert.equal((await t.db.one('SELECT user_id FROM push_tokens WHERE token=?', TOKEN)).user_id, 1 + 2); // أحمد ثالث مستخدم بعد المدير والموظف
    // نفس الجهاز يسجّل دخول حساب آخر: ينتقل التوكن ولا يتكرر
    assert.equal((await b.post('/api/push-token', { token: TOKEN, platform: 'android' })).status, 200);
    assert.equal((await t.db.one('SELECT COUNT(*) c FROM push_tokens')).c, 1);
    assert.equal((await t.db.one('SELECT user_id FROM push_tokens WHERE token=?', TOKEN)).user_id, 4);
    // عميل آخر لا يستطيع حذف توكن غيره
    await a.post('/api/push-token/remove', { token: TOKEN });
    assert.equal((await t.db.one('SELECT COUNT(*) c FROM push_tokens')).c, 1);
    await b.post('/api/push-token/remove', { token: TOKEN });
    assert.equal((await t.db.one('SELECT COUNT(*) c FROM push_tokens')).c, 0);
  } finally { await t.close(); }
});

test('إرسال Push عند تغيّر حالة الطلب، وحذف التوكن غير الصالح، وعدم تعطّل الطلب عند فشل الإرسال', async () => {
  const calls = [];
  const t = await boot({ fetchImpl: okFetch(calls) });
  try {
    const c = await t.customer();
    await c.post('/api/push-token', { token: TOKEN, platform: 'ios' });
    const o = (await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    await t.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    await t.push.flush();
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /exp\.host\/--\/api\/v2\/push\/send/);
    const m = calls[0].messages[0];
    assert.equal(m.to, TOKEN);
    assert.equal(m.title, 'سفرة / بيتي');
    assert.match(m.body, /تم تأكيد طلبك/);
    assert.equal(m.data.order_id, o.id);
    assert.equal(m.channelId, 'default');
    // مراحل التنفيذ ترسل إشعاراً أيضاً
    await t.admin.post(`/api/admin/deliveries/${o.deliveries[0].id}/advance`, {});
    await t.push.flush();
    assert.match(calls[1].messages[0].body, /بدأ التجهيز|قيد التجهيز/);
  } finally { await t.close(); }

  // جهاز ألغى التثبيت: Expo يرد DeviceNotRegistered فيُحذف التوكن
  const calls2 = [];
  const t2 = await boot({ fetchImpl: okFetch(calls2, [{ status: 'error', message: 'x', details: { error: 'DeviceNotRegistered' } }]) });
  try {
    const c = await t2.customer();
    await c.post('/api/push-token', { token: TOKEN, platform: 'android' });
    const o = (await place(c, [dl([{ menu_item_id: t2.items.kofta, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    await t2.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    await t2.push.flush();
    assert.equal((await t2.db.one('SELECT COUNT(*) c FROM push_tokens')).c, 0);
  } finally { await t2.close(); }

  // لا إنترنت: الإرسال يفشل بصمت والتأكيد ينجح والإشعار الداخلي يُحفظ
  const t3 = await boot({ fetchImpl: async () => { throw new Error('offline'); } });
  try {
    const c = await t3.customer();
    await c.post('/api/push-token', { token: TOKEN, platform: 'android' });
    const o = (await place(c, [dl([{ menu_item_id: t3.items.kofta, qty: 1 }], '2026-10-05', '14:00')])).data.order;
    const r = await t3.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });
    assert.equal(r.status, 200);
    await t3.push.flush();
    assert.equal((await c.get('/api/notifications')).data.notifications.length, 1);
  } finally { await t3.close(); }
});

test('الوجبة الجديدة تصلح للطلب الفوري افتراضياً', async () => {
  const t = await boot();
  try {
    const cat = (await t.admin.post('/api/admin/categories', { name: 'عصائر' })).data.category;
    const it = (await t.admin.post('/api/admin/menu', { category_id: cat.id, name: 'ليمون', price_cents: 3000 })).data.item;
    assert.equal(it.asap_ok, 1);
  } finally { await t.close(); }
});

test('إشعارات Push لفريق الإدارة عند وصول طلب أو إيصال جديد (دخول بـ Bearer من التطبيق)', async () => {
  const calls = [];
  const t = await boot({ fetchImpl: okFetch(calls) });
  try {
    // دخول الموظف من التطبيق يعيد token
    const login = await fetch(t.base + '/api/admin/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sofra' }, body: JSON.stringify({ phone: '01000000001', password: 'password123' }) });
    const { token } = await login.json();
    assert.ok(token);
    const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'sofra', Authorization: 'Bearer ' + token };
    const T1 = 'ExponentPushToken[staff-device-0000001]';
    assert.equal((await fetch(t.base + '/api/admin/push-token', { method: 'POST', headers: H, body: JSON.stringify({ token: T1, platform: 'android' }) })).status, 200);
    // العميل لا يستطيع تسجيل توكن على مسار الإدارة
    const c = await t.customer();
    assert.equal((await c.post('/api/admin/push-token', { token: T1 })).status, 401);
    await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')], 'transfer');
    await t.push.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].messages[0].to, T1);
    assert.match(calls[0].messages[0].body, /إيصال جديد|طلب جديد/);
    assert.equal(calls[0].messages[0].data.staff, true);
    // موظف معطّل لا يستلم إشعارات
    (await t.db.run("UPDATE users SET active=0 WHERE phone='01000000001'"));
    await place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-06', '14:00')], 'transfer');
    await t.push.flush();
    assert.equal(calls.length, 1);
    // token موظف يعمل على مسارات الإدارة وتوكن العميل لا يعمل
    const ctk = await (await fetch(t.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'sofra' }, body: JSON.stringify({ phone: '01012345678', password: 'password123' }) })).json();
    assert.equal((await fetch(t.base + '/api/admin/stats', { headers: { Authorization: 'Bearer ' + ctk.token, 'X-Requested-With': 'sofra' } })).status, 401);
  } finally { await t.close(); }
});

test('الواجهة الوحيدة هي تطبيق Expo على /web، والمسارات القديمة /app و/admin محذوفة', async () => {
  const t = await boot();
  try {
    const fs = require('fs');
    const path = require('path');
    const hasWeb = fs.existsSync(path.join(__dirname, '..', 'mobile', 'dist', 'index.html'));
    const root = await fetch(t.base + '/', { redirect: 'manual' });
    if (hasWeb) {
      assert.equal(root.status, 302);
      assert.equal(root.headers.get('location'), '/web/');
      const page = await fetch(t.base + '/web/some/deep/link'); // SPA fallback
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<script src="\/web\/_expo\/static\/js\/web\//);
    } else {
      assert.equal(root.status, 200); // صفحة إرشاد: npm run build:web
    }
    assert.equal((await fetch(t.base + '/app/')).status, 404);
    assert.equal((await fetch(t.base + '/admin/')).status, 404);
    assert.equal((await fetch(t.base + '/shared/common.js')).status, 404);
  } finally { await t.close(); }
});

/* ---------- إعدادات يتحكم فيها المدير: QR وحسابات التحويل وطرق الدفع والإيقاف ---------- */
test('حسابات التحويل مع كود QR: رفع، ظهور للعميل المسجل فقط، وحذف الصورة عند إزالتها', async () => {
  const t = await boot();
  try {
    const { PNG } = require('./helpers');
    const fd = () => { const f = new FormData(); f.set('image', new Blob([PNG], { type: 'image/png' }), 'qr.png'); return f; };
    assert.equal((await t.staff.req('POST', '/api/admin/payment-qr', { form: fd() })).status, 403);
    const up = await t.admin.req('POST', '/api/admin/payment-qr', { form: fd() });
    assert.equal(up.status, 201);
    const file = up.data.file;
    assert.match(file, /^[a-f0-9]{32}\.png$/);
    // ملف نصي ليس صورة
    const bad = new FormData(); bad.set('image', new Blob([Buffer.from('<html>')], { type: 'image/png' }), 'x.png');
    assert.equal((await t.admin.req('POST', '/api/admin/payment-qr', { form: bad })).status, 400);

    // اسم صورة غير موجودة أو بصيغة مشبوهة مرفوض
    assert.equal((await t.admin.put('/api/admin/settings', { payment_accounts: [{ label: 'إنستاباي', value: 'a@b', qr: '../../etc/passwd' }] })).status, 400);
    assert.equal((await t.admin.put('/api/admin/settings', { payment_accounts: [{ label: 'إنستاباي', value: 'a@b', qr: 'a'.repeat(32) + '.png' }] })).status, 400);

    const accounts = [{ label: 'إنستاباي', value: 'sofra@instapay', qr: file }, { label: 'فودافون كاش', value: '01011112222' }];
    assert.equal((await t.admin.put('/api/admin/settings', { payment_accounts: accounts, kitchen_phone: '01099990000' })).status, 200);

    const c = await t.customer();
    const cfg = (await c.get('/api/config')).data;
    assert.deepEqual(cfg.payment_accounts.map((a) => [a.label, a.value, a.qr]), [['إنستاباي', 'sofra@instapay', file], ['فودافون كاش', '01011112222', null]]);
    assert.equal(cfg.kitchen_phone, '01099990000');
    assert.deepEqual((await fetch(t.base + '/api/config')).headers.get('content-type').includes('json'), true);
    assert.deepEqual((await (await fetch(t.base + '/api/config')).json()).payment_accounts, []); // الزائر لا يرى الحسابات
    assert.equal((await fetch(`${t.base}/media/qr/${file}`)).status, 200);

    // إزالة الـ QR من الحساب تحذف الملف
    await t.admin.put('/api/admin/settings', { payment_accounts: [{ label: 'إنستاباي', value: 'sofra@instapay' }] });
    assert.equal((await fetch(`${t.base}/media/qr/${file}`)).status, 404);
  } finally { await t.close(); }
});

test('إيقاف استقبال الطلبات، وتعطيل طرق الدفع، وفاصل الأوقات: كلها تُطبَّق في الخادم', async () => {
  const t = await boot();
  try {
    const c = await t.customer();
    const one = [{ menu_item_id: t.items.kofta, qty: 1 }];

    // طريقة دفع واحدة على الأقل
    assert.equal((await t.admin.put('/api/admin/settings', { cod_enabled: false, transfer_enabled: false })).status, 400);
    await t.admin.put('/api/admin/settings', { cod_enabled: false });
    const cod = await place(c, [dl(one, '2026-10-05', '14:00')], 'cod');
    assert.equal(cod.status, 400);
    assert.equal(cod.data.error.code, 'pay_disabled');
    assert.equal((await place(c, [dl(one, '2026-10-05', '14:00')], 'transfer')).status, 201);
    assert.equal((await c.get('/api/config')).data.cod_enabled, false);
    await t.admin.put('/api/admin/settings', { cod_enabled: true });

    // فاصل الأوقات 60 دقيقة
    await t.admin.put('/api/admin/settings', { slot_minutes: 60 });
    assert.equal((await place(c, [dl(one, '2026-10-05', '14:30')])).data.error.code, 'bad_slot');
    assert.equal((await place(c, [dl(one, '2026-10-05', '15:00')])).status, 201);
    assert.equal((await t.admin.put('/api/admin/settings', { slot_minutes: 45 })).status, 400);
    await t.admin.put('/api/admin/settings', { slot_minutes: 30 });

    // إيقاف استقبال الطلبات برسالة، وإعلان أعلى المنيو
    await t.admin.put('/api/admin/settings', { accepting_orders: false, closed_message: 'مغلقون اليوم للصيانة', announcement: 'عرض الجمعة' });
    const cfg = (await c.get('/api/config')).data;
    assert.equal(cfg.accepting_orders, false);
    assert.equal(cfg.announcement, 'عرض الجمعة');
    assert.equal(cfg.asap.available, false);
    assert.equal(cfg.asap.reason, 'مغلقون اليوم للصيانة');
    const closed = await place(c, [dl(one, '2026-10-06', '14:00')]);
    assert.equal(closed.status, 400);
    assert.equal(closed.data.error.message, 'مغلقون اليوم للصيانة');
    await t.admin.put('/api/admin/settings', { accepting_orders: true });
    assert.equal((await place(c, [dl(one, '2026-10-06', '14:00')])).status, 201);
  } finally { await t.close(); }
});

/* ---------- النشر: Postgres + Supabase + Render ---------- */
test('مهمة التجهيز الدورية /api/cron/tick محمية بالمفتاح', async () => {
  const t = await boot();
  try {
    assert.equal((await fetch(t.base + '/api/cron/tick')).status, 403);
    assert.equal((await fetch(t.base + '/api/cron/tick?key=wrong')).status, 403);
    const ok = await fetch(t.base + '/api/cron/tick?key=test-cron-secret');
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, prepared: 0 });
    assert.equal((await fetch(t.base + '/healthz')).status, 200);
  } finally { await t.close(); }
});

test('أرقام الطلبات متسلسلة وفريدة حتى مع الطلبات المتزامنة، والمعرّفات غير الرقمية تعطي 404', async () => {
  const t = await boot();
  try {
    const cs = await Promise.all([t.customer('أ ب', '01011111111'), t.customer('ج د', '01022222222'), t.customer('هـ و', '01033333333')]);
    const rs = await Promise.all(cs.map((c) => place(c, [dl([{ menu_item_id: t.items.kofta, qty: 1 }], '2026-10-05', '14:00')])));
    const nums = rs.map((r) => r.data.order.number).sort();
    assert.deepEqual(nums, [1001, 1002, 1003]);
    assert.equal((await cs[0].get('/api/orders/abc')).status, 404);
    assert.equal((await t.admin.get('/api/admin/orders/99999999999')).status, 404);
    assert.equal((await t.admin.del('/api/admin/categories/xyz')).status, 404);
  } finally { await t.close(); }
});

test('تخزين Supabase: إنشاء المساحات، الرفع، القراءة، والحذف عبر Storage API', async () => {
  const { createStorage } = require('../src/storage');
  const calls = [];
  const objects = new Map();
  const fake = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    const u = new URL(url);
    const ok = (body = '{}', status = 200) => new Response(body, { status });
    if (u.pathname === '/storage/v1/bucket') return ok('{"message":"The resource already exists"}', 400);
    const m = u.pathname.match(/^\/storage\/v1\/object\/(info\/)?([^/]+)\/?(.*)$/);
    const key = `${m[2]}/${m[3]}`;
    if (init.method === 'POST') { objects.set(key, Buffer.from(await new Response(init.body).arrayBuffer())); return ok(); }
    if (init.method === 'DELETE') { for (const p of JSON.parse(init.body).prefixes) objects.delete(`${m[2]}/${p}`); return ok('[]'); }
    return objects.has(key) ? new Response(m[1] ? '{}' : objects.get(key)) : ok('{"error":"not_found"}', 404);
  };
  const s = createStorage({ env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }, fetchImpl: fake });
  assert.equal(s.driver, 'supabase');
  await s.init(); // المساحات موجودة مسبقاً: لا خطأ
  const name = 'a'.repeat(32) + '.png';
  await s.put('receipts', name, Buffer.from('hello'));
  assert.ok(objects.has(`sofra-receipts/${name}`));
  assert.equal((await s.get('receipts', name)).toString(), 'hello');
  assert.equal(await s.exists('receipts', name), true);
  await s.remove('receipts', name);
  assert.equal(await s.get('receipts', name), null);
  await assert.rejects(() => s.put('menu', '../evil.png', Buffer.from('x')));
});

test('cron-job.org: المهمة الدورية تقبل POST وجسماً فارغاً أو غير صالح', async () => {
  const t = await boot();
  try {
    const r1 = await fetch(t.base + '/api/cron/tick?key=test-cron-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '' });
    assert.equal(r1.status, 200);
    const r2 = await fetch(t.base + '/api/cron/tick?key=test-cron-secret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(r2.status, 200);
    assert.equal((await fetch(t.base + '/api/cron/tick?key=nope', { method: 'POST' })).status, 403);
  } finally { await t.close(); }
});

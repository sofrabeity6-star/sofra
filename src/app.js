'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { AppError } = require('./errors');
const { getSettings, saveSettings } = require('./db');
const A = require('./auth');
const { createHub } = require('./events');
const { createOrdersService } = require('./orders');
const { createPush } = require('./push');
const { makeUploader, storeUploaded } = require('./upload');
const { createStorage, sendImage } = require('./storage');
const V = require('./validation');
const { isRealDate, localParts } = require('./time');

function createApp({ db, clock = { now: () => new Date() }, dataDir = config.dataDir, limiter = true, fetchImpl, storage, cronSecret = config.cronSecret } = {}) {
  const hub = createHub();
  const push = createPush({ db, fetchImpl });
  const svc = createOrdersService({ db, clock, hub, push });
  const files = storage || createStorage({ dataDir });
  const receiptUpload = makeUploader(6);
  const menuUpload = makeUploader(4);
  const qrUpload = makeUploader(4);
  const customerAuth = A.makeAuth(db, A.CUSTOMER_COOKIE, ['customer']);
  const staffAuth = A.makeAuth(db, A.STAFF_COOKIE, ['staff', 'admin']);

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"], 'script-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'], 'connect-src': ["'self'"], 'object-src': ["'none'"],
        'base-uri': ["'self'"], 'form-action': ["'self'"], 'frame-ancestors': ["'none'"],
      },
    },
  }));
  // CORS: لازم فقط لنسخة الويب من تطبيق Expo عند تشغيلها من منفذ مختلف (التطوير). التطبيقات الأصلية لا تحتاجه.
  const corsList = (process.env.CORS_ORIGINS || (config.isProd ? '' : '*')).split(',').map((x) => x.trim()).filter(Boolean);
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (corsList.includes('*') || corsList.includes(origin))) {
      res.set({ 'Access-Control-Allow-Origin': corsList.includes('*') ? '*' : origin, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '100kb' }));

  // فحص صحة الخادم وقاعدة البيانات (يستخدمه Render)
  app.get('/healthz', async (_req, res) => {
    try { await db.one('SELECT 1 AS ok'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
  });

  const h = (fn) => (req, res, next) => { Promise.resolve().then(() => fn(req, res, next)).catch(next); };
  const api = express.Router();
  const adm = express.Router();
  const cust = express.Router();
  // مهمة دورية (التجهيز التلقائي) يستدعيها مجدول خارجي، لأن خادم Render المجاني ينام عند عدم الاستخدام
  api.get('/cron/tick', h(async (req, res) => {
    const key = String(req.query.key || req.headers['x-cron-secret'] || '');
    const ok = cronSecret && key.length === cronSecret.length && crypto.timingSafeEqual(Buffer.from(key), Buffer.from(cronSecret));
    if (!ok) throw new AppError(403, 'غير مصرح', 'forbidden');
    res.json({ ok: true, prepared: await svc.autoPrepare() });
  }));
  api.use(A.csrfGuard);
  adm.use(staffAuth.attach);
  cust.use(customerAuth.attach);
  const needCustomer = customerAuth.requireRole('customer');
  const needStaff = staffAuth.requireRole('staff', 'admin');
  const needAdmin = staffAuth.requireRole('admin');

  const loginLimiter = limiter ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'محاولات كثيرة. حاول بعد قليل.', code: 'rate_limited' } } }) : (_q, _s, n) => n();
  const registerLimiter = limiter ? rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: { message: 'محاولات تسجيل كثيرة. حاول لاحقاً.', code: 'rate_limited' } } }) : (_q, _s, n) => n();

  /* ============ عام ============ */
  api.get('/config', customerAuth.attach, h(async (req, res) => {
    const s = await getSettings(db);
    res.json({
      kitchen_name: s.kitchen_name, kitchen_phone: s.kitchen_phone, timezone: s.timezone,
      open_time: s.open_time, close_time: s.close_time, delivery_fee_cents: s.delivery_fee_cents,
      min_lead_minutes: s.min_lead_minutes, max_days_ahead: s.max_days_ahead,
      asap: await svc.asapStatus(), now: clock.now().toISOString(), today: localParts(clock.now(), s.timezone).date,
      slot_minutes: s.slot_minutes, cod_enabled: s.cod_enabled, transfer_enabled: s.transfer_enabled,
      accepting_orders: s.accepting_orders, closed_message: s.closed_message, announcement: s.announcement,
      payment_accounts: req.user ? s.payment_accounts.map((a) => ({ label: a.label, value: a.value, qr: a.qr || null })) : [],
    });
  }));

  api.get('/menu', h(async (_req, res) => {
    const categories = await db.all('SELECT id,name,sort_order FROM categories WHERE active=1 ORDER BY sort_order,id');
    const items = await db.all(`SELECT m.id,m.category_id,m.name,m.description,m.price_cents,m.emoji,m.image,m.available,m.popular,m.asap_ok
      FROM menu_items m JOIN categories c ON c.id=m.category_id WHERE m.archived=0 AND c.active=1 ORDER BY m.id`);
    res.json({ categories, items });
  }));

  /* ============ مصادقة العميل ============ */
  api.post('/auth/register', registerLimiter, h(async (req, res) => {
    const d = V.parse(V.registerSchema, req.body);
    const phone = A.normalizePhone(d.phone);
    if (!phone) throw new AppError(400, 'رقم الموبايل غير صحيح (مثال: 01012345678)', 'validation');
    if (await db.one('SELECT 1 FROM users WHERE phone=?', phone)) throw new AppError(409, 'هذا الرقم مسجل بالفعل. سجّل الدخول.', 'exists');
    const now = clock.now().toISOString();
    const uid = await db.tx(async () => {
      const id = (await db.run("INSERT INTO users(name,phone,password_hash,role,created_at) VALUES(?,?,?, 'customer', ?) RETURNING id", d.name, phone, A.hashPassword(d.password), now)).id;
      if (d.address) await db.run('INSERT INTO addresses(user_id,label,text,created_at) VALUES(?,?,?,?)', id, d.address.label || 'البيت', d.address.text, now);
      return id;
    });
    const user = { id: uid, name: d.name, phone, role: 'customer' };
    const token = A.signToken(user);
    A.setAuthCookie(res, token, A.CUSTOMER_COOKIE);
    res.status(201).json({ user: A.publicUser(user), token });
  }));

  api.post('/auth/login', loginLimiter, h(async (req, res) => {
    const d = V.parse(V.loginSchema, req.body);
    const phone = A.normalizePhone(d.phone);
    const u = phone && await db.one('SELECT * FROM users WHERE phone=?', phone);
    if (!u || !u.active || !A.verifyPassword(d.password, u.password_hash)) throw new AppError(401, 'رقم الموبايل أو كلمة المرور غير صحيحة', 'bad_login');
    if (u.role !== 'customer') throw new AppError(403, 'هذا الحساب خاص بالإدارة. استخدم لوحة الإدارة.', 'wrong_app');
    const token = A.signToken(u);
    A.setAuthCookie(res, token, A.CUSTOMER_COOKIE);
    res.json({ user: A.publicUser(u), token });
  }));
  api.post('/auth/logout', h((_req, res) => { A.clearAuthCookie(res, A.CUSTOMER_COOKIE); res.json({ ok: true }); }));

  /* ============ العميل ============ */
  cust.get('/auth/me', needCustomer, h((req, res) => res.json({ user: A.publicUser(req.user) })));

  cust.get('/addresses', needCustomer, h(async (req, res) => {
    res.json({ addresses: await db.all('SELECT id,label,text FROM addresses WHERE user_id=? ORDER BY id', req.user.id) });
  }));
  cust.post('/addresses', needCustomer, h(async (req, res) => {
    const d = V.parse(V.addressSchema, req.body);
    if ((await db.one('SELECT COUNT(*) c FROM addresses WHERE user_id=?', req.user.id)).c >= 10) throw new AppError(400, 'الحد الأقصى 10 عناوين', 'limit');
    const id = (await db.run('INSERT INTO addresses(user_id,label,text,created_at) VALUES(?,?,?,?) RETURNING id', req.user.id, d.label, d.text, clock.now().toISOString())).id;
    res.status(201).json({ address: { id, ...d } });
  }));
  cust.delete('/addresses/:id', needCustomer, h(async (req, res) => {
    const r = await db.run('DELETE FROM addresses WHERE id=? AND user_id=?', intParam(req.params.id), req.user.id);
    if (!r.changes) throw new AppError(404, 'العنوان غير موجود', 'not_found');
    res.json({ ok: true });
  }));

  // يحفظ الإيصال المرفوع ثم ينفّذ العملية، ويحذف الصورة إذا فشلت العملية
  async function receiptOrder(req, res, run) {
    let file = null;
    try {
      file = await storeUploaded(req, files, 'receipts');
      const out = await run(file, () => { const f = file; file = null; return files.remove('receipts', f); });
      res.status(out.status || 200).json({ order: out.order });
    } catch (e) {
      if (file) files.remove('receipts', file);
      throw e;
    }
  }

  cust.post('/orders', needCustomer, receiptUpload.single('receipt'), h(async (req, res) => {
    await receiptOrder(req, res, async (file, dropFile) => {
      let raw;
      try { raw = JSON.parse(req.body.payload || ''); } catch { throw new AppError(400, 'بيانات الطلب غير صحيحة', 'validation'); }
      const payload = V.parse(V.orderSchema, raw);
      if (payload.payment_method === 'cod' && file) { await dropFile(); file = null; }
      return { status: 201, order: await svc.createOrder({ user: req.user, payload, receiptFile: file }) };
    });
  }));
  cust.get('/orders', needCustomer, h(async (req, res) => res.json({ orders: await svc.listForUser(req.user.id) })));
  cust.get('/orders/:id', needCustomer, h(async (req, res) => res.json({ order: await svc.getForUser(req.user.id, intParam(req.params.id)) })));
  cust.post('/orders/:id/switch-to-prepaid', needCustomer, receiptUpload.single('receipt'), h(async (req, res) => {
    await receiptOrder(req, res, async (file) => ({ order: await svc.switchToPrepaid({ user: req.user, orderId: intParam(req.params.id), file, reference: (req.body.reference || '').slice(0, 60) }) }));
  }));
  cust.post('/orders/:id/receipt', needCustomer, receiptUpload.single('receipt'), h(async (req, res) => {
    await receiptOrder(req, res, async (file) => ({ order: await svc.reuploadReceipt({ user: req.user, orderId: intParam(req.params.id), file, reference: (req.body.reference || '').slice(0, 60) }) }));
  }));
  cust.post('/orders/:id/cancel', needCustomer, h(async (req, res) => res.json({ order: await svc.cancelByCustomer({ user: req.user, orderId: intParam(req.params.id) }) })));
  cust.post('/orders/:id/deliveries/:did/cancel', needCustomer, h(async (req, res) => {
    res.json({ order: await svc.cancelDeliveryByCustomer({ user: req.user, orderId: intParam(req.params.id), deliveryId: intParam(req.params.did) }) });
  }));

  cust.get('/receipts/:id/file', needCustomer, h(async (req, res) => {
    const r = await db.one('SELECT r.file FROM receipts r JOIN orders o ON o.id=r.order_id WHERE r.id=? AND o.user_id=?', intParam(req.params.id), req.user.id);
    if (!r) throw new AppError(404, 'غير موجود', 'not_found');
    await sendImage(res, files, 'receipts', r.file, 'private, max-age=3600');
  }));

  cust.get('/notifications', needCustomer, h(async (req, res) => {
    res.json({
      notifications: await db.all('SELECT id,order_id,message,read,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', req.user.id),
      unread: (await db.one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', req.user.id)).c,
    });
  }));
  cust.post('/notifications/read', needCustomer, h(async (req, res) => {
    await db.run('UPDATE notifications SET read=1 WHERE user_id=? AND read=0', req.user.id);
    res.json({ ok: true });
  }));
  // تسجيل جهاز العميل لتلقي إشعارات الهاتف (Expo Push Token)
  const pushSchema = V.z.object({ token: V.z.string().max(200), platform: V.z.enum(['ios', 'android', 'web']).optional() });
  cust.post('/push-token', needCustomer, h(async (req, res) => {
    const d = V.parse(pushSchema, req.body);
    if (!push.isValid(d.token)) throw new AppError(400, 'رمز الإشعارات غير صحيح', 'validation');
    await push.register(req.user.id, d.token, d.platform);
    res.json({ ok: true });
  }));
  cust.post('/push-token/remove', needCustomer, h(async (req, res) => {
    const d = V.parse(pushSchema, req.body);
    await push.unregister(req.user.id, d.token);
    res.json({ ok: true });
  }));
  cust.get('/events', needCustomer, (req, res) => hub.add(req, res, req.user));

  /* ============ الإدارة: مصادقة ============ */
  adm.post('/auth/login', loginLimiter, h(async (req, res) => {
    const d = V.parse(V.loginSchema, req.body);
    const phone = A.normalizePhone(d.phone);
    const u = phone && await db.one('SELECT * FROM users WHERE phone=?', phone);
    if (!u || !u.active || !A.verifyPassword(d.password, u.password_hash) || u.role === 'customer') {
      throw new AppError(401, 'بيانات الدخول غير صحيحة', 'bad_login');
    }
    const token = A.signToken(u);
    A.setAuthCookie(res, token, A.STAFF_COOKIE);
    res.json({ user: A.publicUser(u), token });
  }));
  adm.post('/auth/logout', h((_req, res) => { A.clearAuthCookie(res, A.STAFF_COOKIE); res.json({ ok: true }); }));
  adm.get('/auth/me', needStaff, h((req, res) => res.json({ user: A.publicUser(req.user) })));
  // تسجيل جهاز الموظف/المدير لإشعارات الطلبات الجديدة والإيصالات
  adm.post('/push-token', needStaff, h(async (req, res) => {
    const d = V.parse(pushSchema, req.body);
    if (!push.isValid(d.token)) throw new AppError(400, 'رمز الإشعارات غير صحيح', 'validation');
    await push.register(req.user.id, d.token, d.platform);
    res.json({ ok: true });
  }));
  adm.post('/push-token/remove', needStaff, h(async (req, res) => {
    await push.unregister(req.user.id, V.parse(pushSchema, req.body).token);
    res.json({ ok: true });
  }));
  adm.get('/events', needStaff, (req, res) => hub.add(req, res, req.user));

  /* ============ الإدارة: الطلبات ============ */
  adm.get('/orders', needStaff, h(async (req, res) => {
    const q = req.query;
    res.json(await svc.adminList({
      scope: String(q.scope || 'open'), q: String(q.q || ''), sort: String(q.sort || 'delivery'), dir: String(q.dir || 'asc'),
      page: q.page, limit: q.limit, payment: String(q.payment || ''), stage: String(q.stage || ''),
    }));
  }));
  adm.get('/orders/:id', needStaff, h(async (req, res) => res.json({ order: await svc.getForAdmin(intParam(req.params.id)) })));
  adm.post('/orders/:id/call', needStaff, h(async (req, res) => {
    const d = V.parse(V.z.object({ outcome: V.z.enum(['confirmed', 'no_answer', 'cancelled']), note: V.z.string().max(500).optional() }), req.body);
    res.json({ order: await svc.recordCall({ orderId: intParam(req.params.id), staff: req.user, outcome: d.outcome, note: d.note }) });
  }));
  adm.post('/orders/:id/receipt/review', needStaff, h(async (req, res) => {
    const d = V.parse(V.z.object({ approve: V.z.boolean(), reason: V.z.string().max(300).optional() }), req.body);
    res.json({ order: await svc.reviewReceipt({ orderId: intParam(req.params.id), staff: req.user, approve: d.approve, reason: d.reason }) });
  }));
  adm.post('/orders/:id/cancel', needStaff, h(async (req, res) => {
    const d = V.parse(V.z.object({ reason: V.z.string().max(300) }), req.body);
    res.json({ order: await svc.cancelByStaff({ orderId: intParam(req.params.id), staff: req.user, reason: d.reason }) });
  }));
  adm.post('/orders/:id/refund', needStaff, h(async (req, res) => res.json({ order: await svc.markRefunded({ orderId: intParam(req.params.id), staff: req.user }) })));
  adm.post('/deliveries/:id/advance', needStaff, h(async (req, res) => {
    const d = V.parse(V.z.object({ cash_confirmed: V.z.boolean().optional() }), req.body || {});
    res.json({ order: await svc.advanceDelivery({ deliveryId: intParam(req.params.id), staff: req.user, cashConfirmed: !!d.cash_confirmed }) });
  }));
  adm.post('/prepare-today', needStaff, h(async (req, res) => res.json({ prepared: await svc.prepareToday(req.user) })));
  adm.get('/receipts/pending', needStaff, h(async (_req, res) => res.json({ orders: await svc.pendingReceipts() })));
  adm.get('/receipts/:id/file', needStaff, h(async (req, res) => {
    const r = await db.one('SELECT file FROM receipts WHERE id=?', intParam(req.params.id));
    if (!r) throw new AppError(404, 'غير موجود', 'not_found');
    await sendImage(res, files, 'receipts', r.file, 'private, max-age=3600');
  }));
  adm.get('/kitchen', needStaff, h(async (req, res) => {
    const s = await getSettings(db);
    const date = req.query.date && isRealDate(String(req.query.date)) ? String(req.query.date) : localParts(clock.now(), s.timezone).date;
    res.json(await svc.kitchen(date));
  }));
  adm.get('/stats', needStaff, h(async (_req, res) => res.json(await svc.stats())));

  /* ============ الإدارة: المنيو (مدير فقط) ============ */
  adm.get('/menu', needStaff, h(async (_req, res) => {
    res.json({
      categories: await db.all('SELECT id,name,sort_order,active FROM categories ORDER BY sort_order,id'),
      items: await db.all('SELECT * FROM menu_items WHERE archived=0 ORDER BY category_id,id'),
    });
  }));
  const isUnique = (e) => e && (e.code === '23505' || /UNIQUE/.test(e.message));
  const catSchema = V.z.object({ name: V.z.string().trim().min(1, 'اكتب اسم التصنيف').max(40), sort_order: V.z.number().int().min(0).max(1000).optional() });
  adm.post('/categories', needAdmin, h(async (req, res) => {
    const d = V.parse(catSchema, req.body);
    try {
      const id = (await db.run('INSERT INTO categories(name,sort_order) VALUES(?,?) RETURNING id', d.name, d.sort_order || 0)).id;
      res.status(201).json({ category: { id, name: d.name, sort_order: d.sort_order || 0, active: 1 } });
    } catch (e) { if (isUnique(e)) throw new AppError(409, 'التصنيف موجود بالفعل', 'exists'); throw e; }
  }));
  adm.patch('/categories/:id', needAdmin, h(async (req, res) => {
    const d = V.parse(catSchema.partial().extend({ active: V.z.boolean().optional() }), req.body);
    const c = await db.one('SELECT * FROM categories WHERE id=?', intParam(req.params.id));
    if (!c) throw new AppError(404, 'التصنيف غير موجود', 'not_found');
    try {
      await db.run('UPDATE categories SET name=?, sort_order=?, active=? WHERE id=?',
        d.name ?? c.name, d.sort_order ?? c.sort_order, d.active === undefined ? c.active : (d.active ? 1 : 0), c.id);
    } catch (e) { if (isUnique(e)) throw new AppError(409, 'التصنيف موجود بالفعل', 'exists'); throw e; }
    res.json({ category: await db.one('SELECT * FROM categories WHERE id=?', c.id) });
  }));
  adm.delete('/categories/:id', needAdmin, h(async (req, res) => {
    const id = intParam(req.params.id);
    if (await db.one('SELECT 1 FROM menu_items WHERE category_id=? AND archived=0', id)) throw new AppError(409, 'لا يمكن حذف تصنيف يحتوي وجبات. انقلها أو عطّل التصنيف.', 'not_empty');
    if (await db.one('SELECT 1 FROM menu_items WHERE category_id=?', id)) {
      // وجبات مؤرشفة مرتبطة بطلبات قديمة: نعطّل التصنيف بدلاً من حذفه
      await db.run('UPDATE categories SET active=0 WHERE id=?', id);
    } else {
      await db.run('DELETE FROM categories WHERE id=?', id);
    }
    res.json({ ok: true });
  }));

  async function menuMutation(req, existing) {
    let file = null;
    try {
      const d = V.parse(V.menuSchema, existing ? { ...existing, ...req.body } : req.body);
      if (!(await db.one('SELECT 1 FROM categories WHERE id=?', d.category_id))) throw new AppError(400, 'التصنيف غير موجود', 'validation');
      file = await storeUploaded(req, files, 'menu');
      const flags = {
        available: d.available === undefined ? (existing ? existing.available : 1) : (d.available ? 1 : 0),
        popular: d.popular === undefined ? (existing ? existing.popular : 0) : (d.popular ? 1 : 0),
        asap_ok: d.asap_ok === undefined ? (existing ? existing.asap_ok : 1) : (d.asap_ok ? 1 : 0),
      };
      if (existing) {
        await db.run('UPDATE menu_items SET category_id=?,name=?,description=?,price_cents=?,emoji=?,image=?,available=?,popular=?,asap_ok=? WHERE id=?',
          d.category_id, d.name, d.description, d.price_cents, d.emoji || '🍽️', file || existing.image, flags.available, flags.popular, flags.asap_ok, existing.id);
        if (file && existing.image) files.remove('menu', existing.image);
        return db.one('SELECT * FROM menu_items WHERE id=?', existing.id);
      }
      const id = (await db.run('INSERT INTO menu_items(category_id,name,description,price_cents,emoji,image,available,popular,asap_ok,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id',
        d.category_id, d.name, d.description, d.price_cents, d.emoji || '🍽️', file, flags.available, flags.popular, flags.asap_ok, clock.now().toISOString())).id;
      return db.one('SELECT * FROM menu_items WHERE id=?', id);
    } catch (e) { if (file) files.remove('menu', file); throw e; }
  }
  adm.post('/menu', needAdmin, menuUpload.single('image'), h(async (req, res) => res.status(201).json({ item: await menuMutation(req, null) })));
  adm.patch('/menu/:id', needAdmin, menuUpload.single('image'), h(async (req, res) => {
    const ex = await db.one('SELECT * FROM menu_items WHERE id=? AND archived=0', intParam(req.params.id));
    if (!ex) throw new AppError(404, 'الوجبة غير موجودة', 'not_found');
    res.json({ item: await menuMutation(req, ex) });
  }));
  // تشغيل/إيقاف سريع (متاحة اليوم / نفدت الكمية) - متاح أيضاً لموظف المطبخ
  adm.post('/menu/:id/availability', needStaff, h(async (req, res) => {
    const d = V.parse(V.z.object({ available: V.z.boolean() }), req.body);
    const r = await db.run('UPDATE menu_items SET available=? WHERE id=? AND archived=0', d.available ? 1 : 0, intParam(req.params.id));
    if (!r.changes) throw new AppError(404, 'الوجبة غير موجودة', 'not_found');
    res.json({ ok: true });
  }));
  adm.delete('/menu/:id', needAdmin, h(async (req, res) => {
    const r = await db.run('UPDATE menu_items SET archived=1, available=0 WHERE id=?', intParam(req.params.id));
    if (!r.changes) throw new AppError(404, 'الوجبة غير موجودة', 'not_found');
    res.json({ ok: true });
  }));

  /* ============ الإدارة: الإعدادات والفريق (مدير فقط) ============ */
  adm.get('/settings', needAdmin, h(async (_req, res) => res.json({ settings: await getSettings(db) })));
  // رفع صورة QR لحساب تحويل (تُحفظ علناً لأن العميل يمسحها للتحويل)
  adm.post('/payment-qr', needAdmin, qrUpload.single('image'), h(async (req, res) => {
    const file = await storeUploaded(req, files, 'qr');
    if (!file) throw new AppError(400, 'اختر صورة كود QR', 'validation');
    res.status(201).json({ file });
  }));
  adm.put('/settings', needAdmin, h(async (req, res) => {
    const d = V.parse(V.settingsSchema, req.body);
    const cur = await getSettings(db);
    const merged = { ...cur, ...d };
    if (timeToMin(merged.open_time) >= timeToMin(merged.close_time)) throw new AppError(400, 'ساعة الإغلاق يجب أن تكون بعد ساعة الفتح', 'validation');
    if (!merged.cod_enabled && !merged.transfer_enabled) throw new AppError(400, 'فعّل طريقة دفع واحدة على الأقل', 'validation');
    if (d.payment_accounts) {
      for (const a of d.payment_accounts) {
        if (a.qr && !(await files.exists('qr', a.qr))) throw new AppError(400, 'صورة الـ QR غير موجودة، أعد رفعها', 'validation');
      }
    }
    const saved = await saveSettings(db, d);
    if (d.payment_accounts) {
      // حذف صور QR التي لم تعد مستخدمة
      const used = new Set(saved.payment_accounts.map((a) => a.qr).filter(Boolean));
      for (const a of cur.payment_accounts) if (a.qr && !used.has(a.qr)) files.remove('qr', a.qr);
    }
    res.json({ settings: saved });
  }));
  function timeToMin(t) { const [a, b] = t.split(':').map(Number); return a * 60 + b; }

  adm.get('/users', needAdmin, h(async (req, res) => {
    const role = req.query.role === 'customer' ? 'customer' : null;
    const rows = role
      ? await db.all("SELECT id,name,phone,role,active,created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=users.id) AS orders_count FROM users WHERE role='customer' ORDER BY id DESC LIMIT 200")
      : await db.all("SELECT id,name,phone,role,active,created_at FROM users WHERE role<>'customer' ORDER BY id");
    res.json({ users: rows });
  }));
  adm.post('/users', needAdmin, h(async (req, res) => {
    const d = V.parse(V.userCreateSchema, req.body);
    const phone = A.normalizePhone(d.phone);
    if (!phone) throw new AppError(400, 'رقم الموبايل غير صحيح', 'validation');
    if (await db.one('SELECT 1 FROM users WHERE phone=?', phone)) throw new AppError(409, 'الرقم مسجل بالفعل', 'exists');
    const id = (await db.run('INSERT INTO users(name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?) RETURNING id', d.name, phone, A.hashPassword(d.password), d.role, clock.now().toISOString())).id;
    res.status(201).json({ user: { id, name: d.name, phone, role: d.role, active: 1 } });
  }));
  adm.patch('/users/:id', needAdmin, h(async (req, res) => {
    const d = V.parse(V.userPatchSchema, req.body);
    const u = await db.one("SELECT * FROM users WHERE id=? AND role<>'customer'", intParam(req.params.id));
    if (!u) throw new AppError(404, 'المستخدم غير موجود', 'not_found');
    if (u.id === req.user.id && (d.active === false || (d.role && d.role !== 'admin'))) throw new AppError(400, 'لا يمكنك تعطيل حسابك أو خفض صلاحيتك', 'self');
    await db.run('UPDATE users SET name=?, role=?, active=?, password_hash=? WHERE id=?',
      d.name ?? u.name, d.role ?? u.role, d.active === undefined ? u.active : (d.active ? 1 : 0), d.password ? A.hashPassword(d.password) : u.password_hash, u.id);
    res.json({ ok: true });
  }));

  /* ============ تجميع ============ */
  api.use('/admin', adm);
  api.use(cust);
  api.use((_req, _res, next) => next(new AppError(404, 'المسار غير موجود', 'not_found')));
  app.use('/api', api);

  // صور المنيو وأكواد QR (عامة، أسماؤها عشوائية فلا تتغير: تخزين مؤقت طويل)
  app.get('/media/:kind/:file', h(async (req, res, next) => {
    if (!['menu', 'qr'].includes(req.params.kind)) return next();
    await sendImage(res, files, req.params.kind, req.params.file, 'public, max-age=31536000, immutable');
  }));

  // نسخة الويب من تطبيق Expo (نفس كود الموبايل): npm run build ثم تُقدَّم على /web
  const webDist = path.join(__dirname, '..', 'mobile', 'dist');
  const hasWeb = () => fs.existsSync(path.join(webDist, 'index.html'));
  app.use('/web', express.static(webDist, { index: false, setHeaders: (res, p) => res.set('Cache-Control', p.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable') }));
  app.get(/^\/web(\/.*)?$/, (_req, res, next) => (hasWeb() ? res.set('Cache-Control', 'no-cache').sendFile(path.join(webDist, 'index.html')) : next()));
  app.get('/', (_req, res) => {
    if (hasWeb()) return res.redirect('/web/');
    res.status(200).type('html').send('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>سفرة</title><body style="font-family:system-ui;padding:40px;line-height:1.8"><h2>الخادم يعمل ✅</h2><p>نسخة الويب من التطبيق لم تُبنَ بعد. نفّذ في المجلد الرئيسي:</p><pre dir="ltr">npm run build</pre><p>ثم حدّث الصفحة.</p></body></html>');
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: { message: err.message, code: err.code } });
    if (err && err.name === 'MulterError') {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'حجم الصورة كبير جداً' : 'تعذر رفع الملف';
      return res.status(400).json({ error: { message: msg, code: 'upload' } });
    }
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { message: 'بيانات غير صحيحة', code: 'bad_json' } });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: { message: 'الطلب كبير جداً', code: 'too_large' } });
    console.error('[error]', req.method, req.url, err);
    res.status(500).json({ error: { message: 'حدث خطأ غير متوقع', code: 'internal' } });
  });

  return { app, svc, hub, push, storage: files };
}

// معرّفات المسارات: رقم صحيح موجب، وإلا «غير موجود» (بدلاً من خطأ قاعدة بيانات)
function intParam(v) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) throw new AppError(404, 'غير موجود', 'not_found');
  return n;
}

module.exports = { createApp };

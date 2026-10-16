'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Client: PgClient } = require('pg');
const { openDb } = require('../src/db');
const { createStorage } = require('../src/storage');

// الاختبارات تحتاج Postgres (محلي أو Docker). كل اختبار يعمل في مخطط (schema) مؤقت منفصل يُحذف بعده.
const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/sofra_test';
async function adminSql(sql) {
  const c = new PgClient({ connectionString: TEST_DB, ssl: /localhost|127\.0\.0\.1/.test(TEST_DB) ? false : { rejectUnauthorized: false } });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/auth');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

class Client {
  constructor(base) { this.base = base; this.cookies = {}; }
  async req(method, url, { json, form } = {}) {
    const headers = { 'X-Requested-With': 'sofra' };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    let body;
    if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    if (form) body = form;
    const res = await fetch(this.base + url, { method, headers, body });
    for (const sc of res.headers.getSetCookie()) {
      const [kv] = sc.split(';');
      const i = kv.indexOf('=');
      const k = kv.slice(0, i);
      const v = kv.slice(i + 1);
      if (/Max-Age=0/.test(sc)) delete this.cookies[k]; else this.cookies[k] = v;
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, json) { return this.req('POST', u, { json: json === undefined ? {} : json }); }
  put(u, json) { return this.req('PUT', u, { json }); }
  patch(u, json) { return this.req('PATCH', u, { json }); }
  del(u) { return this.req('DELETE', u); }
}

function orderForm(payload, withReceipt) {
  const f = new FormData();
  f.set('payload', JSON.stringify(payload));
  if (withReceipt) f.set('receipt', new Blob([PNG], { type: 'image/png' }), 'r.png');
  return f;
}
function receiptForm(ref = '123') {
  const f = new FormData();
  f.set('reference', ref);
  f.set('receipt', new Blob([PNG], { type: 'image/png' }), 'r.png');
  return f;
}

// 2026-10-03 09:00Z = 12:00 بتوقيت القاهرة (UTC+3 صيفاً)
async function boot({ fetchImpl } = {}) {
  const schema = `t_${crypto.randomBytes(6).toString('hex')}`;
  await adminSql(`CREATE SCHEMA ${schema}`);
  const db = await openDb({ url: TEST_DB, schema, max: 4 });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sofra-'));
  const clock = { t: new Date('2026-10-03T09:00:00Z'), now() { return new Date(this.t); }, advance(min) { this.t = new Date(this.t.getTime() + min * 60000); } };
  const { app, svc, hub, push } = createApp({ db, dataDir, clock, limiter: false, fetchImpl, cronSecret: 'test-cron-secret', storage: createStorage({ dataDir, env: {} }) });
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const now = clock.now().toISOString();
  const cat = (await db.run("INSERT INTO categories(name,sort_order) VALUES('طواجن',1) RETURNING id")).id;
  const mk = async (name, price, asap) => (await db.run('INSERT INTO menu_items(category_id,name,price_cents,asap_ok,created_at) VALUES(?,?,?,?,?) RETURNING id', cat, name, price * 100, asap, now)).id;
  const items = { bamya: await mk('بامية', 145, 0), kofta: await mk('كفتة', 130, 1), salad: await mk('سلطة', 85, 1) };
  const mkStaff = (name, phone, role) => db.run('INSERT INTO users(name,phone,password_hash,role,created_at) VALUES(?,?,?,?,?)', name, phone, hashPassword('password123'), role, now);
  await mkStaff('المدير', '01000000000', 'admin');
  await mkStaff('موظف', '01000000001', 'staff');
  const admin = new Client(base);
  const login = await admin.post('/api/admin/auth/login', { phone: '01000000000', password: 'password123' });
  if (login.status !== 200) throw new Error('admin login failed');
  const staff = new Client(base);
  await staff.post('/api/admin/auth/login', { phone: '01000000001', password: 'password123' });
  async function customer(name = 'منى', phone = '01012345678') {
    const c = new Client(base);
    const r = await c.post('/api/auth/register', { name, phone, password: 'password123', address: { label: 'البيت', text: '١٠ شارع الجمهورية، المنصورة' } });
    if (r.status !== 201) throw new Error('register failed ' + JSON.stringify(r.data));
    const addr = (await c.get('/api/addresses')).data.addresses[0].id;
    c.addr = addr;
    return c;
  }
  const close = async () => {
    hub.close();
    await new Promise((r) => server.close(r));
    await push.flush();
    await db.close();
    await adminSql(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  };
  return { db, clock, svc, hub, push, base, items, admin, staff, customer, close };
}

const dl = (items, date, time) => ({ date, time, items });
const place = (c, deliveries, pay = 'cod', extra = {}) =>
  c.req('POST', '/api/orders', { form: orderForm({ address_id: c.addr, payment_method: pay, deliveries, ...extra }, pay === 'transfer') });

module.exports = { boot, Client, orderForm, receiptForm, dl, place, PNG };

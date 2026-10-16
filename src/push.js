'use strict';
// إرسال إشعارات الهاتف (Push) عبر خدمة Expo Push، وهي تتولى الإرسال لـ FCM (أندرويد) وAPNs (آيفون).
const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]\s]+\]$/;

function createPush({ db, fetchImpl, log = console, accessToken = process.env.EXPO_ACCESS_TOKEN }) {
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const pending = new Set();
  // الإرسال يعمل في الخلفية، خارج أي معاملة قاعدة بيانات جارية
  const run = (fn) => (db.detached ? db.detached(fn) : fn()).catch((e) => log.warn('[push]', e.message));
  const isValid = (t) => TOKEN_RE.test(String(t || ''));

  async function register(userId, token, platform) {
    (await db.run(`INSERT INTO push_tokens(user_id,token,platform,created_at) VALUES(?,?,?,?)
      ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id, platform=excluded.platform`, userId, token, platform || 'unknown', new Date().toISOString()));
  }
  async function unregister(userId, token) {
    (await db.run('DELETE FROM push_tokens WHERE token=? AND user_id=?', token, userId));
  }

  async function deliver(userId, { title, body, data }) {
    let rows;
    try { rows = await db.all('SELECT token FROM push_tokens WHERE user_id=?', userId); } catch (e) { log.warn('[push]', e.message); return; }
    if (!rows.length) return;
    const messages = rows.map((r) => ({ to: r.token, title, body, data: data || {}, sound: 'default', channelId: 'default', priority: 'high' }));
    try {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const res = await doFetch(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(8000) });
      const json = await res.json();
      const tickets = json.data || [];
      for (let i = 0; i < tickets.length; i++) {
        const t = tickets[i];
        if (t.status !== 'error') continue;
        // الجهاز ألغى التثبيت أو الإذن: نحذف التوكن حتى لا نكرر المحاولة
        if (t.details && t.details.error === 'DeviceNotRegistered') await db.run('DELETE FROM push_tokens WHERE token=?', messages[i].to);
        else log.warn('[push] خطأ من Expo:', t.message || t.details);
      }
    } catch (e) {
      log.warn('[push] تعذر الإرسال (لا اتصال بالإنترنت؟):', e.message);
    }
  }

  async function deliverToStaff(payload) {
    const rows = (await db.all("SELECT DISTINCT t.user_id FROM push_tokens t JOIN users u ON u.id=t.user_id WHERE u.role IN ('admin','staff') AND u.active=1"));
    for (const r of rows) await deliver(r.user_id, payload);
  }
  function sendToStaff(payload) {
    const p = run(() => deliverToStaff(payload)).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }

  // لا ننتظر الإرسال: فشل الإشعار لا يجب أن يعطّل أي عملية في الطلب
  function send(userId, payload) {
    const p = run(() => deliver(userId, payload)).finally(() => pending.delete(p));
    pending.add(p);
    return p;
  }
  const flush = () => Promise.all([...pending]);
  return { isValid, register, unregister, send, sendToStaff, flush };
}

module.exports = { createPush };

'use strict';
// تخزين الصور (الإيصالات، صور المنيو، أكواد QR).
// - في الإنتاج: Supabase Storage (يبقى بعد إعادة تشغيل Render، لأن قرص Render المجاني يُمسح).
// - محلياً وفي الاختبارات: مجلد على القرص.
const fs = require('fs');
const path = require('path');

// النوع ← اسم الـ bucket وهل هو عام
const KINDS = {
  menu: { bucket: 'menu', public: true },
  qr: { bucket: 'qr', public: true },
  receipts: { bucket: 'receipts', public: false }, // خاصة: لصاحب الطلب والإدارة فقط عبر الخادم
};
const SAFE_NAME = /^[a-f0-9]{32}\.(jpg|png|webp)$/;
const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function checkName(name) {
  if (!SAFE_NAME.test(String(name || ''))) throw Object.assign(new Error('اسم ملف غير صالح'), { status: 404 });
}

function localStorage(dataDir) {
  const dirOf = (kind) => path.join(dataDir, 'uploads', kind);
  for (const k of Object.keys(KINDS)) fs.mkdirSync(dirOf(k), { recursive: true });
  return {
    driver: 'local',
    async init() {},
    async put(kind, name, buffer) { checkName(name); await fs.promises.writeFile(path.join(dirOf(kind), name), buffer); },
    async get(kind, name) {
      checkName(name);
      try { return await fs.promises.readFile(path.join(dirOf(kind), name)); } catch { return null; }
    },
    async exists(kind, name) { try { checkName(name); return fs.existsSync(path.join(dirOf(kind), name)); } catch { return false; } },
    async remove(kind, name) { if (!name) return; try { checkName(name); await fs.promises.unlink(path.join(dirOf(kind), name)); } catch { /* غير موجود */ } },
  };
}

function supabaseStorage({ url, key, prefix = '', fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const base = `${url.replace(/\/+$/, '')}/storage/v1`;
  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  const bucket = (kind) => `${prefix}${KINDS[kind].bucket}`;
  const objUrl = (kind, name) => `${base}/object/${bucket(kind)}/${name}`;

  async function ensureBucket(kind) {
    const res = await fetchImpl(`${base}/bucket`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bucket(kind), name: bucket(kind), public: KINDS[kind].public, file_size_limit: 8 * 1024 * 1024, allowed_mime_types: Object.values(TYPES) }),
    });
    if (res.ok) return;
    const text = await res.text();
    if (/already exists|Duplicate|409/i.test(text) || res.status === 409) return;
    throw new Error(`تعذر إنشاء مساحة التخزين ${bucket(kind)}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }

  return {
    driver: 'supabase',
    async init() { for (const k of Object.keys(KINDS)) await ensureBucket(k); },
    async put(kind, name, buffer) {
      checkName(name);
      const res = await fetchImpl(objUrl(kind, name), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': TYPES[path.extname(name)], 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' },
        body: buffer,
      });
      if (!res.ok) throw new Error(`فشل رفع الصورة إلى Supabase: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    },
    async get(kind, name) {
      checkName(name);
      const res = await fetchImpl(objUrl(kind, name), { headers: auth });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`فشل تحميل الصورة من Supabase: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async exists(kind, name) {
      try { checkName(name); } catch { return false; }
      const res = await fetchImpl(`${base}/object/info/${bucket(kind)}/${name}`, { headers: auth });
      return res.ok;
    },
    async remove(kind, name) {
      if (!name) return;
      try {
        checkName(name);
        await fetchImpl(`${base}/object/${bucket(kind)}`, { method: 'DELETE', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [name] }) });
      } catch (e) { console.warn('[storage] تعذر حذف', name, e.message); }
    },
  };
}

function createStorage({ dataDir, env = process.env, fetchImpl } = {}) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.STORAGE_DRIVER !== 'local') {
    return supabaseStorage({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, prefix: env.SUPABASE_BUCKET_PREFIX || 'sofra-', fetchImpl });
  }
  return localStorage(dataDir);
}

// إرسال صورة للعميل مع ترويسات التخزين المؤقت
async function sendImage(res, storage, kind, name, cacheControl) {
  let buf = null;
  try { buf = await storage.get(kind, name); } catch (e) { console.error('[storage]', e.message); }
  if (!buf) return res.status(404).json({ error: { message: 'الصورة غير موجودة', code: 'not_found' } });
  res.set({ 'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff' });
  return res.end(buf);
}

module.exports = { createStorage, sendImage, KINDS, SAFE_NAME };

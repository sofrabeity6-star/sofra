'use strict';
const config = require('./config');
const { hashPassword, normalizePhone } = require('./auth');

// ينشئ حساب المدير الأول عند أول تشغيل من متغيرات البيئة
async function ensureAdmin(db, log = console.log) {
  if ((await db.one("SELECT 1 FROM users WHERE role='admin' LIMIT 1"))) return;
  let phone = normalizePhone(config.adminPhone);
  let password = config.adminPassword;
  if (!phone || !password) {
    // الحساب التجريبي مسموح فقط على قاعدة بيانات محلية، حتى لا يُنشأ مدير بكلمة مرور معروفة على Supabase
    const localDb = /@(localhost|127\.0\.0\.1)[:/]/.test(config.databaseUrl || '');
    if (config.isProd || !localDb) throw new Error('عيّن ADMIN_PHONE و ADMIN_PASSWORD (في .env أو إعدادات Render) لإنشاء حساب المدير الأول');
    phone = '01000000000';
    password = 'admin12345';
    log('[تنبيه] تم إنشاء مدير تجريبي 01000000000 / admin12345 (للتطوير فقط)');
  }
  if (password.length < 8) throw new Error('ADMIN_PASSWORD يجب ألا تقل عن 8 أحرف');
  (await db.run("INSERT INTO users(name,phone,password_hash,role,created_at) VALUES(?,?,?,'admin',?)", config.adminName, phone, hashPassword(password), new Date().toISOString()));
  log(`تم إنشاء حساب المدير: ${phone}`);
}
module.exports = { ensureAdmin };

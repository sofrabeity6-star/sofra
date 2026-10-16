'use strict';
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
if (isProd && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET مطلوب في وضع الإنتاج (32 حرفاً على الأقل)');
}

module.exports = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  // مجلد محلي للصور عند عدم ضبط Supabase Storage (التطوير والاختبارات فقط)
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me-dev-only-secret',
  adminPhone: process.env.ADMIN_PHONE || '',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminName: process.env.ADMIN_NAME || 'مدير المطبخ',
  trustProxy: process.env.TRUST_PROXY === '1',
  databaseUrl: process.env.DATABASE_URL || '',
  cronSecret: process.env.CRON_SECRET || '',
};

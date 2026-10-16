'use strict';
const config = require('./config');
const { openDb } = require('./db');
const { ensureAdmin } = require('./bootstrap');
const { createApp } = require('./app');
const { createStorage } = require('./storage');

async function main() {
  const db = await openDb({ url: config.databaseUrl });
  await ensureAdmin(db);
  const storage = createStorage({ dataDir: config.dataDir });
  await storage.init();
  console.log(`[تخزين الصور] ${storage.driver === 'supabase' ? 'Supabase Storage' : 'مجلد محلي (للتطوير فقط)'}`);
  const { app, svc, hub } = createApp({ db, storage });

  // كل دقيقة: تحويل المواعيد القريبة إلى «قيد التجهيز» حسب إعداد التجهيز التلقائي
  const runAuto = () => svc.autoPrepare().catch((e) => console.error('[autoPrepare]', e.message));
  runAuto();
  const tick = setInterval(runAuto, 60 * 1000);

  const server = app.listen(config.port, () => {
    console.log(`سفرة تعمل على http://localhost:${config.port}  (التطبيق: /web  |  API: /api)`);
  });

  function shutdown() {
    clearInterval(tick);
    hub.close();
    server.close(() => { db.close().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(1), 5000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => {
  console.error('تعذر تشغيل الخادم:', e.message);
  process.exit(1);
});

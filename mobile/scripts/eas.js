// تشغيل EAS (خدمة Expo لبناء تطبيقات أندرويد وآيفون) من المجلد الرئيسي، على ويندوز وماك ولينكس.
//   node mobile/scripts/eas.js <أي أمر eas>     ← يمرّر الأمر كما هو
//   node mobile/scripts/eas.js apk              ← يبني APK وينزّله في المجلد الرئيسي باسم sofra-<الإصدار>.apk
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const hasGit = (dir) => { for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, '.git'))) return true; return false; };
const env = { ...process.env };
// المجلد المحلي قد لا يكون مستودع git، فنطلب من EAS رفع الملفات بدون git في هذه الحالة
if (!hasGit(root)) { env.EAS_NO_VCS = '1'; env.EAS_PROJECT_ROOT = root; }
const eas = (args, opts = {}) => spawnSync('npx', ['--yes', 'eas-cli@latest', ...args], { cwd: root, shell: true, env, ...opts });

async function buildApk() {
  console.log('⏳ جاري بناء APK على سيرفرات Expo (من 10 إلى 20 دقيقة)... لا تغلق النافذة.');
  const r = eas(['build', '--platform', 'android', '--profile', 'preview', '--non-interactive', '--wait', '--json'], { stdio: ['inherit', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 });
  const out = String(r.stdout || '');
  let build;
  try { build = JSON.parse(out.slice(out.indexOf('['))).at(-1); } catch { /* المخرجات ليست JSON */ }
  const url = build && build.artifacts && (build.artifacts.buildUrl || build.artifacts.applicationArchiveUrl);
  if (r.status !== 0 || !url) {
    console.error(out);
    console.error('❌ لم يكتمل البناء. راجع الرسائل أعلاه أو صفحة البناء على expo.dev.');
    process.exit(1);
  }
  const version = (build.appVersion || '1.0.0') + (build.appBuildVersion ? `-${build.appBuildVersion}` : '');
  const file = path.join(root, '..', `sofra-${version}.apk`);
  console.log('⬇️  تنزيل الملف...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`تعذر التنزيل: HTTP ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`✅ تم: ${file}`);
  console.log(`   رابط التنزيل للموبايل: ${url}`);
}

if (process.argv[2] === 'apk') {
  buildApk().catch((e) => { console.error('❌', e.message); process.exit(1); });
} else {
  const r = eas(process.argv.slice(2), { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}

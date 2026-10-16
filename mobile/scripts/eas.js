// تشغيل EAS (خدمة Expo لبناء تطبيقات أندرويد وآيفون) من المجلد الرئيسي، على ويندوز وماك ولينكس.
// المجلد المحلي قد لا يكون مستودع git، فنطلب من EAS رفع الملفات بدون git في هذه الحالة.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const hasGit = (dir) => { for (let d = dir; d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, '.git'))) return true; return false; };
const env = { ...process.env };
if (!hasGit(root)) env.EAS_NO_VCS = '1';

const r = spawnSync('npx', ['--yes', 'eas-cli@latest', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit', shell: true, env });
process.exit(r.status === null ? 1 : r.status);

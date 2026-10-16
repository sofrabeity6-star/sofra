// يبني نسخة الويب من التطبيق (نفس كود الموبايل) لتُقدَّم من الخادم على /web. يعمل على ويندوز وماك ولينكس.
const { spawnSync } = require('child_process');
const base = process.env.EXPO_BASE_URL || '/web';
const r = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'], {
  stdio: 'inherit', shell: true, env: { ...process.env, EXPO_BASE_URL: base, CI: '1' },
});
process.exit(r.status === null ? 1 : r.status);

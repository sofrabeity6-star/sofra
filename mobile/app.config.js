// يكمل app.json: عند بناء نسخة الويب (EXPO_BASE_URL=/web) تُحمَّل الملفات من /web بدل الجذر.
module.exports = ({ config }) => ({
  ...config,
  experiments: { ...(config.experiments || {}), ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}) },
});

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => {
  const m = new Map();
  return { getItemAsync: async (k) => (m.has(k) ? m.get(k) : null), setItemAsync: async (k, v) => { m.set(k, v); }, deleteItemAsync: async (k) => { m.delete(k); } };
});
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

// jest-expo يستبدل fetch بنسخة وهمية، فنوفّر هنا fetch حقيقية عبر http لاختبار التطبيق على الخادم الفعلي (للاختبارات فقط)
const http = require('http');
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const headers = { ...(init.headers || {}) };
  let body;
  if (typeof init.body === 'string') body = Buffer.from(init.body);
  else if (init.body && typeof init.body === 'object') {
    // FormData: نسلسله كما يفعل المتصفح (multipart)
    const r = new Response(init.body);
    headers['Content-Type'] = r.headers.get('content-type');
    body = Buffer.from(await r.arrayBuffer());
  }
  if (body) headers['Content-Length'] = body.length;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: init.method || 'GET', headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks), h = res.headers;
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
          headers: { get: (k) => h[String(k).toLowerCase()] || null, getSetCookie: () => [].concat(h['set-cookie'] || []) },
          json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8'), arrayBuffer: async () => buf,
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
};

// SafeAreaProvider لا يعرض أبناءه في jest قبل وصول حدث الأبعاد الأصلي، فنستخدم النسخة الوهمية الرسمية
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  AndroidImportance: { MAX: 5 },
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-token-1234567]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));

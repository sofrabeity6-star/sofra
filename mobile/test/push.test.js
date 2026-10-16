import { Platform } from 'react-native';

const loadPush = (env) => {
  let mod;
  jest.isolateModules(() => {
    jest.doMock('expo-constants', () => ({ __esModule: true, default: { executionEnvironment: env, expoConfig: { extra: { eas: { projectId: 'proj-123' } } } } }));
    mod = require('../src/push');
  });
  return mod;
};
const Notifications = require('expo-notifications');

beforeEach(() => { jest.clearAllMocks(); Platform.OS = 'android'; });

test('Expo Go: يُتخطّى التسجيل بهدوء (Push غير مدعوم هناك)', async () => {
  const push = loadPush('storeClient');
  const api = jest.fn();
  expect(await push.registerForPush(api)).toBeNull();
  expect(api).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

test('النسخة المنشورة: يطلب الإذن ويسجّل التوكن في الخادم ثم يزيله عند الخروج', async () => {
  const push = loadPush('standalone');
  const api = jest.fn(async () => ({ ok: true }));
  const token = await push.registerForPush(api);
  expect(token).toBe('ExponentPushToken[test-token-1234567]');
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith('default', expect.objectContaining({ importance: 5 }));
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' });
  expect(api).toHaveBeenCalledWith('POST', '/api/push-token', { json: { token, platform: 'android' }, quiet: true });
  await push.unregisterPush(api);
  expect(api).toHaveBeenLastCalledWith('POST', '/api/push-token/remove', { json: { token }, quiet: true });
});

test('رفض الإذن أو غياب projectId أو خطأ الشبكة: لا يكسر التطبيق', async () => {
  const api = jest.fn();
  Notifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
  expect(await loadPush('standalone').registerForPush(api)).toBeNull();
  expect(api).not.toHaveBeenCalled();
  Notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('FCM not configured'));
  expect(await loadPush('standalone').registerForPush(api)).toBeNull();
});

test('الضغط على الإشعار يفتح الطلب المعني', async () => {
  const push = loadPush('standalone');
  const onOrder = jest.fn();
  push.listenForTaps(onOrder);
  const handler = Notifications.addNotificationResponseReceivedListener.mock.calls[0][0];
  handler({ notification: { request: { content: { data: { order_id: 42 } } } } });
  expect(onOrder).toHaveBeenCalledWith(42);
  handler({ notification: { request: { content: { data: {} } } } });
  expect(onOrder).toHaveBeenCalledTimes(1);
});

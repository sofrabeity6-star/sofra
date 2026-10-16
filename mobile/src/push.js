import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

let currentToken = null;
let currentPrefix = '/api';

// Expo Go لا يدعم Push البعيد على أندرويد (SDK 53+)، فنتخطاه بهدوء. يعمل في النسخ المنشورة وبناء التطوير.
export const isExpoGo = () => Constants.executionEnvironment === 'storeClient';
const supported = () => Platform.OS !== 'web' && !isExpoGo();

export function setupNotifications() {
  if (!supported()) return;
  // عرض الإشعار حتى والتطبيق مفتوح
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

// يطلب الإذن، ويحصل على Expo Push Token، ويسجله في الخادم لحساب العميل الحالي. يعيد التوكن أو null.
export async function registerForPush(api, prefix = '/api') {
  if (!supported()) return null;
  try {
    if (Platform.OS === 'android') {
      // لازم قناة قبل طلب الإذن على أندرويد 13+
      await Notifications.setNotificationChannelAsync('default', {
        name: 'إشعارات الطلبات', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId = (Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.eas && Constants.expoConfig.extra.eas.projectId)
      || (Constants.easConfig && Constants.easConfig.projectId);
    if (!projectId) { console.warn('[push] لا يوجد EAS projectId: نفّذ "eas init" ثم أعد البناء'); return null; }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    currentToken = token;
    currentPrefix = prefix;
    await api('POST', `${prefix}/push-token`, { json: { token, platform: Platform.OS }, quiet: true });
    return token;
  } catch (e) {
    console.warn('[push] تعذر تفعيل الإشعارات:', e && e.message);
    return null;
  }
}

// عند تسجيل الخروج: نزيل الجهاز من الحساب حتى لا تصله إشعارات مستخدم آخر
export async function unregisterPush(api) {
  if (!currentToken) return;
  const token = currentToken;
  currentToken = null;
  await api('POST', `${currentPrefix}/push-token/remove`, { json: { token }, quiet: true });
}

// عند الضغط على الإشعار نفتح الطلب المعني (يشمل فتح التطبيق من الإغلاق التام)
export function listenForTaps(onOrder) {
  if (!supported()) return () => {};
  const handle = (resp) => {
    const id = resp && resp.notification && resp.notification.request.content.data && resp.notification.request.content.data.order_id;
    if (id) onOrder(Number(id));
  };
  Notifications.getLastNotificationResponseAsync().then(handle).catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}

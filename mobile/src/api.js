import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { store } from './storage';

const SERVER_KEY = 'sofra_server_url';
let baseUrl = '';
let token = null;
let onUnauth = null;

// ترتيب الأولوية: العنوان المحفوظ من شاشة الإعدادات ← متغير البيئة ← app.json ← عنوان جهاز التطوير (Expo Go)
function guessBase() {
  const env = process.env.EXPO_PUBLIC_API_URL;
  if (env) return env;
  const extra = Constants.expoConfig && Constants.expoConfig.extra && Constants.expoConfig.extra.apiUrl;
  if (extra) return extra;
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port, pathname, origin } = window.location;
    // النسخة المبنية يقدّمها الخادم نفسه على /web (محلياً أو على Render): نفس العنوان دائماً
    if (pathname === '/web' || pathname.startsWith('/web/')) return origin;
    return port === '3000' || port === '' ?`${protocol}//${hostname}${port ? ':' + port : ''}` : `${protocol}//${hostname}:3000`;
  }
  const host = Constants.expoConfig && Constants.expoConfig.hostUri;
  if (host) return `http://${host.split(':')[0]}:3000`;
  return 'http://localhost:3000';
}

export async function initApi() {
  const saved = await store.raw(SERVER_KEY);
  baseUrl = (saved || guessBase()).replace(/\/+$/, '');
  return baseUrl;
}
export const getBase = () => baseUrl;
export async function setBase(url) {
  baseUrl = String(url || '').trim().replace(/\/+$/, '') || guessBase();
  if (url && url.trim()) await store.setRaw(SERVER_KEY, baseUrl); else await store.del(SERVER_KEY);
  return baseUrl;
}
export const setToken = (t) => { token = t; };
export const getToken = () => token;
export const setUnauthHandler = (f) => { onUnauth = f; };
export const mediaUrl = (file) => `${baseUrl}/media/menu/${file}`;
export const qrUrl = (file) => `${baseUrl}/media/qr/${file}`;

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(method, path, { json, form, quiet, timeout = 25000 } = {}) {
  const headers = { 'X-Requested-With': 'sofra', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  if (form) init.body = form;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl && setTimeout(() => ctl.abort(), timeout);
  if (ctl) init.signal = ctl.signal;
  let res;
  try {
    res = await fetch(baseUrl + path, init);
  } catch (e) {
    throw new ApiError('تعذر الاتصال بالخادم. تحقق من الإنترنت أو من عنوان الخادم.', 0, 'offline');
  } finally { if (timer) clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* لا جسم */ }
  if (!res.ok) {
    const err = new ApiError((data && data.error && data.error.message) || 'حدث خطأ غير متوقع', res.status, data && data.error && data.error.code);
    if (res.status === 401 && !quiet && onUnauth) onUnauth();
    throw err;
  }
  return data;
}

// إرفاق صورة بنموذج الرفع: كائن {uri,name,type} على الموبايل، وBlob على الويب
export async function appendImage(fd, field, asset, name = 'receipt.jpg') {
  const type = asset.mimeType && /^image\/(jpeg|png|webp)$/.test(asset.mimeType) ? asset.mimeType : 'image/jpeg';
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    fd.append(field, new Blob([blob], { type }), name);
  } else {
    fd.append(field, { uri: asset.uri, name, type });
  }
}

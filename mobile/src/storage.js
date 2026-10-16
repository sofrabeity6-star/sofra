import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// التوكن في التخزين الآمن للنظام (Keychain / Keystore)؛ على الويب يُحفظ في التخزين المحلي
export const secure = {
  get: (k) => (Platform.OS === 'web' ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: (k, v) => (Platform.OS === 'web' ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: (k) => (Platform.OS === 'web' ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

export const store = {
  async get(k, fallback) {
    try { const v = await AsyncStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  async set(k, v) { try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch { /* ممتلئ */ } },
  async raw(k) { try { return await AsyncStorage.getItem(k); } catch { return null; } },
  async setRaw(k, v) { try { await AsyncStorage.setItem(k, v); } catch { /* تجاهل */ } },
  async del(k) { try { await AsyncStorage.removeItem(k); } catch { /* تجاهل */ } },
};

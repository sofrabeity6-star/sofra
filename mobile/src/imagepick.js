import * as ImagePicker from 'expo-image-picker';

// اختيار صورة من المعرض أو الكاميرا. يعيد asset أو null عند الإلغاء
export async function pickImage(kind) {
  if (kind === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('اسمح للتطبيق باستخدام الكاميرا من إعدادات الجهاز');
    const r = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    return r.canceled ? null : r.assets[0];
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  return r.canceled ? null : r.assets[0];
}

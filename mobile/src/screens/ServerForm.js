import React, { useState } from 'react';
import { Btn, Card, Field, T } from '../ui';
import { useApp } from '../store';
import { getBase } from '../api';

// تغيير عنوان خادم سفرة (مفيد عند الاختبار على الهاتف أو عند نقل الخادم)
export default function ServerForm() {
  const { changeServer, toast, fail } = useApp();
  const [srv, setSrv] = useState(getBase());
  return (
    <Card>
      <T size={13} mute>عنوان خادم سفرة. أثناء التطوير يُستنتج تلقائياً من عنوان جهاز الكمبيوتر (المنفذ 3000)، ويمكنك تغييره هنا.</T>
      <Field testID="server-url" label="عنوان الخادم" value={srv} onChangeText={setSrv} ltr autoCapitalize="none" autoCorrect={false} keyboardType="url" />
      <Btn testID="server-save" kind="primary" sm title="حفظ وإعادة الاتصال" onPress={() => changeServer(srv).then(() => toast('تم تحديث عنوان الخادم')).catch(fail)} />
    </Card>
  );
}

import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
const { boot } = require('../../test/helpers');

let t;
beforeAll(async () => { t = await boot(); process.env.EXPO_PUBLIC_API_URL = t.base; });
afterAll(async () => { await t.close(); });
const press = async (id) => { await fireEvent.press(await screen.findByTestId(id)); };
const type = async (id, v) => { await fireEvent.changeText(await screen.findByTestId(id), v); };

test('إعدادات المدير تنعكس على العميل: إعلان، إيقاف الطلبات، وإخفاء طريقة دفع معطّلة', async () => {
  await t.admin.put('/api/admin/settings', { announcement: 'عرض خاص يوم الجمعة', accepting_orders: false, closed_message: 'مغلقون اليوم', cod_enabled: false });
  const App = require('../App').default;
  await render(<App />);
  await press('mode-register');
  await type('f-name', 'منى'); await type('f-phone', '01055556666'); await type('f-password', 'password123'); await type('f-text', '١٠ شارع النيل، القاهرة');
  await press('auth-submit');
  await screen.findByTestId('tab-menu', {}, { timeout: 10000 });
  expect(screen.getByTestId('announcement')).toHaveTextContent(/عرض خاص يوم الجمعة/);
  expect(screen.getByTestId('closed-banner')).toHaveTextContent(/مغلقون اليوم/);

  // السلة: لا يمكن إتمام الطلب أثناء الإيقاف
  await press(`mode-later`);
  await press(`add-${t.items.kofta}`);
  await press('add-cart');
  await press('tab-cart');
  await press('checkout');
  await waitFor(() => expect(screen.getByTestId('toast')).toHaveTextContent(/مغلقون اليوم/));
  expect(screen.queryByTestId('place-order')).toBeNull();

  // بعد إعادة الفتح: التحويل فقط (الكاش معطّل)
  await t.admin.put('/api/admin/settings', { accepting_orders: true });
  await press('tab-orders'); await press('tab-cart');
  await new Promise((r) => setTimeout(r, 100));
  // الإعدادات تتحدث دورياً؛ نفرض التحديث بإعادة الدخول
  await press('tab-me'); await press('logout');
  await press('mode-login'); await type('f-phone', '01055556666'); await type('f-password', 'password123'); await press('auth-submit');
  await screen.findByTestId('tab-cart', {}, { timeout: 10000 });
  await press('tab-cart');
  await press('checkout'); // السلة محفوظة بعد الخروج والدخول
  await screen.findByTestId('pay-transfer');
  expect(screen.queryByTestId('pay-cod')).toBeNull();
  expect(screen.queryByTestId('closed-banner')).toBeNull();
});

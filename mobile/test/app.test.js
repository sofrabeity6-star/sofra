import React from 'react';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
const { boot, dl, place, PNG } = require('../../test/helpers');

let t;
beforeAll(async () => {
  t = await boot(); process.env.EXPO_PUBLIC_API_URL = t.base;
  // المدير يضبط حسابات التحويل وكود QR ورقم المطبخ من الإعدادات
  const f = new FormData(); f.set('image', new Blob([PNG], { type: 'image/png' }), 'qr.png');
  const up = await t.admin.req('POST', '/api/admin/payment-qr', { form: f });
  await t.admin.put('/api/admin/settings', { kitchen_phone: '01099990000', payment_accounts: [{ label: 'إنستاباي', value: 'sofra@instapay', qr: up.data.file }, { label: 'فودافون كاش', value: '01011112222' }] });
});
afterAll(async () => { await t.close(); });

const press = async (id) => { await fireEvent.press(await screen.findByTestId(id)); };
const type = async (id, v) => { await fireEvent.changeText(await screen.findByTestId(id), v); };

test('رحلة العميل الكاملة في تطبيق Expo: تسجيل، جدولة، توصيل سريع، طلب كاش، متابعة الحالة', async () => {
  const App = require('../App').default;
  await render(<App />);

  // تسجيل حساب جديد
  await press('mode-register');
  await type('f-name', 'سارة');
  await type('f-phone', '01099998888');
  await type('f-password', 'password123');
  await type('f-text', '٥ شارع النيل، القاهرة');
  await press('auth-submit');
  await screen.findByTestId('tab-menu', {}, { timeout: 10000 });
  await screen.findByTestId(`meal-${t.items.bamya}`);
  
  // الافتراضي «اطلب الآن»: الطلب العادي (الكفتة) بدون اختيار مواعيد
  expect(screen.getByTestId('now-banner')).toHaveTextContent(/طلب عادي/);
  expect(screen.getByText('للطلب المجدول فقط')).toBeTruthy(); // البامية للمجدول فقط
  await press(`add-${t.items.kofta}`);
  expect(screen.queryByTestId('day-chips')).toBeNull();
  await press('add-cart');
  await waitFor(() => expect(screen.queryByTestId('add-cart')).toBeNull());

  // تبويب «جدولة طلب»: البامية بموعد محدد
  await press('mode-later');
  await press(`add-${t.items.bamya}`);
  await screen.findByTestId('day-chips');
  await press('add-cart');
  await waitFor(() => expect(screen.queryByTestId('add-cart')).toBeNull());

  // السلة: مجموعتان، الأولى للسريع
  await press('tab-cart');
  await screen.findByTestId('slip-asap');
  expect(screen.getByText('طلب عادي (الآن)')).toBeTruthy();

  // إتمام الطلب بالدفع عند الاستلام
  await press('checkout');
  // طريقة الدفع الافتراضية «تحويل»: تظهر الحسابات وكود QR ورقم المطبخ للاستفسار (تأتي بعد تسجيل الدخول)
  await screen.findByTestId('account-0');
  expect(screen.getByTestId('account-0')).toHaveTextContent(/إنستاباي/);
  expect(screen.getByTestId('account-0')).toHaveTextContent(/sofra@instapay/);
  expect(screen.getByTestId('account-1')).toHaveTextContent(/فودافون كاش/);
  expect(screen.getByTestId('qr-0')).toBeTruthy();
  expect(screen.queryByTestId('qr-1')).toBeNull();
  expect(screen.getByTestId('call-kitchen')).toHaveTextContent(/01099990000/);
  expect(screen.queryByText(/تواصل مع المطبخ لمعرفة حسابات التحويل/)).toBeNull();
  await press('pay-cod');
  await press('place-order');
  const stage = await screen.findByTestId('order-stage', {}, { timeout: 10000 });
  expect(stage).toHaveTextContent('بانتظار مكالمة التأكيد');
  await screen.findByTestId('switch-prepay');

  // الأدمن يؤكد فيبدأ تجهيز الطلب العاجل فوراً
  const o = (await t.admin.get('/api/admin/orders')).data.orders[0];
  expect(o.is_asap).toBe(true);
  await t.admin.post(`/api/admin/orders/${o.id}/call`, { outcome: 'confirmed' });

  // يعاد فتح الطلب فتظهر الحالة الجديدة، ولا يمكن إلغاؤه بعد بدء التجهيز
  await press('sheet-close');
  await press('tab-orders');
  await press(`order-${o.id}`);
  await waitFor(() => expect(screen.getByTestId('order-stage')).toHaveTextContent('قيد التجهيز'), { timeout: 10000 });
  expect(screen.queryByTestId('cancel-order')).toBeNull();
  expect(screen.getByText(/🛵 طلب عادي|⚡ طلب سريع/)).toBeTruthy();
  await press('repeat-order');
  await screen.findByTestId('slip-asap');
  await press('tab-me');
  await press('logout');
  await screen.findByTestId('mode-login');
});

test('خطأ الاتصال بالخادم يظهر رسالة واضحة مع إعادة المحاولة', async () => {
  process.env.EXPO_PUBLIC_API_URL = 'http://127.0.0.1:1';
  const App = require('../App').default;
  await render(<App />);
  const err = await screen.findByTestId('boot-error', {}, { timeout: 15000 });
  expect(err).toHaveTextContent(/تعذر الاتصال بالخادم/);
  expect(screen.getByTestId('server-url')).toBeTruthy();
  process.env.EXPO_PUBLIC_API_URL = t.base;
});

import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
const { boot, dl, place } = require('../../test/helpers');

let t;
let ids;
beforeAll(async () => {
  t = await boot();
  process.env.EXPO_PUBLIC_API_URL = t.base;
  const c = await t.customer('أحمد', '01111111111');
  const k = (id, q) => [{ menu_item_id: id, qty: q }];
  const A = (await place(c, [dl(k(t.items.bamya, 1), '2026-10-04', '18:00')])).data.order;
  t.clock.advance(5);
  const B = (await place(c, [dl(k(t.items.kofta, 3), '2026-10-04', '12:00')], 'transfer')).data.order;
  t.clock.advance(5);
  const C = (await place(c, [{ asap: true, items: k(t.items.salad, 1) }])).data.order;
  ids = { A, B, C };
});
afterAll(async () => { await t.close(); });

const press = async (id) => { await fireEvent.press(await screen.findByTestId(id)); };
const type = async (id, v) => { await fireEvent.changeText(await screen.findByTestId(id), v); };
const rowIds = () => screen.queryAllByTestId(/^aorder-\d+$/).map((n) => Number(n.props.testID.split('-')[1]));
const apiIds = async (qs) => (await t.admin.get('/api/admin/orders?' + qs)).data.orders.map((o) => o.id);

test('الإدارة من الموبايل: دخول، ترتيب الطلبات بكل الأنواع، تأكيد مكالمة، اعتماد إيصال، المطبخ، المنيو', async () => {
  const App = require('../App').default;
  await render(<App />);

  // دخول الإدارة (وليس العميل)
  await press('mode-admin');
  await type('f-phone', '01000000000');
  await type('f-password', 'password123');
  await press('auth-submit');
  await screen.findByTestId('atab-orders', {}, { timeout: 10000 });
  expect(screen.queryByTestId('tab-menu')).toBeNull(); // لا شاشات عميل

  // الافتراضي: وقت التسليم من الأقرب للأبعد (الفوري أولاً)
  await waitFor(() => expect(rowIds().length).toBe(3));
  const { A, B, C } = ids;
  expect(rowIds()).toEqual([C.id, B.id, A.id]);
  expect(rowIds()).toEqual(await apiIds('sort=delivery&dir=asc'));
  expect(screen.getByTestId('stat-calls')).toBeTruthy();

  // عكس الاتجاه، ثم الترتيب بالسعر والمرحلة ووقت الطلب (يطابق نتائج الخادم)
  await press('dir');
  await waitFor(() => expect(rowIds()).toEqual([A.id, B.id, C.id]));
  await press('sort-total');
  await waitFor(() => expect(rowIds()).toEqual([B.id, A.id, C.id])); // السعر تنازلياً
  expect(rowIds()).toEqual(await apiIds('sort=total&dir=desc'));
  await press('dir');
  await waitFor(() => expect(rowIds()).toEqual([C.id, A.id, B.id])); // السعر تصاعدياً
  await press('sort-created');
  await waitFor(() => expect(rowIds()).toEqual([A.id, B.id, C.id]));
  await press('sort-stage');
  const byStage = await apiIds('sort=stage&dir=desc'); // الاتجاه الحالي تصاعدي/تنازلي كما ضُبط أعلاه
  const byStageAsc = await apiIds('sort=stage&dir=asc');
  await waitFor(() => expect([byStage, byStageAsc]).toContainEqual(rowIds()));

  // تأكيد الطلب الفوري بمكالمة: يبدأ تجهيزه فوراً
  await press(`aorder-${C.id}`);
  await press('a-confirm');
  await waitFor(() => expect(screen.getByTestId('a-stage')).toHaveTextContent('قيد التجهيز'), { timeout: 8000 });
  expect((await t.admin.get(`/api/admin/orders/${C.id}`)).data.order.status).toBe('confirmed');
  await press('sheet-close');

  // اعتماد إيصال طلب التحويل
  await press('scope-receipts');
  await waitFor(() => expect(rowIds()).toEqual([B.id]));
  await press(`aorder-${B.id}`);
  await screen.findByTestId('a-receipt');
  await press('a-approve');
  await waitFor(() => expect(screen.getByTestId('a-stage')).toHaveTextContent('تم التأكيد'), { timeout: 8000 });
  await press('sheet-close');

  // المطبخ: الطلب الفوري المؤكد اليوم يظهر في الأجندة
  await press('atab-kitchen');
  await screen.findByText('المطلوب طبخه');
  expect(screen.getAllByText(/سلطة/).length).toBeGreaterThanOrEqual(2); // في الإجمالي وفي بطاقة الطلب

  // المنيو: إيقاف وجبة نفدت
  await press('atab-menu');
  await press(`toggle-${t.items.salad}`);
  await waitFor(() => expect(screen.getByTestId(`toggle-${t.items.salad}`)).toHaveTextContent(/نفدت/));
  expect((await t.admin.get('/api/admin/menu')).data.items.find((i) => i.id === t.items.salad).available).toBe(0);

  await press('atab-more');
  await press('logout');
  await screen.findByTestId('mode-admin');
});

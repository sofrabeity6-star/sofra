import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
const { boot } = require('../../test/helpers');

let t;
beforeAll(async () => { t = await boot(); process.env.EXPO_PUBLIC_API_URL = t.base; });
afterAll(async () => { await t.close(); });

const press = async (id) => { await fireEvent.press(await screen.findByTestId(id)); };
const type = async (id, v) => { await fireEvent.changeText(await screen.findByTestId(id), v); };
const login = async (phone) => {
  await press('mode-admin'); await type('f-phone', phone); await type('f-password', 'password123'); await press('auth-submit');
  await screen.findByTestId('atab-orders', {}, { timeout: 10000 });
};
const items = async () => (await t.admin.get('/api/admin/menu')).data;

test('المدير يدير المنيو والتصنيفات والإعدادات والفريق من الموبايل', async () => {
  const App = require('../App').default;
  await render(<App />);
  await login('01000000000');

  // التصنيفات: إضافة
  await press('atab-menu');
  await type('cat-new', 'عصائر');
  await press('cat-add');
  const cat = await waitFor(async () => { const c = (await items()).categories.find((x) => x.name === 'عصائر'); if (!c) throw new Error('no cat'); return c; });

  // وجبة جديدة: تصلح للطلب الفوري افتراضياً
  await press(`add-item-${cat.id}`);
  await type('item-name', 'عصير ليمون');
  await type('item-price', '35.5');
  await press('item-save');
  const it = await waitFor(async () => { const x = (await items()).items.find((i) => i.name === 'عصير ليمون'); if (!x) throw new Error('no item'); return x; });
  expect(it.price_cents).toBe(3550);
  expect(it.asap_ok).toBe(1);
  expect(it.category_id).toBe(cat.id);

  // تعديل السعر وإلغاء «يصلح للفوري»
  await press(`edit-${it.id}`);
  await type('item-price', '40');
  await press('item-asap');
  await press('item-save');
  await waitFor(async () => { const x = (await items()).items.find((i) => i.id === it.id); expect(x.price_cents).toBe(4000); expect(x.asap_ok).toBe(0); });

  // إيقاف الوجبة ثم حذفها (تأكيد على خطوتين)
  await press(`toggle-${it.id}`);
  await waitFor(() => expect(screen.getByTestId(`toggle-${it.id}`)).toHaveTextContent(/نفدت/));
  await press(`edit-${it.id}`);
  await press('item-delete');
  await press('item-delete');
  await waitFor(async () => expect((await items()).items.find((i) => i.id === it.id)).toBeUndefined());

  // الإعدادات
  await press('atab-more');
  await press('more-settings');
  const nameInput = await screen.findByDisplayValue('سفرة / بيتي');
  await fireEvent.changeText(nameInput, 'مطبخ أم أحمد');
  // إيقاف الطلبات برسالة، فاصل 60 دقيقة، تعطيل الكاش، وإضافة حساب تحويل
  await press('set-accepting');
  await fireEvent.changeText(await screen.findByPlaceholderText('مثال: مغلقون اليوم، نعود غداً'), 'مغلقون للصيانة');
  await press('slot-60');
  await press('set-cod');
  await press('acc-add');
  const labels = await screen.findAllByPlaceholderText('الاسم (إنستاباي، فودافون كاش...)');
  const values = screen.getAllByPlaceholderText('الرقم أو العنوان');
  await fireEvent.changeText(labels[labels.length - 1], 'إنستاباي');
  await fireEvent.changeText(values[values.length - 1], 'kitchen@instapay');
  await press('settings-save');
  await waitFor(async () => {
    const st = (await t.admin.get('/api/admin/settings')).data.settings;
    expect(st.kitchen_name).toBe('مطبخ أم أحمد');
    expect(st.accepting_orders).toBe(false);
    expect(st.closed_message).toBe('مغلقون للصيانة');
    expect(st.slot_minutes).toBe(60);
    expect(st.cod_enabled).toBe(false);
    expect(st.payment_accounts.map((a) => a.value)).toContain('kitchen@instapay');
  });
  await press('more-back');

  // الفريق: إضافة موظف جديد
  await press('more-team');
  await type('team-name', 'موظف جديد');
  await type('team-phone', '01233334444');
  await type('team-pass', 'password123');
  await press('team-add');
  await waitFor(async () => expect((await t.admin.get('/api/admin/users')).data.users.some((u) => u.phone === '01233334444')).toBe(true));
  await press('more-back');

  // نظرة عامة
  await press('more-overview');
  await screen.findByTestId('sales-chart');

  await press('more-back');
  await press('logout');
  await screen.findByTestId('mode-admin');
});

test('موظف المطبخ: يوقف الوجبات فقط ولا يرى الإعدادات أو تعديل المنيو', async () => {
  const App = require('../App').default;
  await render(<App />);
  await login('01000000001');
  await press('atab-menu');
  const first = (await items()).items[0];
  await screen.findByTestId(`toggle-${first.id}`);
  expect(screen.queryByTestId('cat-new')).toBeNull();
  expect(screen.queryByTestId(`edit-${first.id}`)).toBeNull();
  await press(`toggle-${first.id}`);
  await waitFor(async () => expect((await items()).items.find((i) => i.id === first.id).available).toBe(0));
  await press('atab-more');
  expect(screen.queryByTestId('more-settings')).toBeNull();
  expect(screen.queryByTestId('more-team')).toBeNull();
  expect(screen.getByTestId('more-overview')).toBeTruthy();
});

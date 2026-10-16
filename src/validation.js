'use strict';
const { z } = require('zod');
const { AppError } = require('./errors');
const { isRealDate, TIME_RE, timeToMinutes } = require('./time');

function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    const field = i.path.join('.');
    throw new AppError(400, i.message && !/^(Invalid|Required|Expected|Too )/i.test(i.message) ? i.message : `بيانات غير صحيحة${field ? ` (${field})` : ''}`, 'validation');
  }
  return r.data;
}

const id = z.coerce.number().int().positive();
const bool = z.union([z.boolean(), z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true')]);
const password = z.string().min(8, 'كلمة المرور 8 أحرف على الأقل').max(100);

const registerSchema = z.object({
  name: z.string().trim().min(2, 'اكتب اسمك').max(60),
  phone: z.string().min(5, 'اكتب رقم الموبايل'),
  password,
  address: z.object({ label: z.string().trim().max(30).optional(), text: z.string().trim().min(5, 'اكتب عنواناً أوضح').max(300) }).optional(),
});
const loginSchema = z.object({ phone: z.string().min(5), password: z.string().min(1) });
const addressSchema = z.object({ label: z.string().trim().min(1, 'اكتب تسمية للعنوان').max(30), text: z.string().trim().min(5, 'اكتب عنواناً أوضح').max(300) });

const itemSchema = z.object({ menu_item_id: id, qty: z.number().int().min(1, 'الكمية 1 على الأقل').max(50) });
const deliverySchema = z.object({
  asap: z.boolean().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  items: z.array(itemSchema).min(1, 'أضف وجبة واحدة على الأقل لكل موعد').max(30),
}).superRefine((d, ctx) => {
  if (d.asap) return;
  if (!d.date || !isRealDate(d.date)) ctx.addIssue({ code: 'custom', message: 'تاريخ التسليم غير صحيح' });
  if (!d.time || !TIME_RE.test(d.time)) ctx.addIssue({ code: 'custom', message: 'ساعة التسليم غير صحيحة' });
});
const orderSchema = z.object({
  address_id: id,
  payment_method: z.enum(['transfer', 'cod']),
  notes: z.string().max(500).optional(),
  receipt_reference: z.string().max(60).optional(),
  deliveries: z.array(deliverySchema).min(1, 'الجدول فارغ').max(31, 'الحد الأقصى 31 موعداً في الطلب الواحد'),
}).refine((o) => o.deliveries.filter((d) => d.asap).length <= 1, { message: 'يمكن إضافة موعد توصيل سريع واحد فقط في الطلب' });

const menuSchema = z.object({
  category_id: id,
  name: z.string().trim().min(1, 'اكتب اسم الوجبة').max(80),
  description: z.string().trim().max(300).optional().default(''),
  price_cents: z.coerce.number().int().min(0).max(10000000),
  emoji: z.string().trim().max(8).optional().default('🍽️'),
  available: bool.optional(),
  popular: bool.optional(),
  asap_ok: bool.optional(),
});

const settingsSchema = z.object({
  kitchen_name: z.string().trim().min(1).max(60),
  kitchen_phone: z.string().trim().max(30),
  timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'المنطقة الزمنية غير صحيحة'),
  open_time: z.string().regex(TIME_RE, 'ساعة الفتح غير صحيحة'),
  close_time: z.string().regex(TIME_RE, 'ساعة الإغلاق غير صحيحة'),
  delivery_fee_cents: z.number().int().min(0).max(1000000),
  asap_enabled: z.boolean(),
  asap_minutes: z.number().int().min(20).max(240),
  asap_fee_cents: z.number().int().min(0).max(1000000),
  min_lead_minutes: z.number().int().min(0).max(1440),
  max_days_ahead: z.number().int().min(1).max(120),
  auto_prepare_minutes: z.number().int().min(0).max(1440),
  max_pending_cod: z.number().int().min(1).max(20),
  slot_minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]),
  cod_enabled: z.boolean(),
  transfer_enabled: z.boolean(),
  accepting_orders: z.boolean(),
  closed_message: z.string().trim().max(200),
  announcement: z.string().trim().max(300),
  payment_accounts: z.array(z.object({
    label: z.string().trim().min(1, 'اكتب اسم الحساب').max(40),
    value: z.string().trim().min(1, 'اكتب رقم أو عنوان الحساب').max(80),
    qr: z.string().regex(/^[a-f0-9]{32}\.(jpg|png|webp)$/).nullable().optional(),
  })).max(8),
}).partial().superRefine((s, ctx) => {
  if (s.cod_enabled === false && s.transfer_enabled === false) ctx.addIssue({ code: 'custom', message: 'فعّل طريقة دفع واحدة على الأقل' });
  if (s.open_time && s.close_time && timeToMinutes(s.open_time) >= timeToMinutes(s.close_time)) {
    ctx.addIssue({ code: 'custom', message: 'ساعة الإغلاق يجب أن تكون بعد ساعة الفتح (نفس اليوم)' });
  }
});

const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  phone: z.string().min(5),
  password,
  role: z.enum(['staff', 'admin']),
});
const userPatchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  role: z.enum(['staff', 'admin']).optional(),
  active: z.boolean().optional(),
  password: password.optional(),
});

module.exports = { parse, id, registerSchema, loginSchema, addressSchema, orderSchema, menuSchema, settingsSchema, userCreateSchema, userPatchSchema, z };

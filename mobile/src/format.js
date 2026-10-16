// تنسيق الأرقام والتواريخ بالعربية دون الاعتماد على Intl للأسماء (لثبات السلوك على Hermes في كل الأجهزة)
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const digits = (s) => String(s).replace(/\d/g, (d) => AR_DIGITS[d]);
const group = (intStr) => intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
export const n = (x) => digits(group(String(Math.trunc(Number(x) || 0)))) ;
export const id = (x) => digits(String(x)); // أرقام الطلبات بدون فاصل آلاف
export function money(cents) {
  const v = (Number(cents) || 0) / 100;
  const [i, f] = v.toFixed(2).split('.');
  const frac = f === '00' ? '' : '٫' + digits(f.replace(/0$/, ''));
  return `${digits(group(i))}${frac} ج.م`;
}

export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

let tz = 'Africa/Cairo';
let skew = 0;
export const setClock = (zone, serverNowIso) => { tz = zone || tz; skew = Date.parse(serverNowIso) - Date.now(); };
export const now = () => new Date(Date.now() + skew);

const pad = (x) => String(x).padStart(2, '0');
// ISO UTC -> {date:'YYYY-MM-DD', time:'HH:MM', minutes} بتوقيت المطبخ
export function parts(d) {
  const date = d instanceof Date ? d : new Date(d);
  try {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(date).forEach((x) => { p[x.type] = x.value; });
    const hh = p.hour === '24' ? '00' : p.hour;
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${hh}:${p.minute}`, minutes: +hh * 60 + +p.minute };
  } catch {
    // احتياطي إذا لم تدعم البيئة المناطق الزمنية: توقيت الجهاز
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}`, minutes: date.getHours() * 60 + date.getMinutes() };
  }
}
export const today = () => parts(now()).date;
export function addDays(s, k) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
const wdIndex = (s) => new Date(s + 'T12:00:00Z').getUTCDay();
export const wd = (s) => WEEKDAYS[wdIndex(s)];
export const dayNum = (s) => digits(Number(s.slice(8, 10)));
export const monthName = (s) => MONTHS[Number(s.slice(5, 7)) - 1];
export const dayLabel = (s) => `${wd(s)} ${dayNum(s)} ${monthName(s)}`;
export const tmin = (t) => { const a = t.split(':').map(Number); return a[0] * 60 + a[1]; };
export function fmtHM(t) {
  const [h, m] = t.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${digits(h12)}:${digits(pad(m))} ${h < 12 ? 'ص' : 'م'}`;
}
export const fmtTime = (iso) => fmtHM(parts(iso).time);
export const fmtDay = (iso) => dayLabel(parts(iso).date);
export const fmtDT = (iso) => { const p = parts(iso); return `${digits(Number(p.date.slice(8, 10)))} ${monthName(p.date)} ${fmtHM(p.time)}`; };
export const dayShort = (iso) => { const p = parts(iso).date, t = today(); return p === t ? 'اليوم' : p === addDays(t, 1) ? 'غداً' : dayLabel(p); };

export const STAGES = {
  pending_phone_confirmation: ['بانتظار مكالمة التأكيد', 'warn'], receipt_review: ['مراجعة الإيصال', 'warn'], receipt_rejected: ['الإيصال مرفوض', 'bad'],
  confirmed: ['تم التأكيد', 'ok'], preparing: ['قيد التجهيز', 'info'], out_for_delivery: ['جاري التوصيل', 'info'], delivered: ['تم التسليم', 'ok'], cancelled: ['ملغي', 'bad'],
};
export const DL = { scheduled: ['مجدول', 'info'], preparing: ['قيد التجهيز', 'info'], out_for_delivery: ['جاري التوصيل', 'info'], delivered: ['تم التسليم', 'ok'], cancelled: ['ملغي', 'bad'] };
export const PAY = { cod: 'دفع عند الاستلام', transfer: 'تحويل إلكتروني' };

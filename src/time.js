'use strict';
// كل الأوقات تُخزَّن UTC بصيغة ISO، وتُحوَّل لتوقيت المطبخ (افتراضياً القاهرة) عند الحاجة فقط.

function parts(utcMs, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = {};
  for (const x of f.formatToParts(new Date(utcMs))) p[x.type] = x.value;
  return p;
}

function tzOffsetMinutes(utcMs, tz) {
  const p = parts(utcMs, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 'YYYY-MM-DD' + 'HH:MM' بتوقيت المطبخ -> Date (UTC)
function localToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(guess, tz);
  let t = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(t, tz);
  if (off2 !== off1) t = guess - off2 * 60000;
  return new Date(t);
}

function localParts(dateObj, tz) {
  const p = parts(dateObj.getTime(), tz);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    minutes: +p.hour * 60 + +p.minute,
  };
}

function addDaysStr(dateStr, k) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + k));
  return dt.toISOString().slice(0, 10);
}

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// حدود اليوم المحلي كـ UTC ISO: [start, end)
function dayRangeUtc(dateStr, tz) {
  return [
    localToUtc(dateStr, '00:00', tz).toISOString(),
    localToUtc(addDaysStr(dateStr, 1), '00:00', tz).toISOString(),
  ];
}

module.exports = { tzOffsetMinutes, localToUtc, localParts, addDaysStr, timeToMinutes, dayRangeUtc, isRealDate, DATE_RE, TIME_RE };

import { useEffect } from 'react';
import { AppState } from 'react-native';
import { n } from '../format';

export const SORTS = [['delivery', 'وقت التسليم'], ['created', 'وقت الطلب'], ['total', 'سعر الطلب'], ['stage', 'المرحلة']];
export const SCOPES = [['open', 'النشطة'], ['calls', 'مكالمات'], ['receipts', 'إيصالات'], ['kitchen', 'المطبخ'], ['done', 'المنتهية'], ['all', 'الكل']];

export const dur = (m) => (m >= 60 ? `${n(Math.floor(m / 60))} س${m % 60 ? ' ' + n(m % 60) + ' د' : ''}` : `${n(m)} د`);

// العدّ التنازلي لموعد التسليم: متأخر (أحمر) أو قريب خلال ساعتين (برتقالي)
export function countdown(o) {
  const m = o.minutes_to_delivery;
  if (m === null || m === undefined || o.stage_rank > 6) return null;
  if (m < 0) return { text: `متأخر ${dur(-m)}`, kind: 'late' };
  if (m <= 120) return { text: `بعد ${dur(m)}`, kind: 'soon' };
  return null;
}

// استطلاع دوري أثناء فتح التطبيق (لا يوجد SSE في React Native)
export function usePoll(fn, ms, deps) {
  useEffect(() => {
    const run = () => { if (AppState.currentState !== 'background') fn(); };
    run();
    const id = setInterval(run, ms);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

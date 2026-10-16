import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as API from './api';
import { secure, store } from './storage';
import { setClock } from './format';
import { repeatItems, uid } from './cart';
import { registerForPush, unregisterPush } from './push';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);
const TOKEN_KEY = 'sofra_token';
const ROLE_KEY = 'sofra_role';
const isStaff = (u) => !!u && u.role !== 'customer';
const POLL_MS = 15000;

export function AppProvider({ children }) {
  const [boot, setBoot] = useState('loading');
  const [bootErr, setBootErr] = useState('');
  const [cfg, setCfg] = useState(null);
  const [menu, setMenu] = useState({ categories: [], items: [] });
  const [user, setUser] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [notes, setNotes] = useState({ list: [], unread: 0 });
  const [cart, setCart] = useState([]);
  const [cartReady, setCartReady] = useState(false); // لا نحفظ السلة قبل تحميل المحفوظة (لتجنب مسحها)
  const [tab, setTab] = useState('menu');
  const [om, setOm] = useState('now'); // وضع الطلب: now = طلب عادي (الافتراضي) | later = جدولة
  const [sheet, setSheet] = useState(null);
  const [toastMsg, setToastMsg] = useState(null);
  const [rk, setRk] = useState(0); // مفتاح تحديث لوحة الإدارة
  const lastNote = useRef(null);
  const timer = useRef(null);
  const userRef = useRef(null);
  userRef.current = user;

  const toast = useCallback((msg, isErr) => {
    setToastMsg({ msg, isErr: !!isErr, k: uid() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), isErr ? 5000 : 3500);
  }, []);
  const fail = useCallback((e) => toast(e && e.message ? e.message : 'حدث خطأ', true), [toast]);

  const cartKey = (u) => `sofra_cart_${u.id}`;

  // الإعدادات (حسابات التحويل، مدة التوصيل، الإيقاف...) تُجلب بعد الدخول وتتحدث دورياً، فتظهر تغييرات لوحة الإدارة بلا إعادة تشغيل
  const refreshConfig = useCallback(async () => {
    try { const c = await API.api('GET', '/api/config', { quiet: true }); setClock(c.timezone, c.now); setCfg(c); } catch { /* تجاهل */ }
  }, []);

  const refreshOrders = useCallback(async () => {
    try { setOrders((await API.api('GET', '/api/orders', { quiet: true })).orders); } catch { /* تجاهل أخطاء التحديث الدوري */ }
  }, []);

  const loadNotes = useCallback(async (announce) => {
    try {
      const r = await API.api('GET', '/api/notifications', { quiet: true });
      const maxId = r.notifications.reduce((m, x) => Math.max(m, x.id), 0);
      if (announce && lastNote.current !== null) {
        const fresh = r.notifications.filter((x) => x.id > lastNote.current);
        if (fresh.length) { toast('🔔 ' + fresh[0].message); refreshOrders(); }
      }
      lastNote.current = Math.max(lastNote.current || 0, maxId);
      setNotes({ list: r.notifications, unread: r.unread });
    } catch { /* تجاهل */ }
  }, [toast, refreshOrders]);

  const loadSession = useCallback(async (u) => {
    const [ad, ords, nt] = await Promise.all([API.api('GET', '/api/addresses'), API.api('GET', '/api/orders'), API.api('GET', '/api/notifications')]);
    setAddresses(ad.addresses); setOrders(ords.orders);
    setNotes({ list: nt.notifications, unread: nt.unread });
    lastNote.current = nt.notifications.reduce((m, x) => Math.max(m, x.id), 0);
    setCart(await store.get(cartKey(u), []));
    setCartReady(true);
    await refreshConfig();
    registerForPush(API.api).catch(() => {}); // لا يؤثر على الدخول إن فشل
  }, [refreshConfig]);

  const startBoot = useCallback(async () => {
    setBoot('loading');
    try {
      await API.initApi();
      const c = await API.api('GET', '/api/config', { quiet: true });
      setClock(c.timezone, c.now); setCfg(c);
      setMenu(await API.api('GET', '/api/menu', { quiet: true }));
      const tk = await secure.get(TOKEN_KEY);
      if (tk) {
        API.setToken(tk);
        const staff = (await store.raw(ROLE_KEY)) === 'staff';
        try {
          const me = await API.api('GET', staff ? '/api/admin/auth/me' : '/api/auth/me', { quiet: true });
          setUser(me.user);
          if (isStaff(me.user)) registerForPush(API.api, '/api/admin').catch(() => {}); else await loadSession(me.user);
        }
        catch (e) { if (e.status === 401) { API.setToken(null); await secure.del(TOKEN_KEY); } }
      }
      setBoot('ready');
    } catch (e) { setBootErr(e.message); setBoot('error'); }
  }, [loadSession]);

  useEffect(() => {
    API.setUnauthHandler(() => { API.setToken(null); secure.del(TOKEN_KEY); setUser(null); setSheet(null); });
    startBoot();
  }, [startBoot]);

  // لا يوجد SSE في React Native، فنستخدم استطلاعاً دورياً خفيفاً أثناء فتح التطبيق
  useEffect(() => {
    if (!user || isStaff(user)) return undefined;
    const tick = () => { if (AppState.currentState !== 'background') { refreshOrders(); loadNotes(true); refreshConfig(); } };
    const id = setInterval(tick, POLL_MS);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') tick(); });
    return () => { clearInterval(id); sub && sub.remove && sub.remove(); };
  }, [user, refreshOrders, loadNotes, refreshConfig]);

  useEffect(() => { if (user && !isStaff(user) && cartReady) store.set(cartKey(user), cart); }, [cart, user, cartReady]);

  const authDone = async (r) => {
    API.setToken(r.token); await secure.set(TOKEN_KEY, r.token);
    await store.setRaw(ROLE_KEY, isStaff(r.user) ? 'staff' : 'customer');
    setUser(r.user); setTab(isStaff(r.user) ? 'orders' : 'menu');
    if (isStaff(r.user)) registerForPush(API.api, '/api/admin').catch(() => {}); else await loadSession(r.user);
  };
  const actions = useMemo(() => ({
    toast, fail, startBoot, refreshOrders, loadNotes, refreshConfig,
    login: async (phone, password, admin) => authDone(await API.api('POST', admin ? '/api/admin/auth/login' : '/api/auth/login', { json: { phone, password }, quiet: true })),
    register: async (f) => authDone(await API.api('POST', '/api/auth/register', { json: { name: f.name, phone: f.phone, password: f.password, address: { label: f.label, text: f.text } }, quiet: true })),
    logout: async () => {
      try { await unregisterPush(API.api); } catch { /* تجاهل */ }
      try { await API.api('POST', isStaff(userRef.current) ? '/api/admin/auth/logout' : '/api/auth/logout', { json: {}, quiet: true }); } catch { /* تجاهل */ }
      API.setToken(null); await secure.del(TOKEN_KEY); setCartReady(false); setUser(null); setOrders([]); setCart([]); setSheet(null);
    },
    changeServer: async (url) => { await API.setBase(url); await startBoot(); },
    addToCart: (mid, qty, slot) => setCart((c) => {
      const ex = c.find((x) => x.mid === mid && x.slot === slot);
      if (ex) return c.map((x) => (x === ex ? { ...x, qty: Math.min(50, x.qty + qty) } : x));
      return [...c, { id: uid(), mid, qty, slot }];
    }),
    setQty: (id, qty) => setCart((c) => c.map((x) => (x.id === id ? { ...x, qty: Math.max(1, Math.min(50, qty)) } : x))),
    removeItem: (id) => setCart((c) => c.filter((x) => x.id !== id)),
    moveSlot: (from, to) => setCart((c) => c.map((x) => (x.slot === from ? { ...x, slot: to } : x))),
    clearCart: () => setCart([]),
    addAddress: async (label, text) => { const r = await API.api('POST', '/api/addresses', { json: { label, text } }); setAddresses((a) => [...a, r.address]); return r.address; },
    delAddress: async (id) => { await API.api('DELETE', `/api/addresses/${id}`); setAddresses((a) => a.filter((x) => x.id !== id)); },
    markNotesRead: async () => { await API.api('POST', '/api/notifications/read', { json: {} }); setNotes((n) => ({ list: n.list.map((x) => ({ ...x, read: 1 })), unread: 0 })); },
    repeatOrder: (order) => { const items = repeatItems(order, menu); setCart((c) => [...c, ...items]); return items.length; },
    setOm,
    bump: () => setRk((x) => x + 1),
    go: (t) => { setTab(t); setSheet(null); },
    open: (s) => setSheet(s),
    close: () => setSheet(null),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [menu, toast, fail, startBoot, refreshOrders, loadNotes, loadSession, refreshConfig]);

  const value = { boot, bootErr, cfg, menu, user, addresses, orders, notes, cart, tab, om, sheet, toastMsg, rk, ...actions };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

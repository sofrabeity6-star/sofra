'use strict';
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('./config');
const { AppError } = require('./errors');

const CUSTOMER_COOKIE = 'sofra_token';
const STAFF_COOKIE = 'sofra_staff';
const MAX_AGE_S = 60 * 60 * 24 * 14;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// أرقام الموبايل المصرية: 01[0125]xxxxxxxx
function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-()]/g, '');
  p = p.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  if (p.startsWith('+20')) p = '0' + p.slice(3);
  else if (p.startsWith('0020')) p = '0' + p.slice(4);
  else if (/^20\d{10}$/.test(p)) p = '0' + p.slice(2);
  return /^01[0125]\d{8}$/.test(p) ? p : null;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: MAX_AGE_S });
}

function setAuthCookie(res, token, name) {
  const parts = [`${name}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_S}`];
  if (config.isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAuthCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function readCookie(req, name) {
  const h = req.headers.cookie;
  if (!h) return null;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, phone: u.phone, role: u.role };
}

function makeAuth(db, cookieName, roles) {
  const getUser = (id) => db.one('SELECT id,name,phone,role,active FROM users WHERE id=?', id);
  // يحدد المستخدم الحالي إن وُجد، دون إجبار
  async function attach(req, _res, next) {
    // التطبيقات الأصلية (Expo) ترسل Bearer token، والمتصفح يستخدم الكوكي
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : readCookie(req, cookieName);
    if (token) {
      let payload = null;
      try { payload = jwt.verify(token, config.jwtSecret); } catch { /* توكن منتهي أو غير صالح */ }
      if (payload && Number.isSafeInteger(payload.sub)) {
        try {
          const u = await getUser(payload.sub);
          if (u && u.active && roles.includes(u.role)) req.user = u;
        } catch (e) { return next(e); }
      }
    }
    next();
  }
  const requireRole = (...roles) => (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'سجّل الدخول أولاً', 'unauthenticated'));
    if (roles.length && !roles.includes(req.user.role)) return next(new AppError(403, 'ليست لديك صلاحية لهذا الإجراء', 'forbidden'));
    next();
  };
  return { attach, requireRole };
}

// حماية CSRF: الطلبات المغيّرة للحالة يجب أن تحمل ترويسة مخصصة لا يمكن إرسالها من نموذج عبر موقع آخر
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.headers['x-requested-with'] !== 'sofra') return next(new AppError(403, 'طلب غير مصرح به', 'csrf'));
  next();
}

module.exports = { CUSTOMER_COOKIE, STAFF_COOKIE, hashPassword, verifyPassword, normalizePhone, signToken, setAuthCookie, clearAuthCookie, publicUser, makeAuth, csrfGuard };

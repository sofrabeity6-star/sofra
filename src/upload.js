'use strict';
const crypto = require('crypto');
const multer = require('multer');
const { AppError } = require('./errors');

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function sniffImage(b) {
  if (!b || b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

// الملف يبقى في الذاكرة حتى نتحقق منه، ثم يُحفظ في التخزين (Supabase أو القرص)
function makeUploader(maxMB) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMB * 1024 * 1024, files: 1, fields: 20 },
    fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new AppError(400, 'الملف يجب أن يكون صورة (JPG أو PNG أو WebP)', 'bad_file'))),
  });
}

/**
 * يتحقق أن الملف المرفوع صورة فعلاً (وليس مجرد امتداد) ثم يحفظه.
 * @returns {Promise<string|null>} اسم الملف المحفوظ
 */
async function storeUploaded(req, storage, kind) {
  if (!req.file) return null;
  const type = sniffImage(req.file.buffer);
  if (!type) throw new AppError(400, 'الملف المرفوع ليس صورة صالحة', 'bad_file');
  const name = crypto.randomBytes(16).toString('hex') + EXT[type];
  await storage.put(kind, name, req.file.buffer);
  return name;
}

module.exports = { makeUploader, storeUploaded, sniffImage };

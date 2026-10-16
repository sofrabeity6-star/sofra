'use strict';
// ملاحظة: آخر رقم في كل وجبة = «تصلح للطلب الفوري». الطاجن والبشاميل للطلب المجدول فقط (يحتاجان وقتاً أطول).
// يضيف تصنيفات ووجبات تجريبية إذا كان المنيو فارغاً:  npm run seed:demo
const config = require('../src/config');
const { openDb, getSettings, saveSettings } = require('../src/db');
const { ensureAdmin } = require('../src/bootstrap');

async function main() {
  const db = await openDb({ url: config.databaseUrl });
  try {
    await ensureAdmin(db);
    // حسابات تحويل ورقم مطبخ نموذجيان (أرقام وهمية للتجربة فقط). غيّرها من لوحة الإدارة ← الإعدادات.
    const cur = await getSettings(db);
    if (!cur.payment_accounts.length) {
      await saveSettings(db, { payment_accounts: [{ label: 'إنستاباي', value: 'sofra@instapay' }, { label: 'فودافون كاش', value: '01000000000' }], ...(cur.kitchen_phone ? {} : { kitchen_phone: '01000000000' }) });
      console.log('تمت إضافة حسابات تحويل ورقم مطبخ تجريبيين (غيّرهما من الإعدادات).');
    }
    if (await db.one('SELECT 1 FROM menu_items LIMIT 1')) { console.log('المنيو غير فارغ، لم يتم تغيير شيء.'); return; }
    const cats = ['طواجن', 'مشاوي', 'وجبات دايت', 'معجنات', 'حلويات'];
    const catId = {};
    for (const [i, c] of cats.entries()) {
      catId[c] = (await db.run('INSERT INTO categories(name,sort_order) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET sort_order=excluded.sort_order RETURNING id', c, i)).id;
    }
    const items = [
      ['طواجن', 'طاجن بامية باللحمة', 'بامية بلدي مع لحم ضاني وصلصة طماطم مطبوخة ببطء', 145, '🍲', 1, 0],
      ['طواجن', 'مكرونة بشاميل', 'بشاميل بالكفتة المفرومة وجبنة رومي', 95, '🥘', 1, 0],
      ['مشاوي', 'كفتة مشوية مع أرز', '٣ أسياخ كفتة مع أرز بالشعرية وسلطة', 130, '🍢', 1, 1],
      ['مشاوي', 'ربع فراخ مشوية', 'متبلة بالليمون والثوم، مع بطاطس وثومية', 110, '🍗', 0, 1],
      ['وجبات دايت', 'سلطة دجاج دايت', 'صدور دجاج مشوية مع خضار طازجة وصوص زبادي', 85, '🥗', 0, 1],
      ['وجبات دايت', 'صدور دجاج مع خضار سوتيه', 'بدون قلي، وزن الوجبة ٣٥٠ جرام', 105, '🥦', 0, 1],
      ['معجنات', 'فطيرة مشلتتة بالعسل', 'عجينة طبقات بالسمن البلدي مع عسل وقشطة', 70, '🥐', 1, 1],
      ['معجنات', 'بيتزا بيتي', 'عجينة منزلية بالجبنة والخضار', 90, '🍕', 0, 1],
      ['حلويات', 'أم علي', 'بالمكسرات وجوز الهند، تقدم ساخنة', 45, '🍮', 0, 1],
      ['حلويات', 'كنافة بالقشطة', 'كنافة ناعمة بقشطة طازجة وقطر خفيف', 60, '🍰', 0, 1],
    ];
    const now = new Date().toISOString();
    for (const [c, name, desc, price, emoji, pop, asap] of items) {
      await db.run('INSERT INTO menu_items(category_id,name,description,price_cents,emoji,popular,asap_ok,created_at) VALUES(?,?,?,?,?,?,?,?)',
        catId[c], name, desc, price * 100, emoji, pop, asap, now);
    }
    console.log(`تمت إضافة ${cats.length} تصنيفات و ${items.length} وجبات.`);
  } finally { await db.close(); }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

import React, { useEffect, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { B, Btn, Check, Chip, Field, Loading, Row, T } from '../ui';
import { useTheme } from '../theme';
import { useApp } from '../store';
import { api, appendImage, mediaUrl } from '../api';
import { pickImage } from '../imagepick';

// إضافة/تعديل وجبة (للمدير): الاسم، التصنيف، السعر، الوصف، الصورة، وخيارات الإتاحة
export default function AdminItemSheet({ id, categoryId }) {
  const { bump, close, toast, fail } = useApp();
  const c = useTheme();
  const [menu, setMenu] = useState(null);
  const [f, setF] = useState(null);
  const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);

  useEffect(() => {
    api('GET', '/api/admin/menu').then((m) => {
      setMenu(m);
      const it = id ? m.items.find((x) => x.id === id) : null;
      setF(it ? { name: it.name, category_id: it.category_id, price: String(it.price_cents / 100), emoji: it.emoji, description: it.description, available: !!it.available, popular: !!it.popular, asap_ok: !!it.asap_ok, image: it.image }
        : { name: '', category_id: categoryId || (m.categories[0] && m.categories[0].id), price: '', emoji: '🍽️', description: '', available: true, popular: false, asap_ok: true, image: null });
    }).catch(fail);
  }, [id, categoryId, fail]);

  if (!f || !menu) return <Loading />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const price = Math.round(parseFloat(String(f.price).replace(',', '.')) * 100);
    if (!f.name.trim()) return toast('اكتب اسم الوجبة', true);
    if (!(price >= 0)) return toast('اكتب سعراً صحيحاً', true);
    if (!f.category_id) return toast('اختر التصنيف', true);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('category_id', String(f.category_id)); fd.append('name', f.name); fd.append('description', f.description || '');
      fd.append('price_cents', String(price)); fd.append('emoji', f.emoji || '🍽️');
      ['available', 'popular', 'asap_ok'].forEach((k) => fd.append(k, f[k] ? '1' : '0'));
      if (asset) await appendImage(fd, 'image', asset, 'item.jpg');
      await api(id ? 'PATCH' : 'POST', `/api/admin/menu${id ? '/' + id : ''}`, { form: fd });
      toast('تم الحفظ'); bump(); close();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!del) return setDel(true);
    try { await api('DELETE', `/api/admin/menu/${id}`); toast('تم حذف الوجبة'); bump(); close(); } catch (e) { fail(e); }
  };
  const preview = asset ? asset.uri : f.image ? mediaUrl(f.image) : null;
  return (
    <View>
      <B size={20}>{id ? 'تعديل وجبة' : 'وجبة جديدة'}</B>
      <Field testID="item-name" label="الاسم" value={f.name} onChangeText={set('name')} />
      <T size={14} weight="500" style={{ marginTop: 6, marginBottom: 6 }}>التصنيف</T>
      <Row wrap gap={8}>{menu.categories.map((k) => <Chip key={k.id} testID={`item-cat-${k.id}`} on={f.category_id === k.id} label={k.name} onPress={() => setF({ ...f, category_id: k.id })} />)}</Row>
      <Row gap={10} center={false}>
        <View style={{ flex: 1 }}><Field testID="item-price" label="السعر (ج.م)" value={f.price} onChangeText={set('price')} keyboardType="decimal-pad" ltr /></View>
        <View style={{ flex: 1 }}><Field label="رمز تعبيري" value={f.emoji} onChangeText={set('emoji')} maxLength={8} /></View>
      </Row>
      <Field label="الوصف" multiline value={f.description} onChangeText={set('description')} maxLength={300} />
      <T size={14} weight="500" style={{ marginBottom: 6 }}>صورة الوجبة (اختياري)</T>
      <Row gap={8}>
        <Btn sm title="من المعرض" onPress={() => pickImage('gallery').then((a) => a && setAsset(a)).catch(fail)} />
        {Platform.OS !== 'web' ? <Btn sm title="التقاط صورة" onPress={() => pickImage('camera').then((a) => a && setAsset(a)).catch(fail)} /> : null}
      </Row>
      {preview ? <Image source={{ uri: preview }} style={{ width: 120, height: 120, borderRadius: 12, marginTop: 10, backgroundColor: c.tile }} /> : null}
      <Check testID="item-available" label="متاحة الآن" value={f.available} onChange={set('available')} />
      <Check label="ضمن «الأكثر طلباً»" value={f.popular} onChange={set('popular')} />
      <Check testID="item-asap" label="تصلح للطلب الفوري (تتجهز وتصل خلال مدة قصيرة)" value={f.asap_ok} onChange={set('asap_ok')} />
      <Btn testID="item-save" kind="primary" wide loading={busy} title="حفظ" onPress={save} style={{ marginTop: 10 }} />
      {id ? <Btn testID="item-delete" kind="danger" wide style={{ marginTop: 8 }} title={del ? 'نعم، احذف الوجبة' : 'حذف الوجبة'} onPress={remove} /> : null}
    </View>
  );
}

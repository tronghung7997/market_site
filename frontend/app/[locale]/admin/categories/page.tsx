"use client";

import * as React from "react";
import { motion } from "motion/react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { Button, Card, Field, Input, Select, Spinner, Tag } from "@/components/ui";
import { categoryCoverId, CoverPicker, ProductCover } from "@/features/product-covers";

type FlatCat = Category & { depth: number };

function flatten(cats: Category[], depth = 0): FlatCat[] {
  const out: FlatCat[] = [];
  for (const c of cats) {
    out.push({ ...c, depth });
    if (c.children?.length) out.push(...flatten(c.children, depth + 1));
  }
  return out;
}

const EMPTY = { name: "", slug: "", icon: "", parent_id: "", commission_rate: "", is_active: true };

export default function AdminCategoriesPage() {
  const [cats, setCats] = React.useState<Category[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState<Category | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState<typeof EMPTY>(EMPTY);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try { setCats(await api.categories()); } finally { setLoading(false); }
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const flat = React.useMemo(() => flatten(cats), [cats]);
  const topLevel = flat.filter((c) => c.depth === 0);
  const panelOpen = creating || editing !== null;

  const openCreate = () => { setEditing(null); setCreating(true); setForm(EMPTY); setErr(null); };
  const openEdit = (c: Category) => {
    setCreating(false);
    setEditing(c);
    setForm({
      name: c.name, slug: c.slug, icon: c.icon ?? "",
      parent_id: c.parent_id != null ? String(c.parent_id) : "",
      commission_rate: c.commission_rate != null ? String(c.commission_rate) : "",
      is_active: c.is_active,
    });
    setErr(null);
  };
  const closePanel = () => { setCreating(false); setEditing(null); setErr(null); };

  const save = async () => {
    if (!form.name.trim() || !form.slug.trim()) { setErr("Tên và slug là bắt buộc"); return; }
    setBusy(true); setErr(null);
    try {
      const commission = form.commission_rate.trim() === "" ? null : Number(form.commission_rate);
      if (editing) {
        await api.updateCategory(editing.id, {
          name: form.name.trim(), slug: form.slug.trim(),
          icon: form.icon || null,
          is_active: form.is_active, commission_rate: commission,
        });
      } else {
        await api.createCategory({
          name: form.name.trim(), slug: form.slug.trim(),
          icon: form.icon || null,
          parent_id: form.parent_id ? Number(form.parent_id) : null,
          commission_rate: commission,
        });
      }
      closePanel();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Lưu thất bại");
    } finally { setBusy(false); }
  };

  const remove = async (c: Category) => {
    if (!confirm(`Xoá danh mục "${c.name}"?`)) return;
    try { await api.deleteCategory(c.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : "Xoá thất bại"); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-slate-900">Danh mục</h1>
          <p className="text-[13px] text-slate-500 mt-0.5">Cây danh mục & tỷ lệ hoa hồng affiliate mặc định theo danh mục</p>
        </div>
        <Button onClick={openCreate}><Plus size={15} /> Thêm danh mục</Button>
      </div>

      {panelOpen && (
        <Card className="p-5 space-y-4 border-indigo-200 bg-indigo-50/30">
          <h2 className="text-[14px] font-semibold">{editing ? `Sửa: ${editing.name}` : "Danh mục mới"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tên"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Slug"><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="vd: tai-khoan" /></Field>
            {!editing && (
              <Field label="Danh mục cha" hint="Để trống nếu là cấp gốc">
                <Select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                  <option value="">— Cấp gốc —</option>
                  {topLevel.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Hoa hồng affiliate (%)" hint="Áp cho mọi sản phẩm trong danh mục (nếu sản phẩm không tự đặt)">
              <Input
                type="number" min={0} max={100} step="0.1"
                value={form.commission_rate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || (Number(v) >= 0 && Number(v) <= 100)) setForm({ ...form, commission_rate: v });
                }}
                placeholder="VD: 5"
              />
            </Field>
            {editing && (
              <Field label="Trạng thái">
                <Select value={form.is_active ? "1" : "0"} onChange={(e) => setForm({ ...form, is_active: e.target.value === "1" })}>
                  <option value="1">Đang bật</option>
                  <option value="0">Đã tắt</option>
                </Select>
              </Field>
            )}
          </div>
          <Field label="Hình ảnh" hint="Chọn một cover có sẵn. Để trống thì đoán theo tên danh mục.">
            <CoverPicker
              value={form.icon || null}
              onChange={(id) => setForm({ ...form, icon: id ?? "" })}
            />
          </Field>
          {err && <p className="text-[13px] text-red-600">{err}</p>}
          <div className="flex gap-2">
            <Button disabled={busy} onClick={save}>{busy ? "Đang lưu…" : "Lưu"}</Button>
            <Button variant="ghost" onClick={closePanel}>Huỷ</Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="grid place-items-center py-20"><Spinner /></div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-5 py-2.5 font-medium">Danh mục</th>
                    <th className="px-5 py-2.5 font-medium">Slug</th>
                    <th className="px-5 py-2.5 font-medium text-right">Hoa hồng</th>
                    <th className="px-5 py-2.5 font-medium">Trạng thái</th>
                    <th className="px-5 py-2.5 w-20" />
                  </tr>
                </thead>
                <tbody>
                  {flat.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-2.5">
                        <span style={{ paddingLeft: c.depth * 18 }} className="inline-flex items-center gap-1.5">
                          {c.depth > 0 && <span className="text-slate-300">└</span>}
                          <ProductCover coverId={categoryCoverId(c)} title={c.name} className="h-7 w-7" />
                          <span className="font-medium text-slate-800">{c.name}</span>
                        </span>
                      </td>
                      <td className="px-5 py-2.5 font-mono text-[12px] text-slate-500">{c.slug}</td>
                      <td className="px-5 py-2.5 text-right tabular-nums">
                        {c.commission_rate != null ? `${c.commission_rate}%` : <span className="text-slate-400">kế thừa</span>}
                      </td>
                      <td className="px-5 py-2.5">
                        {c.is_active ? <Tag tone="good">Bật</Tag> : <Tag tone="neutral">Tắt</Tag>}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => openEdit(c)} className="p-1.5 text-slate-400 hover:text-indigo-600 transition-colors" title="Sửa"><Pencil size={14} /></button>
                          <button onClick={() => remove(c)} className="p-1.5 text-slate-400 hover:text-red-600 transition-colors" title="Xoá"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {flat.length === 0 && (
                    <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-500">Chưa có danh mục nào.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

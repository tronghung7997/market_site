"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button, Card, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { Edit2, Plus, Trash, Upload } from "@/components/Icons";
import { useMoney } from "@/lib/money";
import { type WorkbenchVariant } from "./logic";
import { SellerPriceInput, useSellerPriceCurrency } from "./SellerPriceInput";

export function SellerVariantManager({
  variants,
  onAddVariant,
  onUpdateVariant,
  onDeleteVariant,
  onRestockVariant,
}: {
  variants: WorkbenchVariant[];
  onAddVariant: (data: {
    name: string;
    price: number;
    delivery_mode: "instant" | "manual";
    sla_hours: number;
  }) => Promise<void>;
  onUpdateVariant: (
    id: number,
    data: Partial<WorkbenchVariant>,
  ) => Promise<void>;
  onDeleteVariant: (id: number) => Promise<void>;
  onRestockVariant: (id: number, items: string[]) => Promise<void>;
}) {
  const locale = useLocale();
  const t = useTranslations("seller.workbench");
  const ts = useTranslations("seller");
  const tc = useTranslations("common");
  const { formatCheckoutMoney } = useMoney();
  const { currency: priceCurrency } = useSellerPriceCurrency();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState(85000);
  const [newMode, setNewMode] = useState<"instant" | "manual">("instant");
  const [newSla, setNewSla] = useState(24);
  const [savingNew, setSavingNew] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState(0);
  const [editMode, setEditMode] = useState<"instant" | "manual">("instant");
  const [editSla, setEditSla] = useState(24);
  const [savingEdit, setSavingEdit] = useState(false);

  const [restockId, setRestockId] = useState<number | null>(null);
  const [restockText, setRestockText] = useState("");
  const [restocking, setRestocking] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSavingNew(true);
    try {
      await onAddVariant({
        name: newName.trim(),
        price: newPrice || 0,
        delivery_mode: newMode,
        sla_hours: newSla || 24,
      });
      setNewName("");
      setAdding(false);
    } finally {
      setSavingNew(false);
    }
  };

  const handleEditSubmit = async () => {
    if (editingId == null || !editName.trim()) return;
    setSavingEdit(true);
    try {
      await onUpdateVariant(editingId, {
        name: editName.trim(),
        price: editPrice,
        delivery_mode: editMode,
        sla_hours: editSla,
      });
      setEditingId(null);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleRestockSubmit = async () => {
    if (!restockId) return;
    const items = restockText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    setRestocking(true);
    try {
      await onRestockVariant(restockId, items);
      setRestockId(null);
      setRestockText("");
    } finally {
      setRestocking(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
            {t("variantSectionEyebrow")}
          </span>
          <h3 className="text-[14px] font-bold text-fg">{t("variantSectionTitle")}</h3>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setAdding((v) => !v)}
        >
          <Plus size={13} /> {adding ? tc("close") : t("addNewPackage")}
        </Button>
      </div>

      {adding && (
        <div className="p-4 rounded-xl bg-surface border border-line space-y-3">
          <div className="text-[12.5px] font-bold text-fg">{t("addPackageFormTitle")}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("packageName")}>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("packageNamePlaceholder")}
              />
            </Field>
            <Field label={t("sellingPrice", { currency: priceCurrency })}>
              <SellerPriceInput amountVnd={newPrice} onAmountVndChange={setNewPrice} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("deliveryType")}>
              <Select
                value={newMode}
                onChange={(e) => setNewMode(e.target.value as "instant" | "manual")}
              >
                <option value="instant">{t("instantDeliveryOption")}</option>
                <option value="manual">{t("manualDeliveryOption")}</option>
              </Select>
            </Field>
            {newMode === "manual" && (
              <Field label={t("slaHoursLabel")}>
                <Input
                  type="number"
                  min={1}
                  value={newSla}
                  onChange={(e) => setNewSla(Number(e.target.value) || 24)}
                />
              </Field>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAdding(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={savingNew || !newName.trim()}
              onClick={handleCreate}
            >
              {savingNew ? t("addingPackage") : t("savePackage")}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {variants.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-muted border border-dashed border-line rounded-lg">
            {t("emptyPackages", { action: t("addNewPackage") })}
          </div>
        ) : (
          variants.map((v) => {
            const isInstant = v.delivery_mode === "instant";
            const editing = v.id != null && editingId === v.id;
            return (
              <div key={v.id ?? v.name} className="rounded-xl border border-line bg-surface p-3.5">
                {editing ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t("packageName")}>
                        <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
                      </Field>
                      <Field label={t("sellingPrice", { currency: priceCurrency })}>
                        <SellerPriceInput amountVnd={editPrice} onAmountVndChange={setEditPrice} />
                      </Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={t("deliveryType")}>
                        <Select value={editMode} onChange={(event) => setEditMode(event.target.value as "instant" | "manual")}>
                          <option value="instant">{t("instantDeliveryOption")}</option>
                          <option value="manual">{t("manualDeliveryOption")}</option>
                        </Select>
                      </Field>
                      {editMode === "manual" && (
                        <Field label={t("slaHoursLabel")}>
                          <Input type="number" min={1} value={editSla} onChange={(event) => setEditSla(Number(event.target.value) || 24)} />
                        </Field>
                      )}
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>{tc("cancel")}</Button>
                      <Button size="sm" disabled={savingEdit || !editName.trim()} onClick={handleEditSubmit}>
                        {savingEdit ? t("savingPackage") : t("savePackage")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-fg">{v.name}</span>
                        <Tag tone={isInstant ? "good" : "warn"}>
                          {isInstant ? t("instantDeliveryTag") : t("slaHoursTag", { hours: v.sla_hours || 24 })}
                        </Tag>
                      </div>
                      <div className="flex items-center gap-3 text-[12px] text-muted">
                        <span className="font-mono font-bold text-fg">{formatCheckoutMoney(v.price, { locale })}</span>
                        <span>•</span>
                        {isInstant ? (
                          <span className={v.stock_count > 0 ? "text-good font-medium" : "text-bad font-medium"}>
                            {t("stockReadyCount", { count: v.stock_count })}
                          </span>
                        ) : (
                          <span>{t("manualFulfillment")}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {v.id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingId(v.id!);
                            setEditName(v.name);
                            setEditPrice(v.price);
                            setEditMode(v.delivery_mode);
                            setEditSla(v.sla_hours || 24);
                          }}
                        >
                          <Edit2 size={12} /> {ts("edit")}
                        </Button>
                      )}
                      {isInstant && v.id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRestockId(v.id!);
                            setRestockText("");
                          }}
                        >
                          <Upload size={12} /> {t("restockAction")}
                        </Button>
                      )}
                      {v.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDeleteVariant(v.id!)}
                          className="text-bad hover:bg-bad-soft/50"
                          aria-label={ts("delete")}
                        >
                          <Trash size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {restockId && (
        <div className="p-4 rounded-xl border border-good/25 bg-good-soft/30 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[13px] font-bold text-fg">
              {t("restockTitle", { id: restockId })}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRestockId(null)}
              aria-label={tc("close")}
            >
              ✕
            </Button>
          </div>
          <Field label={t("restockListLabel")}>
            <Textarea
              rows={3}
              value={restockText}
              onChange={(e) => setRestockText(e.target.value)}
              placeholder="user1|pass1&#10;user2|pass2"
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRestockId(null)}
            >
              {tc("cancel")}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={restocking || !restockText.trim()}
              onClick={handleRestockSubmit}
            >
              {restocking ? t("restocking") : t("confirmRestockAction")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

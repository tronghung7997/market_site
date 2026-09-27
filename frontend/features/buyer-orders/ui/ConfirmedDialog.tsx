"use client";

/** Right after the buyer confirms receipt: a one-tap rating while the order
 *  is fresh in mind, and the ways back to the package and the shop. */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { productPath } from "@/lib/routes";
import { useApiErrorMessage } from "@/lib/use-api-error";
import type { Order } from "@/lib/types";
import { Button } from "@/components/ui";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, Star, Store } from "@/components/Icons";

export function ConfirmedDialog({ order, onClose, onReviewed }: {
  order: Order | null;
  onClose: () => void;
  onReviewed: (orderId: number) => void;
}) {
  const t = useTranslations("buyerOrders");
  const to = useTranslations("orders");
  const apiErrorMessage = useApiErrorMessage();
  const [rating, setRating] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const rate = async (stars: number) => {
    if (!order || state !== "idle") return;
    setRating(stars);
    setState("sending");
    setError("");
    try {
      await api.submitReview(order.id, stars);
      setState("sent");
      onReviewed(order.id);
    } catch (e) {
      setState("idle");
      setError(apiErrorMessage(e));
    }
  };

  const canRate = !!order && !order.has_review && !!order.product_key;
  const productHref = order?.product_key ? productPath({ slug: order.product_slug, public_key: order.product_key }) : null;

  return (
    <Dialog open={order !== null} onOpenChange={(open) => { if (!open) { onClose(); setRating(null); setState("idle"); setError(""); } }}>
      <DialogContent className="max-w-sm gap-3 rounded-2xl border-line bg-surface p-5 shadow-card-lg">
        <DialogTitle className="flex items-center gap-2 text-[15px] font-bold text-fg">
          <CheckCircle2 size={16} className="text-good" /> {t("confirmedTitle", { code: order?.order_code ?? "" })}
        </DialogTitle>
        <DialogDescription className="text-[12.5px] text-muted">{t("confirmedBody")}</DialogDescription>
        {canRate && (
          <div className="rounded-lg border border-line bg-raised/40 px-3 py-3">
            <p className="text-[12.5px] font-medium text-fg">
              {state === "sent" ? t("confirmedThanks") : t("confirmedRate")}
            </p>
            <div className="mt-2 flex gap-1" role="group" aria-label={t("confirmedRate")}>
              {[1, 2, 3, 4, 5].map((stars) => (
                <button
                  key={stars}
                  type="button"
                  disabled={state !== "idle"}
                  onClick={() => void rate(stars)}
                  aria-label={to("starAria", { n: stars })}
                  className="rounded p-1 hover:bg-surface disabled:cursor-default"
                >
                  <Star size={24} className={rating != null && stars <= rating ? "fill-warn text-warn" : "text-line-2"} />
                </button>
              ))}
            </div>
            {state !== "sent" && <p className="mt-1 text-[11.5px] text-faint">{t("confirmedRateHint")}</p>}
            {error && <p role="alert" className="mt-1 text-[12px] text-bad">{error}</p>}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {productHref ? (
            <Link href={productHref} onClick={onClose}><Button size="sm" variant="secondary" block>{t("confirmedBuyAgain")}</Button></Link>
          ) : <span />}
          {order?.seller_path ? (
            <Link href={order.seller_path} onClick={onClose}>
              <Button size="sm" variant="secondary" block className="gap-1.5"><Store size={13} /> {t("confirmedShop")}</Button>
            </Link>
          ) : <span />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

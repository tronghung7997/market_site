import type { SourceOffer } from "../../lib/types.ts";
import { matchesAllWords } from "../../lib/text-fold.ts";

/** One product of a proxy source laid out like the product's price grid:
 *  rows = type · network, columns = duration, one sold plan per cell. */
export interface ProductOfferGrid {
  productId: number;
  title: string;
  status: string;
  productKey: string | null;
  /** Type groups in first-appearance order, each with its networks. */
  types: { type: string; networks: string[] }[];
  days: number[];
  cells: Map<string, SourceOffer>;
  offers: SourceOffer[];
  attention: number;
  marginMin: number | null;
  marginMax: number | null;
}

export const cellKey = (type: string, network: string, days: number) => `${type}|${network}|${days}`;

/** A plan needs a look: below the margin floor, not mapped to an upstream plan,
 *  gone from the upstream catalog, or sold out upstream. */
export function needsAttention(offer: SourceOffer): boolean {
  return !offer.margin_ok || offer.unmapped || Boolean(offer.plan_missing) || offer.upstream_available === false;
}

/** Group a source's offers per product, in the order products first appear;
 *  types and networks keep first-appearance order, durations are ascending. */
export function groupOffers(offers: SourceOffer[]): ProductOfferGrid[] {
  const byProduct = new Map<number, ProductOfferGrid>();
  for (const offer of offers) {
    let grid = byProduct.get(offer.product_id);
    if (!grid) {
      grid = {
        productId: offer.product_id, title: offer.product_title, status: offer.product_status, productKey: offer.product_key,
        types: [], days: [], cells: new Map(), offers: [], attention: 0, marginMin: null, marginMax: null,
      };
      byProduct.set(offer.product_id, grid);
    }
    let group = grid.types.find((g) => g.type === offer.type);
    if (!group) {
      group = { type: offer.type, networks: [] };
      grid.types.push(group);
    }
    if (!group.networks.includes(offer.network)) group.networks.push(offer.network);
    if (!grid.days.includes(offer.days)) grid.days.push(offer.days);
    grid.cells.set(cellKey(offer.type, offer.network, offer.days), offer);
    grid.offers.push(offer);
    if (needsAttention(offer)) grid.attention += 1;
    if (offer.margin_pct != null) {
      grid.marginMin = grid.marginMin == null ? offer.margin_pct : Math.min(grid.marginMin, offer.margin_pct);
      grid.marginMax = grid.marginMax == null ? offer.margin_pct : Math.max(grid.marginMax, offer.margin_pct);
    }
  }
  for (const grid of byProduct.values()) grid.days.sort((a, b) => a - b);
  return [...byProduct.values()];
}

/** Products whose title or any plan (label, key, upstream name) matches. */
export function filterGrids(grids: ProductOfferGrid[], query: string): ProductOfferGrid[] {
  if (!query.trim()) return grids;
  return grids.filter((grid) =>
    matchesAllWords(grid.title, query)
    || grid.offers.some((o) => matchesAllWords(`${o.label} ${o.plan_key} ${o.external_name ?? ""}`, query)));
}

/** "50–150%" or "60%"; null when no plan has a known cost. */
export function marginRange(min: number | null, max: number | null): string | null {
  if (min == null || max == null) return null;
  return min === max ? `${min}%` : `${min}–${max}%`;
}

export interface OfferSummary {
  selling: number;
  products: number;
  attention: number;
  minPrice: number | null;
  maxPrice: number | null;
  marginMin: number | null;
  marginMax: number | null;
}

/** Source-wide numbers for the strip above the grids. */
export function summarizeOffers(grids: ProductOfferGrid[]): OfferSummary {
  const offers = grids.flatMap((g) => g.offers);
  const prices = offers.map((o) => o.price);
  const margins = grids.flatMap((g) => (g.marginMin == null || g.marginMax == null ? [] : [g.marginMin, g.marginMax]));
  return {
    selling: offers.length,
    products: grids.length,
    attention: grids.reduce((sum, g) => sum + g.attention, 0),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    marginMin: margins.length ? Math.min(...margins) : null,
    marginMax: margins.length ? Math.max(...margins) : null,
  };
}

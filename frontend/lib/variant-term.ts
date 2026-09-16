"use client";

import { useTranslations } from "next-intl";

/** What a product's variants are called in copy. Accounts are sold as
 *  "phân loại tài khoản" (2FA / aged / verified…), everything else — proxy,
 *  API credit, services — keeps the classic "gói" (package). */
export type VariantTermKind = "account" | "package";

export function variantTermKind(serviceType: string | null | undefined): VariantTermKind {
  return serviceType === "account" ? "account" : "package";
}

export interface VariantTerm {
  kind: VariantTermKind;
  /** lowercase, singular — "gói" / "phân loại tài khoản" */
  term: string;
  /** sentence-case, singular — "Gói" / "Phân loại tài khoản" */
  Term: string;
  /** lowercase, plural (EN only differs) */
  terms: string;
  /** sentence-case, plural */
  Terms: string;
}

const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Resolve the term for one product. Pass into message params as
 *  `{ ...term }` so copy can use {term} / {Term} / {terms} / {Terms}. */
export function useVariantTerm(serviceType: string | null | undefined): VariantTerm {
  const t = useTranslations("common.variantTerm");
  const kind = variantTermKind(serviceType);
  const term = t(kind);
  const terms = t(`${kind}Plural`);
  return { kind, term, Term: capitalize(term), terms, Terms: capitalize(terms) };
}

/** Same as {@link useVariantTerm} but for lists that mix products — returns a
 *  resolver so each row can pick its own wording without extra hooks. */
export function useVariantTermFor(): (serviceType: string | null | undefined) => VariantTerm {
  const t = useTranslations("common.variantTerm");
  return (serviceType) => {
    const kind = variantTermKind(serviceType);
    const term = t(kind);
    const terms = t(`${kind}Plural`);
    return { kind, term, Term: capitalize(term), terms, Terms: capitalize(terms) };
  };
}

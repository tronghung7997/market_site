import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { fetchPublicJson, pageMetadata } from "@/lib/seo";

type CategoryNode = { id: number; name: string; children?: CategoryNode[] };

function findCategory(nodes: CategoryNode[], id: number): CategoryNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children?.length) {
      const found = findCategory(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  const tree = await fetchPublicJson<CategoryNode[]>("/categories", locale);
  const category = tree ? findCategory(tree, Number(id)) : null;
  const name = category?.name ?? t("categoriesTitle");
  return pageMetadata({
    title: t("categoryTitle", { name }),
    description: t("categoryDescription", { name }),
    locale,
    path: `/categories/${id}`,
  });
}

export default function CategoryIdLayout({ children }: { children: ReactNode }) {
  return children;
}

"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useApiErrorMessage } from "@/lib/use-api-error";
import { useMoney } from "@/lib/money";
import { cn } from "@/lib/cn";
import {
  LatestRequestGate,
  canArchiveInventoryResource,
  canEditInventoryResource,
  canRestockInventoryResource,
  downloadRestockTemplate,
  isDefectiveReturnResource,
  isInstantDelivery,
  mergeRestockText,
  parseResourceItems,
  parseRestockFileContent,
} from "@/features/seller-inventory";
import { useDebounce } from "@/lib/hooks/useDebounce";
import { parseCoverId, ProductCover } from "@/features/product-covers";
import { SellerPriceInput, useSellerPriceCurrency } from "@/features/seller-workbench";
import type { InventoryVariant, Resource } from "@/lib/types";
import {
  Button,
  Card,
  Input,
  Monogram,
  Pagination,
  Select,
  Spinner,
  Tag,
  Textarea,
  Tooltip,
} from "@/components/ui";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash,
  Upload,
  X,
} from "@/components/Icons";

const LOW_STOCK = 5;
const PRODUCTS_PAGE_SIZE = 10;
const RESOURCES_PAGE_SIZE = 25;

type InventoryFilter = "all" | "out" | "low" | "error";

interface ProductGroup {
  id: number;
  title: string;
  variants: InventoryVariant[];
  totalAvailable: number;
  totalAssigned: number;
  hasLow: boolean;
  hasOut: boolean;
  hasError: boolean;
}

export default function InventoryPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-5 animate-pulse">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <div className="h-6 w-36 rounded bg-raised" />
              <div className="h-3.5 w-60 rounded bg-raised" />
            </div>
            <div className="h-8 w-24 rounded bg-raised" />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-raised border border-line" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 h-96 rounded-xl bg-raised border border-line" />
            <div className="lg:col-span-8 h-96 rounded-xl bg-raised border border-line" />
          </div>
        </div>
      }
    >
      <InventoryConsole />
    </Suspense>
  );
}

function InventoryConsole() {
  const t = useTranslations("seller");
  const locale = useLocale();
  const { formatBrowseMoney } = useMoney();
  const apiErrorMessage = useApiErrorMessage();
  const searchParams = useSearchParams();
  const targetVariantId = Number(searchParams.get("variant")) || null;
  const targetProductId = Number(searchParams.get("product")) || null;

  const [rows, setRows] = useState<InventoryVariant[]>([]);
  const [variantPrices, setVariantPrices] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [summaryLoadError, setSummaryLoadError] = useState(false);
  const [filter, setFilter] = useState<InventoryFilter>("all");
  const [productSearch, setProductSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [productPage, setProductPage] = useState(1);

  // Active variant resources state
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceTotal, setResourceTotal] = useState(0);
  const [loadingResources, setLoadingResources] = useState(false);
  const [resourceLoadError, setResourceLoadError] = useState(false);
  const [resourcePage, setResourcePage] = useState(1);
  const [resourcePageSize, setResourcePageSize] = useState(25);
  const [resourceStatusFilter, setResourceStatusFilter] = useState<"all" | "available" | "error" | "assigned" | "archived">("all");
  const [resourceSearch, setResourceSearch] = useState("");
  const debouncedResourceSearch = useDebounce(resourceSearch, 250);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<number>>(new Set());
  const [bulkOperating, setBulkOperating] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const resourceRequestGate = useRef(new LatestRequestGate());

  // Fast restock state
  const [restockText, setRestockText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [restocking, setRestocking] = useState(false);
  const [restockError, setRestockError] = useState<string | null>(null);
  const [restockSuccess, setRestockSuccess] = useState<number | null>(null);

  // Modals state
  const [activeDetailResource, setActiveDetailResource] = useState<Resource | null>(null);
  const [isCreateVariantOpen, setIsCreateVariantOpen] = useState(false);
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const restockPanelRef = useRef<HTMLDivElement>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setSummaryLoadError(false);
    try {
      const summary = await api.inventorySummary({ perPage: 100 });
      setRows(summary.items.filter((row) => isInstantDelivery(row.delivery_mode)));
    } catch {
      setSummaryLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Load resources for selected variant
  const loadVariantResources = useCallback(
    async (
      variantId: number,
      page = 1,
      statusFilter = resourceStatusFilter,
      searchQuery = debouncedResourceSearch,
      perPage = resourcePageSize,
    ) => {
      const request = resourceRequestGate.current.begin();
      setLoadingResources(true);
      setResourceLoadError(false);
      try {
        const res = await api.sellerVariantResources(variantId, {
          page,
          perPage,
          status: statusFilter !== "all" && statusFilter !== "archived" ? statusFilter : undefined,
          search: searchQuery.trim() || undefined,
          archivedOnly: statusFilter === "archived",
        });
        if (!resourceRequestGate.current.isCurrent(request)) return;
        setResources(res.items);
        setResourceTotal(res.total);
      } catch {
        if (!resourceRequestGate.current.isCurrent(request)) return;
        setResources([]);
        setResourceTotal(0);
        setResourceLoadError(true);
      } finally {
        if (resourceRequestGate.current.isCurrent(request)) {
          setLoadingResources(false);
        }
      }
    },
    [resourceStatusFilter, debouncedResourceSearch, resourcePageSize],
  );

  // Fetch prices for selected product's variants
  useEffect(() => {
    if (selectedProductId) {
      api.sellerProduct(selectedProductId)
        .then((detail) => {
          const map: Record<number, number> = {};
          for (const v of detail.variants || []) {
            map[v.id] = v.price;
          }
          setVariantPrices((prev) => ({ ...prev, ...map }));
        })
        .catch(() => {});
    }
  }, [selectedProductId]);

  // Group rows by product with accurate total-level status
  const productGroups: ProductGroup[] = useMemo(() => {
    const map = new Map<number, { id: number; title: string; variants: InventoryVariant[] }>();
    for (const r of rows) {
      const g = map.get(r.product_id) ?? { id: r.product_id, title: r.product_title, variants: [] };
      g.variants.push(r);
      map.set(r.product_id, g);
    }

    return Array.from(map.values()).map((g) => {
      const totalAvailable = g.variants.reduce((acc, v) => acc + v.available, 0);
      const totalAssigned = g.variants.reduce((acc, v) => acc + v.assigned, 0);
      const hasOut = totalAvailable === 0;
      const hasLow = totalAvailable > 0 && totalAvailable <= 10;
      const hasError = g.variants.some((v) => v.error > 0);

      return {
        ...g,
        totalAvailable,
        totalAssigned,
        hasLow,
        hasOut,
        hasError,
      };
    });
  }, [rows]);

  // Handle URL query target (product or variant)
  useEffect(() => {
    if (targetProductId && productGroups.length > 0) {
      const match = productGroups.find((g) => g.id === targetProductId);
      if (match) {
        setSelectedProductId(match.id);
        if (match.variants.length > 0) {
          setSelectedVariantId(match.variants[0].variant_id);
        }
        setFilter("all");
      }
    } else if (targetVariantId && rows.length > 0) {
      const match = rows.find((r) => r.variant_id === targetVariantId);
      if (match) {
        setSelectedProductId(match.product_id);
        setSelectedVariantId(match.variant_id);
        setFilter("all");
        setIsRestockOpen(true);
        const idx = productGroups.findIndex((g) => g.id === match.product_id);
        if (idx !== -1) {
          setProductPage(Math.floor(idx / PRODUCTS_PAGE_SIZE) + 1);
        }
        setTimeout(() => {
          restockPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          const textarea = restockPanelRef.current?.querySelector("textarea");
          textarea?.focus();
        }, 120);
      }
    }
  }, [targetProductId, targetVariantId, productGroups, rows]);



  // Set default selected product and variant if not set
  useEffect(() => {
    if (productGroups.length > 0 && selectedProductId === null) {
      const first = productGroups[0];
      setSelectedProductId(first.id);
      if (first.variants.length > 0) {
        setSelectedVariantId(first.variants[0].variant_id);
      }
    }
  }, [productGroups, selectedProductId]);

  useEffect(() => {
    setResourcePage(1);
    setResourceSearch("");
    setResourceStatusFilter("all");
    setSelectedResourceIds(new Set());
    setRestockText("");
    setUploadedFileName(null);
    setRestockError(null);
    setRestockSuccess(null);
  }, [selectedVariantId]);

  useEffect(() => {
    setResourcePage(1);
    setSelectedResourceIds(new Set());
  }, [resourceStatusFilter, debouncedResourceSearch, resourcePageSize]);

  useEffect(() => {
    if (selectedVariantId) {
      void loadVariantResources(
        selectedVariantId,
        resourcePage,
        resourceStatusFilter,
        debouncedResourceSearch,
        resourcePageSize,
      );
    }
  }, [
    selectedVariantId,
    resourcePage,
    resourceStatusFilter,
    debouncedResourceSearch,
    resourcePageSize,
    loadVariantResources,
  ]);

  // Summary Metrics
  const totalAvailable = rows.reduce((s, r) => s + r.available, 0);
  const outCount = rows.filter((r) => r.available === 0).length;
  const lowCount = rows.filter((r) => r.available > 0 && r.available <= LOW_STOCK).length;
  const errorCount = rows.filter((r) => r.error > 0).length;
  const outProductCount = productGroups.filter((group) => group.hasOut).length;

  // Filtered product groups for left column
  const filteredProducts = useMemo(() => {
    return productGroups.filter((g) => {
      if (filter === "out" && !g.hasOut) return false;
      if (filter === "low" && !g.hasLow) return false;
      if (filter === "error" && !g.hasError) return false;

      if (productSearch.trim()) {
        const q = productSearch.toLowerCase().trim();
        const matchTitle = g.title.toLowerCase().includes(q);
        const matchId = String(g.id).includes(q);
        const matchVariant = g.variants.some((v) => v.variant_name.toLowerCase().includes(q));
        if (!matchTitle && !matchId && !matchVariant) return false;
      }
      return true;
    });
  }, [productGroups, filter, productSearch]);

  // Paginated product list
  const totalProductPages = Math.ceil(filteredProducts.length / PRODUCTS_PAGE_SIZE);
  const paginatedProducts = useMemo(() => {
    const start = (productPage - 1) * PRODUCTS_PAGE_SIZE;
    return filteredProducts.slice(start, start + PRODUCTS_PAGE_SIZE);
  }, [filteredProducts, productPage]);

  // Active product group
  const activeProduct = useMemo(() => {
    return productGroups.find((g) => g.id === selectedProductId) || productGroups[0] || null;
  }, [productGroups, selectedProductId]);

  // Active variant
  const activeVariant = useMemo(() => {
    if (!activeProduct) return null;
    return activeProduct.variants.find((v) => v.variant_id === selectedVariantId) || activeProduct.variants[0] || null;
  }, [activeProduct, selectedVariantId]);

  useEffect(() => {
    if (activeVariant && activeVariant.available === 0) {
      setIsRestockOpen(true);
    }
  }, [activeVariant?.variant_id, activeVariant?.available]);

  // Parsed restock lines
  const parsedRestockItems = useMemo(
    () => parseResourceItems(restockText, autoDedupe),
    [restockText, autoDedupe],
  );

  const handleDownloadTemplate = (format: "txt" | "csv") => {
    downloadRestockTemplate(format, "sample_inventory_template");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      if (!raw) return;
      setRestockText((prev) => mergeRestockText(prev, parseRestockFileContent(file.name, raw)));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleFastRestock = async () => {
    if (!activeVariant) return;
    if (parsedRestockItems.length === 0) {
      setRestockError(t("inventoryResourcesRequired"));
      return;
    }

    setRestocking(true);
    setRestockError(null);
    try {
      const result = await api.addResources(activeVariant.variant_id, parsedRestockItems);
      setRestockSuccess(result.count);
      setRestockText("");
      await loadSummary();
      await loadVariantResources(
        activeVariant.variant_id,
        resourcePage,
        resourceStatusFilter,
        debouncedResourceSearch,
        resourcePageSize,
      );
      setTimeout(() => setRestockSuccess(null), 3000);
    } catch (err: unknown) {
      setRestockError(apiErrorMessage(err, t("inventoryAddFailed")));
    } finally {
      setRestocking(false);
    }
  };

  const toggleSelectResource = (id: number) => {
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isAllPageSelected =
    resources.length > 0 && resources.every((r) => selectedResourceIds.has(r.id));

  const toggleSelectAllPage = () => {
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      if (isAllPageSelected) {
        for (const r of resources) next.delete(r.id);
      } else {
        for (const r of resources) next.add(r.id);
      }
      return next;
    });
  };

  const handleDeleteResource = async (resourceId: number) => {
    if (!confirm(t("inventoryDeleteConfirm"))) return;
    try {
      await api.deleteResource(resourceId);
      setResources((prev) => prev.filter((r) => r.id !== resourceId));
      setSelectedResourceIds((prev) => {
        const next = new Set(prev);
        next.delete(resourceId);
        return next;
      });
      setResourceTotal((n) => Math.max(0, n - 1));
      if (activeDetailResource?.id === resourceId) {
        setActiveDetailResource(null);
      }
      await loadSummary();
    } catch (err: unknown) {
      alert(apiErrorMessage(err, t("inventoryDeleteFailed")));
    }
  };

  const handleRestockSingle = async (resourceId: number, data: string) => {
    try {
      await api.restockResource(resourceId, data);
      await loadSummary();
      if (activeVariant) {
        await loadVariantResources(
          activeVariant.variant_id,
          resourcePage,
          resourceStatusFilter,
          debouncedResourceSearch,
          resourcePageSize,
        );
      }
      if (activeDetailResource?.id === resourceId) {
        setActiveDetailResource(null);
      }
    } catch (err: unknown) {
      alert(apiErrorMessage(err, t("inventorySaveFailed")));
    }
  };

  const handleArchiveSingle = async (resourceId: number) => {
    if (!confirm(t("inventoryArchiveConfirm"))) return;
    try {
      await api.archiveResource(resourceId);
      setSelectedResourceIds((prev) => {
        const next = new Set(prev);
        next.delete(resourceId);
        return next;
      });
      if (activeDetailResource?.id === resourceId) {
        setActiveDetailResource(null);
      }
      await loadSummary();
      if (activeVariant) {
        await loadVariantResources(
          activeVariant.variant_id,
          resourcePage,
          resourceStatusFilter,
          debouncedResourceSearch,
          resourcePageSize,
        );
      }
    } catch (err: unknown) {
      alert(apiErrorMessage(err, t("inventoryDeleteFailed")));
    }
  };

  const handleRestoreSingle = async (resourceId: number) => {
    try {
      await api.restoreResource(resourceId);
      setSelectedResourceIds((prev) => {
        const next = new Set(prev);
        next.delete(resourceId);
        return next;
      });
      if (activeDetailResource?.id === resourceId) setActiveDetailResource(null);
      await loadSummary();
      if (activeVariant) {
        await loadVariantResources(
          activeVariant.variant_id,
          resourcePage,
          resourceStatusFilter,
          debouncedResourceSearch,
          resourcePageSize,
        );
      }
    } catch (err: unknown) {
      alert(apiErrorMessage(err, t("inventoryRestoreFailed")));
    }
  };

  const handleBulkArchive = async () => {
    if (!activeVariant || selectedResourceIds.size === 0) return;
    const count = selectedResourceIds.size;
    if (!confirm(t("inventoryBulkArchiveConfirm", { count }))) return;

    setBulkOperating(true);
    setBulkMessage(null);
    try {
      const result = await api.bulkResourceAction(
        activeVariant.variant_id,
        "archive",
        Array.from(selectedResourceIds),
      );
      setSelectedResourceIds(new Set());
      setBulkMessage({
        type: "success",
        text: t("inventoryArchiveSuccess", { count: result.count }),
      });
      await loadSummary();
      await loadVariantResources(
        activeVariant.variant_id,
        resourcePage,
        resourceStatusFilter,
        debouncedResourceSearch,
        resourcePageSize,
      );
      setTimeout(() => setBulkMessage(null), 3500);
    } catch (err: unknown) {
      setBulkMessage({
        type: "error",
        text: apiErrorMessage(err, t("inventoryDeleteFailed")),
      });
    } finally {
      setBulkOperating(false);
    }
  };

  const handleBulkRestore = async () => {
    if (!activeVariant || selectedResourceIds.size === 0) return;
    const count = selectedResourceIds.size;
    if (!confirm(t("inventoryBulkRestoreConfirm", { count }))) return;
    setBulkOperating(true);
    setBulkMessage(null);
    try {
      const result = await api.bulkResourceAction(
        activeVariant.variant_id,
        "restore",
        Array.from(selectedResourceIds),
      );
      setSelectedResourceIds(new Set());
      setBulkMessage({ type: "success", text: t("inventoryRestoreSuccess", { count: result.count }) });
      await loadSummary();
      await loadVariantResources(activeVariant.variant_id, resourcePage, resourceStatusFilter, debouncedResourceSearch, resourcePageSize);
      setTimeout(() => setBulkMessage(null), 3500);
    } catch (err: unknown) {
      setBulkMessage({ type: "error", text: apiErrorMessage(err, t("inventoryRestoreFailed")) });
    } finally {
      setBulkOperating(false);
    }
  };

  const handleUpdateResourceSuccess = (updated: Resource) => {
    setResources((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setActiveDetailResource(updated);
  };

  // Smart Export: Exports selected items or by current view/tab filter
  const handleExportResources = async (type: "txt" | "csv") => {
    if (!activeVariant) return;

    if (selectedResourceIds.size > 0) {
      const exportItems = resources.filter((r) => selectedResourceIds.has(r.id));
      if (exportItems.length === 0) return;
      const content = type === "csv"
        ? "ID,Status,Data,Order,Created At\n" + exportItems.map((r) => `${r.id},${r.status},"${r.data.replace(/"/g, '""')}",${r.order_id ?? ""},${r.created_at}`).join("\n")
        : exportItems.map((r) => r.data).join("\n");
      const blob = new Blob([content], { type: type === "csv" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `inventory_var_${activeVariant.variant_id}_selected_${selectedResourceIds.size}.${type}`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }

    const url = api.sellerResourceExportUrl(activeVariant.variant_id, {
      format: type,
      status: resourceStatusFilter !== "all" && resourceStatusFilter !== "archived" ? resourceStatusFilter : undefined,
      search: debouncedResourceSearch,
      archivedOnly: resourceStatusFilter === "archived",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.click();
  };

  const totalResourcePages = Math.max(1, Math.ceil(resourceTotal / resourcePageSize));
  const paginatedResources = resources;

  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-6 w-36 rounded bg-raised" />
            <div className="h-3.5 w-60 rounded bg-raised" />
          </div>
          <div className="h-8 w-24 rounded bg-raised" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-raised border border-line" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-4 h-96 rounded-xl bg-raised border border-line" />
          <div className="lg:col-span-8 h-96 rounded-xl bg-raised border border-line" />
        </div>
      </div>
    );
  }

  if (summaryLoadError && rows.length === 0) {
    return (
      <div className="space-y-5 animate-fade">
        <div>
          <h1 className="text-[20px] font-bold text-fg tracking-tight">{t("inventoryTitle")}</h1>
        </div>
        <Card className="p-10 text-center">
          <AlertCircle size={32} className="mx-auto text-bad mb-2" />
          <p className="text-[13.5px] font-medium text-fg mb-3">{t("inventoryLoadFailed")}</p>
          <Button size="sm" variant="secondary" onClick={loadSummary}>{t("retry")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade">
      {/* Top Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-fg tracking-tight">{t("inventoryTitle")}</h1>
          <p className="text-[12.5px] text-muted">{t("inventorySummary", { count: totalAvailable })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" onClick={loadSummary} className="gap-1.5">
            <RefreshCw size={13} />
            <span>{t("refresh")}</span>
          </Button>
          {activeProduct && (
            <Button
              size="sm"
              onClick={() => setIsCreateVariantOpen(true)}
              className="gap-1.5 shadow-sm"
            >
              <Plus size={13} />
              <span>{t("createVariantQuick")}</span>
            </Button>
          )}
        </div>
      </div>

      {summaryLoadError && (
        <Card className="p-3 flex items-center justify-between gap-3 border-bad/30">
          <span className="text-xs text-bad">{t("inventoryLoadFailed")}</span>
          <Button size="sm" variant="secondary" onClick={loadSummary}>{t("retry")}</Button>
        </Card>
      )}

      {/* 4 Clickable KPI Summary Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          onClick={() => { setFilter("all"); setProductPage(1); }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-good/50 hover:shadow-xs",
            filter === "all" && "ring-2 ring-iris/40 border-iris/50"
          )}
        >
          <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
            <span>{t("inventoryTotalAvailable")}</span>
            <span className="text-good">
              <CheckCircle2 size={15} />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular text-fg">
            {totalAvailable.toLocaleString()}{" "}
            <span className="text-xs font-normal text-faint font-sans">{t("itemsUnit")}</span>
          </div>
          <div className="text-[11px] text-good font-medium mt-1">{t("inventoryReadyHint")}</div>
        </Card>

        <Card
          onClick={() => { setFilter(filter === "low" ? "all" : "low"); setProductPage(1); }}
          className={cn(
            "p-3.5 flex flex-col justify-between border-warn/30 bg-warn-soft/20 cursor-pointer transition-all hover:border-warn/60 hover:shadow-xs",
            filter === "low" && "ring-2 ring-warn/50 border-warn bg-warn-soft/40"
          )}
        >
          <div className="flex items-center justify-between text-warn text-[12px] font-medium mb-1">
            <span>{t("inventoryLowPackages")}</span>
            <AlertTriangle size={15} />
          </div>
          <div className="text-2xl font-bold font-mono tabular text-warn">
            {lowCount}{" "}
            <span className="text-xs font-normal text-muted font-sans">{t("variants").toLowerCase()}</span>
          </div>
          <div className="text-[11px] text-warn font-medium mt-1">{t("inventoryReplenishHint")}</div>
        </Card>

        <Card
          onClick={() => { setFilter(filter === "out" ? "all" : "out"); setProductPage(1); }}
          className={cn(
            "p-3.5 flex flex-col justify-between border-bad/30 bg-bad-soft/20 cursor-pointer transition-all hover:border-bad/60 hover:shadow-xs",
            filter === "out" && "ring-2 ring-bad/50 border-bad bg-bad-soft/40"
          )}
        >
          <div className="flex items-center justify-between text-bad text-[12px] font-medium mb-1">
            <span>{t("inventoryOutPackages")}</span>
            <AlertCircle size={15} />
          </div>
          <div className="text-2xl font-bold font-mono tabular text-bad">
            {outCount}{" "}
            <span className="text-xs font-normal text-muted font-sans">{t("variants").toLowerCase()}</span>
          </div>
          <div className="text-[11px] text-bad font-medium mt-1">
            {t("inventoryOutProductsHint", { count: outProductCount })}
          </div>
        </Card>

        <Card
          onClick={() => { setFilter(filter === "error" ? "all" : "error"); setProductPage(1); }}
          className={cn(
            "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-bad/50 hover:shadow-xs",
            filter === "error" && "ring-2 ring-bad/50 border-bad/50 bg-bad-soft/20"
          )}
        >
          <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
            <span>{t("inventoryErrorResources")}</span>
            <span className="text-bad">
              <AlertCircle size={15} />
            </span>
          </div>
          <div className="text-2xl font-bold font-mono tabular text-fg">
            {errorCount}{" "}
            <span className="text-xs font-normal text-faint font-sans">{t("itemsUnit")}</span>
          </div>
          <div className="text-[11px] text-faint font-medium mt-1">{t("inventoryErrorHint")}</div>
        </Card>
      </div>

      {productGroups.length === 0 ? (
        <Card className="p-10 text-center">
          <Package size={36} className="mx-auto text-faint mb-3" />
          <p className="text-[14px] font-medium text-fg mb-1">{t("inventoryEmpty")}</p>
          <p className="text-[12.5px] text-muted mb-4 max-w-md mx-auto">
            {t("inventoryEmptyDescription")}
          </p>
          <Link href="/seller/products/new">
            <Button size="md">
              <Plus size={15} />
              <span>{t("inventoryCreateFirst")}</span>
            </Button>
          </Link>
        </Card>
      ) : (
        /* OPTION A+ MASTER-DETAIL WORKBENCH */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          
          {/* ======================================================== */}
          {/* LEFT COLUMN (4 cols): PRODUCT MASTER SELECTOR LIST */}
          {/* ======================================================== */}
          <div className="lg:col-span-4">
            <Card className="p-0 overflow-hidden">
              {/* Filter & Search Header */}
              <div className="p-3 border-b border-line bg-raised/30 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-fg">
                  <span>{t("inventoryProducts")}</span>
                  <span className="text-faint font-mono text-[11px]">{t("inventoryProductsCount", { count: filteredProducts.length })}</span>
                </div>

                <div className="relative">
                  <span className="absolute left-2.5 top-2.5 text-faint pointer-events-none">
                    <Search size={13} />
                  </span>
                  <Input
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setProductPage(1);
                    }}
                    placeholder={t("inventorySearchPlaceholder")}
                    className="h-8 pl-8 pr-7 text-xs rounded-lg"
                  />
                  {productSearch && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProductSearch("")}
                      className="absolute right-1 top-1 h-6 w-6 p-0 text-faint hover:text-fg"
                    >
                      <X size={12} />
                    </Button>
                  )}
                </div>

                {/* Filter Pills */}
                <div className="flex items-center gap-1 overflow-x-auto pt-1 text-xs">
                  <Button
                    size="sm"
                    variant={filter === "all" ? "secondary" : "ghost"}
                    onClick={() => { setFilter("all"); setProductPage(1); }}
                    className={cn("h-6.5 px-2 text-[11.5px] rounded-md", filter === "all" && "bg-surface shadow-xs font-semibold")}
                  >
                    {t("filterAll")}
                  </Button>
                  {outCount > 0 && (
                    <Button
                      size="sm"
                      variant={filter === "out" ? "secondary" : "ghost"}
                      onClick={() => { setFilter("out"); setProductPage(1); }}
                      className={cn("h-6.5 px-2 text-[11.5px] text-bad rounded-md", filter === "out" && "bg-surface shadow-xs font-semibold")}
                    >
                      {t("inventoryFilterOutProducts")}
                    </Button>
                  )}
                  {lowCount > 0 && (
                    <Button
                      size="sm"
                      variant={filter === "low" ? "secondary" : "ghost"}
                      onClick={() => { setFilter("low"); setProductPage(1); }}
                      className={cn("h-6.5 px-2 text-[11.5px] text-warn rounded-md", filter === "low" && "bg-surface shadow-xs font-semibold")}
                    >
                      {t("filterLowStock")}
                    </Button>
                  )}
                  {errorCount > 0 && (
                    <Button
                      size="sm"
                      variant={filter === "error" ? "secondary" : "ghost"}
                      onClick={() => { setFilter("error"); setProductPage(1); }}
                      className={cn("h-6.5 px-2 text-[11.5px] text-bad rounded-md", filter === "error" && "bg-surface shadow-xs font-semibold")}
                    >
                      {t("inventoryErrorFilter", { count: errorCount })}
                    </Button>
                  )}
                </div>
              </div>

              {/* Product Items List */}
              {paginatedProducts.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted">
                  {t("inventoryNoProductMatch")}
                </div>
              ) : (
                <div className="divide-y divide-line max-h-[560px] overflow-y-auto">
                  {paginatedProducts.map((p) => {
                    const isSelected = selectedProductId === p.id;
                    const isOutOfStock = p.totalAvailable === 0;
                    const isLowStock = p.totalAvailable > 0 && p.totalAvailable <= 10;
                    const stockTone = isOutOfStock ? "bad" : isLowStock ? "warn" : "good";
                    const stockLabel = isOutOfStock ? t("outOfStockLabel") : isLowStock ? t("lowStockLabel") : t("inStockLabel");

                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          setSelectedProductId(p.id);
                          if (p.variants.length > 0) {
                            setSelectedVariantId(p.variants[0].variant_id);
                          }
                        }}
                        className={cn(
                          "p-3 cursor-pointer transition-all space-y-1.5 text-xs text-left",
                          isSelected
                            ? "bg-iris-soft/40 border-l-4 border-iris"
                            : "hover:bg-raised/50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-7 w-7 rounded-md shrink-0 text-[11px]" />
                            <div className="min-w-0">
                              <h4 className="font-semibold text-fg text-[12.5px] truncate max-w-[170px]" title={p.title}>
                                {p.title}
                              </h4>
                              <span className="text-[10.5px] text-faint font-mono">#{p.id}</span>
                            </div>
                          </div>
                          <Tag tone={stockTone} className="shrink-0 text-[10px]">
                            {stockLabel}
                          </Tag>
                        </div>

                        <div className="flex items-center justify-between text-[11px] text-muted pt-0.5">
                          <span>{t("packagesCount", { count: p.variants.length })}</span>
                          <span className="font-mono font-bold text-fg">
                            {t("stockCountShort", { count: p.totalAvailable.toLocaleString() })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sidebar Pagination */}
              {totalProductPages > 1 && (
                <div className="p-2 border-t border-line bg-raised/20 flex items-center justify-between text-[11px] text-muted">
                  <span>{t("pageOf", { page: productPage, pages: totalProductPages })}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={productPage === 1}
                      onClick={() => setProductPage((prev) => Math.max(1, prev - 1))}
                      className="h-6 px-1.5 text-[11px]"
                    >
                      {t("previous")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={productPage === totalProductPages}
                      onClick={() => setProductPage((prev) => Math.min(totalProductPages, prev + 1))}
                      className="h-6 px-1.5 text-[11px]"
                    >
                      {t("next")}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          </div>


          {/* ======================================================== */}
          {/* RIGHT COLUMN (8 cols): ACTIVE PRODUCT & VARIANT WORKBENCH */}
          {/* ======================================================== */}
          <div className="lg:col-span-8 space-y-4">
            {activeProduct ? (
              <>
                {/* ACTIVE PRODUCT CONTEXT BANNER */}
                <Card className="p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProductCover coverId={parseCoverId(activeProduct)} title={activeProduct.title} className="h-10 w-10 rounded-xl shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-iris bg-iris-soft px-1.5 py-0.5 rounded leading-none">
                            {t("managingInventoryFor")}
                          </span>
                          <span className="text-xs text-faint font-mono">ID #{activeProduct.id}</span>
                        </div>
                        <h2 className="text-[15px] font-bold text-fg truncate max-w-[380px] mt-0.5" title={activeProduct.title}>
                          {activeProduct.title}
                        </h2>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Link href={`/products/${activeProduct.id}`} title={t("viewPurchasePage")}>
                        <Button size="sm" variant="secondary" className="gap-1 text-xs h-8">
                          <ExternalLink size={12} />
                          <span>{t("viewPurchasePage")}</span>
                        </Button>
                      </Link>
                      <Link href={`/seller/products/${activeProduct.id}`} title={t("edit")}>
                        <Button size="sm" variant="secondary" className="gap-1 text-xs h-8">
                          <Edit2 size={12} />
                          <span>{t("edit")}</span>
                        </Button>
                      </Link>
                    </div>
                  </div>

                  {/* REFINED VARIANT SELECTOR (Responsive Grid Cards with Price & Stock) */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-fg flex items-center gap-1.5">
                        <Package size={13} className="text-iris" />
                        <span>{t("inventoryVariantList", { count: activeProduct.variants.length })}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsCreateVariantOpen(true)}
                        className="text-xs text-iris hover:text-iris-hi gap-1 h-7 font-semibold"
                      >
                        <Plus size={13} />
                        <span>{t("createVariantQuick")}</span>
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeProduct.variants.map((v) => {
                        const isVarSelected = activeVariant?.variant_id === v.variant_id;
                        const varTone = v.available === 0 ? "bad" : v.available <= LOW_STOCK ? "warn" : "good";
                        const toneLabel = v.available === 0
                          ? t("stockOutCount", { count: 0 })
                          : v.available <= LOW_STOCK
                            ? t("stockLowCount", { count: v.available })
                            : t("stockCountItems", { count: v.available });
                        const priceNum = variantPrices[v.variant_id];

                        return (
                          <div
                            key={v.variant_id}
                            onClick={() => setSelectedVariantId(v.variant_id)}
                            className={cn(
                              "p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex flex-col justify-between gap-1.5 text-left",
                              isVarSelected
                                ? "border-iris bg-iris-soft/40 shadow-xs ring-1 ring-iris"
                                : "border-line bg-surface hover:bg-raised/60 hover:border-line-2"
                            )}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <span
                                className={cn(
                                  "font-semibold line-clamp-2 text-[12.5px] leading-snug",
                                  isVarSelected ? "text-iris-hi" : "text-fg"
                                )}
                                title={v.variant_name}
                              >
                                {v.variant_name}
                              </span>
                              {isVarSelected && (
                                <span className="shrink-0 text-iris">
                                  <Check size={14} />
                                </span>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                              <div className="flex items-center gap-1.5">
                                {priceNum !== undefined && (
                                  <span className="font-mono font-bold text-fg">
                                    {formatBrowseMoney(priceNum)}
                                  </span>
                                )}
                                <span className="text-faint text-[10.5px]">
                                  ({isInstantDelivery(v.delivery_mode) ? t("autoDelivery") : t("manualDelivery")})
                                </span>
                              </div>
                              <Tag tone={varTone} className="text-[10px]">
                                {toneLabel}
                              </Tag>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </Card>

                {/* ACTIVE VARIANT WORKBENCH & RESTOCK CONSOLE */}
                {activeVariant && (
                  <Card className="p-4 space-y-4">
                    {/* Active Variant Header: 2-Row Layout preventing button wrap */}
                    <div className="space-y-2.5 pb-3 border-b border-line">
                      {/* Row 1: Title & Variant on Left, Restock Toggle Button on Right */}
                      <div className="flex items-start sm:items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[11px] text-faint uppercase font-medium tracking-wider">
                              {t("inventoryManagingResource")}
                            </span>
                            <span className="text-xs font-normal text-muted font-mono whitespace-nowrap">
                              (ID #{activeVariant.variant_id})
                            </span>
                          </div>
                          <div className="text-[15px] font-bold text-fg mt-0.5 leading-snug break-words" title={activeVariant.variant_name}>
                            {activeVariant.variant_name}
                          </div>
                        </div>

                        {/* Dedicated Restock Button: Anchored top-right */}
                        <Button
                          size="sm"
                          variant={isRestockOpen ? "secondary" : "primary"}
                          onClick={() => setIsRestockOpen((prev) => !prev)}
                          className="h-8 px-3 text-xs gap-1.5 font-semibold shadow-xs shrink-0"
                        >
                          <Plus size={13} className={cn("transition-transform duration-200", isRestockOpen && "rotate-45")} />
                          <span>{isRestockOpen ? t("inventoryRestockToggleClose") : t("inventoryRestockToggleOpen")}</span>
                          {parsedRestockItems.length > 0 && (
                            <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-good text-white font-mono text-[10px] leading-none">
                              {parsedRestockItems.length}
                            </span>
                          )}
                        </Button>
                      </div>

                      {/* Row 2: Metrics Strip */}
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        {variantPrices[activeVariant.variant_id] !== undefined && (
                          <div className="px-2.5 py-1 rounded-lg bg-surface border border-line text-muted flex items-baseline gap-1.5 shrink-0">
                            <span className="text-[10.5px] font-medium">{t("priceLabel")}</span>
                            <span className="font-mono font-bold text-[13px] text-fg">
                              {formatBrowseMoney(variantPrices[activeVariant.variant_id])}
                            </span>
                          </div>
                        )}
                        <div className="px-2.5 py-1 rounded-lg bg-good-soft border border-good/20 text-good flex items-baseline gap-1.5 shrink-0">
                          <span className="text-[10.5px] font-medium">{t("availableLabel")}</span>
                          <span className="font-mono font-bold text-[13px]">{activeVariant.available}</span>
                        </div>
                        <div className="px-2.5 py-1 rounded-lg bg-surface border border-line text-muted flex items-baseline gap-1.5 shrink-0">
                          <span className="text-[10.5px] font-medium">{t("soldLabel")}</span>
                          <span className="font-mono font-bold text-[13px] text-fg">{activeVariant.assigned}</span>
                        </div>
                        {activeVariant.error > 0 && (
                          <div className="px-2.5 py-1 rounded-lg bg-bad-soft border border-bad/20 text-bad flex items-baseline gap-1.5 shrink-0">
                            <span className="text-[10.5px] font-medium">{t("errorLabel")}</span>
                            <span className="font-mono font-bold text-[13px]">{activeVariant.error}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* FAST RESTOCK PANEL (Collapsible) */}
                    {isRestockOpen && (
                      <div
                        ref={restockPanelRef}
                        className={cn(
                          "bg-raised/40 rounded-xl p-3.5 border border-line space-y-3 transition-all animate-rise",
                          targetVariantId === activeVariant.variant_id &&
                            "ring-2 ring-iris/70 border-iris/50 bg-iris-soft/15 shadow-md",
                        )}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-fg flex items-center gap-1.5">
                              <Plus size={14} className="text-iris" />
                              <span>{t("currentlyRestocking")}: <strong className="text-iris-hi">{activeVariant.variant_name}</strong></span>
                            </span>
                            {targetVariantId === activeVariant.variant_id && (
                              <Tag tone="iris" className="text-[10px] animate-pulse font-semibold">
                                {t("targetRestockBadge")}
                              </Tag>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadTemplate("txt")}
                              className="h-6 px-1.5 text-[11px] text-iris gap-1"
                            >
                              <Download size={11} />
                              <span>{t("sampleFile")}</span>
                            </Button>
                            <label className="text-[11.5px] text-iris hover:underline cursor-pointer inline-flex items-center gap-1 font-medium">
                              <Upload size={12} />
                              <span>{t("uploadFile")}</span>
                              <Input
                                type="file"
                                accept=".txt,.csv"
                                onChange={handleFileUpload}
                                className="hidden"
                              />
                            </label>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-surface border border-line text-[11.5px] text-muted">
                          💡 <strong>{t("restockRuleTitle")}</strong> {t("restockRuleLead")} <code className="text-fg font-mono">user|pass|2fa</code> {t("restockRuleOr")} <code className="text-fg font-mono">license_key</code>{t("restockRuleEnd")}
                        </div>

                        <Textarea
                          rows={3}
                          value={restockText}
                          onChange={(e) => {
                            setRestockText(e.target.value);
                            if (uploadedFileName) setUploadedFileName(null);
                          }}
                          placeholder={t("inventoryPastePlaceholderBulk")}
                          className="font-mono text-xs leading-relaxed bg-surface"
                        />

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-0.5">
                          <div className="flex items-center gap-3 text-xs text-muted">
                            <span className={cn(parsedRestockItems.length > 0 && "text-good font-semibold")}>
                              {t("recognizedLines", { count: parsedRestockItems.length })}
                              {uploadedFileName && <span className="text-muted font-normal ml-1 font-mono">({uploadedFileName})</span>}
                            </span>
                            <span className="text-line-2">|</span>
                            <label className="flex items-center gap-1.5 cursor-pointer text-muted hover:text-fg">
                              <Input
                                type="checkbox"
                                checked={autoDedupe}
                                onChange={(e) => setAutoDedupe(e.target.checked)}
                                className="h-3.5 w-3.5 rounded border-line-2 text-iris focus:ring-0 p-0"
                              />
                              <span className="text-[11.5px]">{t("skipDuplicates")}</span>
                            </label>
                          </div>

                          <Button
                            size="sm"
                            onClick={handleFastRestock}
                            disabled={restocking || parsedRestockItems.length === 0}
                            className="gap-1.5"
                          >
                            {restocking ? (
                              <span>{t("inventoryAdding")}</span>
                            ) : (
                              <>
                                <Plus size={14} />
                                <span>{t("confirmRestock")}</span>
                              </>
                            )}
                          </Button>
                        </div>

                        {/* Live parsed preview feedback */}
                        {parsedRestockItems.length > 0 && (
                          <div className="p-2 rounded-lg bg-good-soft/70 border border-good/20 text-good text-[11.5px] space-y-1">
                            <div className="flex items-center gap-1.5 font-semibold">
                              <CheckCircle2 size={13} />
                              <span>
                                {t("restockReady", { count: parsedRestockItems.length })}
                                {uploadedFileName && <span> {t("fromFile", { name: uploadedFileName })}</span>}
                              </span>
                            </div>
                            <div className="font-mono text-[11px] text-faint truncate bg-surface/60 px-2 py-0.5 rounded border border-line">
                              {t("firstLineSample", { value: parsedRestockItems[0] })}
                            </div>
                          </div>
                        )}

                        {restockError && (
                          <div className="p-2 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
                            {restockError}
                          </div>
                        )}

                        {restockSuccess !== null && (
                          <div className="p-2 rounded-lg bg-good-soft border border-good/20 text-good text-xs font-medium flex items-center gap-1.5">
                            <CheckCircle2 size={13} />
                            <span>{t("restockSuccess", { count: restockSuccess })}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* RESOURCE ITEMS DETAILED TABLE */}
                    <div className="space-y-3 pt-1">
                      {/* Level 1: Sub-tabs Segment on Left + Quick Export on Right */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        {/* Sub-tabs Segmented Pills */}
                        <div className="inline-flex p-0.5 bg-raised/60 rounded-lg border border-line gap-0.5 text-xs overflow-x-auto max-w-full shrink-0">
                          <button
                            type="button"
                            onClick={() => setResourceStatusFilter("all")}
                            className={cn(
                              "px-2.5 py-1 rounded-md transition-all font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0",
                              resourceStatusFilter === "all"
                                ? "bg-surface text-fg font-semibold shadow-xs ring-1 ring-line"
                                : "text-muted hover:text-fg hover:bg-raised/40",
                            )}
                          >
                            <span>{t("inventorySubtabAll")}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-raised text-muted font-mono leading-none">
                              {activeVariant.available + activeVariant.assigned + activeVariant.error}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResourceStatusFilter("available")}
                            className={cn(
                              "px-2.5 py-1 rounded-md transition-all font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0",
                              resourceStatusFilter === "available"
                                ? "bg-surface text-good font-semibold shadow-xs ring-1 ring-good/30"
                                : "text-muted hover:text-fg hover:bg-raised/40",
                            )}
                          >
                            <span>{t("inventorySubtabAvailable")}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-good-soft text-good font-mono leading-none font-semibold">
                              {activeVariant.available}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResourceStatusFilter("error")}
                            className={cn(
                              "px-2.5 py-1 rounded-md transition-all font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0",
                              resourceStatusFilter === "error"
                                ? "bg-surface text-warn-hi font-semibold shadow-xs ring-1 ring-warn/30"
                                : "text-muted hover:text-fg hover:bg-raised/40",
                            )}
                          >
                            <span>{t("inventorySubtabError")}</span>
                            {activeVariant.error > 0 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warn-soft text-warn-hi font-mono leading-none font-semibold">
                                {activeVariant.error}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setResourceStatusFilter("assigned")}
                            className={cn(
                              "px-2.5 py-1 rounded-md transition-all font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0",
                              resourceStatusFilter === "assigned"
                                ? "bg-surface text-fg font-semibold shadow-xs ring-1 ring-line"
                                : "text-muted hover:text-fg hover:bg-raised/40",
                            )}
                          >
                            <span>{t("inventorySubtabAssigned")}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-raised text-muted font-mono leading-none">
                              {activeVariant.assigned}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setResourceStatusFilter("archived")}
                            className={cn(
                              "px-2.5 py-1 rounded-md transition-all font-medium text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0",
                              resourceStatusFilter === "archived"
                                ? "bg-surface text-fg font-semibold shadow-xs ring-1 ring-line"
                                : "text-muted hover:text-fg hover:bg-raised/40",
                            )}
                          >
                            <span>{t("inventorySubtabArchived")}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-raised text-muted font-mono leading-none">
                              {activeVariant.archived}
                            </span>
                          </button>
                        </div>

                        {/* Export Buttons */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-auto">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleExportResources("txt")}
                            disabled={resourceTotal === 0}
                            className="h-7 text-xs gap-1 font-medium"
                          >
                            <Download size={12} />
                            <span>{t("exportTxt")}</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleExportResources("csv")}
                            disabled={resourceTotal === 0}
                            className="h-7 text-xs gap-1 font-medium"
                          >
                            <Download size={12} />
                            <span>{t("exportCsv")}</span>
                          </Button>
                        </div>
                      </div>

                      {/* Level 2: Search + Page Size Filter Toolbar (No Overflow) */}
                      <div className="flex items-center justify-between gap-3 bg-raised/40 px-2.5 py-1.5 rounded-xl border border-line">
                        <div className="relative flex-1 min-w-0 max-w-sm">
                          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                          <Input
                            value={resourceSearch}
                            onChange={(e) => setResourceSearch(e.target.value)}
                            placeholder={t("inventorySearchResourcePlaceholder")}
                            className="h-7.5 pl-8 pr-7 text-xs bg-surface"
                          />
                          {resourceSearch && (
                            <button
                              type="button"
                              onClick={() => setResourceSearch("")}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-[11px] text-muted shrink-0 pr-0.5">
                          <span className="whitespace-nowrap">{t("inventoryPageSize")}</span>
                          <Select
                            value={String(resourcePageSize)}
                            onChange={(e) => setResourcePageSize(Number(e.target.value))}
                            className="h-7 text-xs bg-surface w-16 py-0 px-1 text-center"
                          >
                            <option value="25">25</option>
                            <option value="50">50</option>
                            <option value="100">100</option>
                            <option value="200">200</option>
                          </Select>
                        </div>
                      </div>

                      {/* Bulk Operations Toolbar */}
                      {selectedResourceIds.size > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-iris-soft/20 border border-iris/30 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-iris-hi">
                              {t("inventorySelectedCount", { count: selectedResourceIds.size })}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedResourceIds(new Set())}
                              className="h-6 px-2 text-[11px] text-muted hover:text-fg"
                            >
                              {t("inventoryClearSelection")}
                            </Button>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleExportResources("txt")}
                              disabled={bulkOperating}
                              className="h-7 text-xs gap-1"
                            >
                              <Download size={12} />
                              <span>{t("inventoryBulkExportTxt")}</span>
                            </Button>
                            {resourceStatusFilter === "archived" ? (
                              <Button size="sm" onClick={handleBulkRestore} disabled={bulkOperating} className="h-7 text-xs gap-1">
                                <RotateCcw size={12} />
                                <span>{t("inventoryBulkRestore", { count: selectedResourceIds.size })}</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={handleBulkArchive}
                                disabled={bulkOperating}
                                className="h-7 text-xs gap-1 text-bad hover:bg-bad-soft"
                              >
                                <EyeOff size={12} />
                                <span>{t("inventoryBulkArchive", { count: selectedResourceIds.size })}</span>
                              </Button>
                            )}
                          </div>
                        </div>
                      )}

                      {bulkMessage && (
                        <div
                          className={cn(
                            "p-2.5 rounded-xl text-xs font-medium flex items-center gap-2",
                            bulkMessage.type === "success"
                              ? "bg-good-soft border border-good/20 text-good"
                              : "bg-bad-soft border border-bad/20 text-bad",
                          )}
                        >
                          {bulkMessage.type === "success" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                          <span>{bulkMessage.text}</span>
                        </div>
                      )}

                      {loadingResources ? (
                        <div className="py-6 text-center">
                          <Spinner />
                        </div>
                      ) : resourceLoadError ? (
                        <div className="py-6 text-center text-xs text-bad border border-bad/20 rounded-xl bg-bad-soft/20 space-y-2">
                          <p>{t("resourcesLoadFailed")}</p>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => activeVariant && void loadVariantResources(activeVariant.variant_id, resourcePage)}
                          >
                            {t("retry")}
                          </Button>
                        </div>
                      ) : resources.length === 0 ? (
                        <div className="py-6 text-center text-xs text-muted border border-line rounded-xl bg-raised/20">
                          {t("inventoryNoLines")}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-line overflow-hidden bg-surface">
                          <div className="overflow-x-auto">
                            <table className="w-full table-fixed text-left text-xs border-collapse">
                              <thead>
                                <tr className="bg-raised/40 text-faint text-[11px] font-semibold border-b border-line">
                                  <th className="w-10 px-3 py-2.5 text-center">
                                    <Input
                                      type="checkbox"
                                      checked={isAllPageSelected}
                                      onChange={toggleSelectAllPage}
                                      className="h-3.5 w-3.5 rounded border-line-2 text-iris focus:ring-0 p-0"
                                      title={isAllPageSelected ? t("inventoryDeselectAll") : t("inventorySelectAllPage")}
                                    />
                                  </th>
                                  <th className="w-28 px-3.5 py-2.5 whitespace-nowrap">{t("status")}</th>
                                  <th className="px-3.5 py-2.5">{t("resourceTableContent")}</th>
                                  <th className="w-20 px-3.5 py-2.5 whitespace-nowrap">{t("resourceTableOrder")}</th>
                                  <th className="w-28 px-3.5 py-2.5 whitespace-nowrap">{t("resourceTableDate")}</th>
                                  <th className="w-32 px-3.5 py-2.5 text-right whitespace-nowrap">{t("actions")}</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-line text-[12px]">
                                {paginatedResources.map((res) => {
                                  const isAvailable = res.status === "available";
                                  const isAssigned = res.status === "assigned";
                                  const isError = res.status === "error";
                                  const isDefective = isDefectiveReturnResource(res.status, res.order_id);

                                  const tone = res.is_archived
                                    ? "neutral"
                                    : isAvailable
                                    ? "good"
                                    : isAssigned
                                      ? "neutral"
                                      : isDefective
                                        ? "warn"
                                        : isError
                                          ? "bad"
                                          : "warn";

                                  const label = res.is_archived
                                    ? t("inventoryResourceArchived")
                                    : isAvailable
                                    ? t("inventoryResourceAvailable")
                                    : isAssigned
                                      ? t("inventoryResourceAssigned")
                                      : isDefective
                                        ? t("inventoryResourceReturned")
                                        : isError
                                          ? t("inventoryResourceWarehouseError")
                                          : t("inventoryResourceExpired");

                                  return (
                                    <tr
                                      key={res.id}
                                      onClick={() => setActiveDetailResource(res)}
                                      className="hover:bg-raised/40 transition-colors cursor-pointer"
                                    >
                                      <td className="w-10 px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                        <Input
                                          type="checkbox"
                                          checked={selectedResourceIds.has(res.id)}
                                          onChange={() => toggleSelectResource(res.id)}
                                          className="h-3.5 w-3.5 rounded border-line-2 text-iris focus:ring-0 p-0"
                                        />
                                      </td>

                                      <td className="px-3.5 py-2">
                                        <div className="flex flex-col gap-0.5">
                                          <Tag tone={tone} className="text-[10px] w-fit">
                                            {label}
                                          </Tag>
                                          {isDefective && (
                                            <span className="text-[10.5px] text-warn-hi font-medium">
                                              {t("inventoryResourceReturnedHint", { id: res.order_id ?? 0 })}
                                            </span>
                                          )}
                                        </div>
                                      </td>

                                      {/* Resource Data */}
                                      <td className="px-3.5 py-2 font-mono text-[11.5px] min-w-0">
                                        <span className="truncate block" title={res.data}>
                                          {res.data.slice(0, 36)}
                                          {res.data.length > 36 && "..."}
                                        </span>
                                      </td>

                                      {/* Assigned Order */}
                                      <td className="px-3.5 py-2 text-muted">
                                        {res.order_id ? (
                                          <Link
                                            href={`/seller/orders?search=%23${res.order_id}`}
                                            onClick={(e) => e.stopPropagation()}
                                            className="font-mono text-iris hover:underline"
                                          >
                                            #{res.order_id}
                                          </Link>
                                        ) : (
                                          <span className="text-faint">&mdash;</span>
                                        )}
                                      </td>

                                      {/* Date */}
                                      <td className="px-3.5 py-2 text-faint font-mono text-[11px] whitespace-nowrap">
                                        {new Date(res.created_at).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-US", {
                                          month: "numeric",
                                          day: "numeric",
                                          hour: "2-digit",
                                          minute: "2-digit",
                                          hour12: false,
                                        })}
                                      </td>

                                      {/* Actions */}
                                      <td className="px-3.5 py-2 text-right whitespace-nowrap">
                                        <div
                                          className="grid grid-cols-3 w-[92px] ml-auto gap-1 items-center justify-items-center"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          {/* Slot 1: Edit / View detail */}
                                          <div className="col-start-1">
                                            <Button
                                              size="sm"
                                              variant="ghost"
                                              onClick={() => setActiveDetailResource(res)}
                                              className="h-7 w-7 p-0 text-iris hover:text-iris-hi hover:bg-iris-soft inline-flex items-center justify-center rounded-lg"
                                              title={t("resourceEditTitle")}
                                              aria-label={t("resourceEditTitle")}
                                            >
                                              <Edit2 size={13} />
                                            </Button>
                                          </div>

                                          {/* Slot 2: Lifecycle action (Restock / Restore / Archive) */}
                                          {canRestockInventoryResource(res.status, res.order_id) && !res.is_archived ? (
                                            <div className="col-start-2">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => setActiveDetailResource(res)}
                                                className="h-7 w-7 p-0 text-good hover:text-good hover:bg-good-soft inline-flex items-center justify-center rounded-lg"
                                                title={t("inventoryRestockSingle")}
                                                aria-label={t("inventoryRestockSingle")}
                                              >
                                                <RotateCcw size={13} />
                                              </Button>
                                            </div>
                                          ) : res.is_archived ? (
                                            <div className="col-start-2">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => void handleRestoreSingle(res.id)}
                                                className="h-7 w-7 p-0 text-iris hover:text-iris-hi hover:bg-iris-soft inline-flex items-center justify-center rounded-lg"
                                                title={t("inventoryRestoreSingle")}
                                                aria-label={t("inventoryRestoreSingle")}
                                              >
                                                <RotateCcw size={13} />
                                              </Button>
                                            </div>
                                          ) : canArchiveInventoryResource(res.status) ? (
                                            <div className="col-start-2">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => void handleArchiveSingle(res.id)}
                                                className="h-7 w-7 p-0 text-muted hover:text-bad hover:bg-bad-soft inline-flex items-center justify-center rounded-lg"
                                                title={t("inventoryArchiveSingle")}
                                                aria-label={t("inventoryArchiveSingle")}
                                              >
                                                <EyeOff size={13} />
                                              </Button>
                                            </div>
                                          ) : null}

                                          {/* Slot 3: Delete */}
                                          {isAvailable && (
                                            <div className="col-start-3">
                                              <Button
                                                size="sm"
                                                variant="ghost"
                                                onClick={() => handleDeleteResource(res.id)}
                                                className="h-7 w-7 p-0 text-bad hover:text-bad hover:bg-bad-soft inline-flex items-center justify-center rounded-lg"
                                                title={t("inventoryDeleteLine")}
                                                aria-label={t("inventoryDeleteLine")}
                                              >
                                                <Trash size={13} />
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          {/* Resource List Pagination */}
                          {totalResourcePages > 1 && (
                            <div className="p-2.5 border-t border-line bg-raised/20 flex items-center justify-between text-xs text-muted">
                              <span>
                                {t("paginationResources", {
                                  from: (resourcePage - 1) * resourcePageSize + 1,
                                  to: Math.min(resourcePage * resourcePageSize, resourceTotal),
                                  total: resourceTotal,
                                })}
                              </span>
                              <Pagination
                                page={resourcePage}
                                totalPages={totalResourcePages}
                                onChange={setResourcePage}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )}
              </>
            ) : (
              <Card className="p-8 text-center text-muted text-xs">
                {t("inventorySelectProduct")}
              </Card>
            )}
          </div>

        </div>
      )}

      {/* Resource Detail & Edit Modal */}
      {activeDetailResource && (
        <ResourceDetailModal
          resource={activeDetailResource}
          isOpen={!!activeDetailResource}
          onClose={() => setActiveDetailResource(null)}
          onSuccess={handleUpdateResourceSuccess}
          onDelete={handleDeleteResource}
          onRestock={handleRestockSingle}
          onArchive={handleArchiveSingle}
          onRestore={handleRestoreSingle}
        />
      )}

      {/* Quick Create Variant Modal */}
      {isCreateVariantOpen && activeProduct && (
        <QuickCreateVariantModal
          productId={activeProduct.id}
          productTitle={activeProduct.title}
          isOpen={isCreateVariantOpen}
          onClose={() => setIsCreateVariantOpen(false)}
          onSuccess={async (newVariantId, newPrice) => {
            setIsCreateVariantOpen(false);
            if (newPrice !== undefined) {
              setVariantPrices((prev) => ({ ...prev, [newVariantId]: newPrice }));
            }
            await loadSummary();
            setSelectedVariantId(newVariantId);
          }}
        />
      )}
    </div>
  );
}

/** Resource Detail & Edit Modal with 1-click Copy, multi-line editor, restock and archive actions */
function ResourceDetailModal({
  resource,
  isOpen,
  onClose,
  onSuccess,
  onDelete,
  onRestock,
  onArchive,
  onRestore,
}: {
  resource: Resource;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updated: Resource) => void;
  onDelete: (id: number) => void;
  onRestock?: (id: number, data: string) => Promise<void> | void;
  onArchive?: (id: number) => Promise<void> | void;
  onRestore?: (id: number) => Promise<void> | void;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const [data, setData] = useState(resource.data);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restocking, setRestocking] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(resource.data);
    setCopied(false);
    setError(null);
  }, [resource]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    if (!data.trim()) {
      setError(t("resourceContentRequired"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateResource(resource.id, data.trim());
      onSuccess(updated);
      onClose();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("inventorySaveFailed")));
    } finally {
      setSaving(false);
    }
  };

  const handleRestock = async () => {
    if (!onRestock) return;
    setRestocking(true);
    setError(null);
    try {
      await onRestock(resource.id, data.trim());
      onClose();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("inventorySaveFailed")));
    } finally {
      setRestocking(false);
    }
  };

  const handleArchive = async () => {
    if (!onArchive) return;
    setArchiving(true);
    setError(null);
    try {
      await onArchive(resource.id);
      onClose();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("inventoryDeleteFailed")));
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async () => {
    if (!onRestore) return;
    setRestoring(true);
    setError(null);
    try {
      await onRestore(resource.id);
      onClose();
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("inventoryRestoreFailed")));
    } finally {
      setRestoring(false);
    }
  };

  const isAvailable = resource.status === "available";
  const isAssigned = resource.status === "assigned";
  const isError = resource.status === "error";
  const isDefective = isDefectiveReturnResource(resource.status, resource.order_id);
  const isEditable = canEditInventoryResource(resource.status, resource.order_id);

  const tone = isAvailable
    ? "good"
    : isAssigned
      ? "neutral"
      : isDefective
        ? "warn"
        : isError
          ? "bad"
          : "warn";

  const label = isAvailable
    ? t("inventoryResourceAvailable")
    : isAssigned
      ? t("inventoryResourceAssigned")
      : isDefective
        ? t("inventoryResourceReturned")
        : isError
          ? t("inventoryResourceWarehouseError")
          : t("inventoryResourceExpired");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-detail-title"
        className="w-full max-w-lg bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag tone={tone}>{label}</Tag>
            <h3 id="resource-detail-title" className="text-[13.5px] font-bold text-fg">
              {t("resourceDetailTitle")} <span className="font-mono text-faint font-normal">#{resource.id}</span>
            </h3>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-muted hover:text-fg">
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 text-xs">
          {/* Defective return banner */}
          {isDefective && (
            <div className="p-3 rounded-xl bg-warn-soft/80 border border-warn/30 text-warn-hi space-y-1">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-warn-hi">
                <AlertCircle size={14} />
                <span>{t("inventoryDefectiveBannerTitle", { id: resource.order_id ?? 0 })}</span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-muted">
                {t("inventoryDefectiveBannerDesc")}
              </p>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-raised/40 border border-line text-[11.5px]">
            <div>
              <span className="text-faint">{t("createdDate")}</span>
              <div className="font-mono text-fg font-medium mt-0.5">
                {new Date(resource.created_at).toLocaleString("vi-VN")}
              </div>
            </div>
            <div>
              <span className="text-faint">{t("linkedOrder")}</span>
              <div className="mt-0.5">
                {resource.order_id ? (
                  <Link
                    href={`/seller/orders?search=%23${resource.order_id}`}
                    className="font-mono text-iris hover:underline font-bold"
                  >
                    #{resource.order_id}
                  </Link>
                ) : (
                  <span className="text-muted">{t("notDelivered")}</span>
                )}
              </div>
            </div>
          </div>

          {/* Content Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-fg">
                {isEditable ? t("editResourceContent") : t("resourceContent")}:
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCopy}
                className="h-6 px-2 text-[11px] text-iris gap-1"
              >
                {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
                <span>{copied ? t("copied") : t("copy")}</span>
              </Button>
            </div>

            {isEditable ? (
              <Textarea
                rows={5}
                value={data}
                onChange={(e) => setData(e.target.value)}
                className="font-mono text-xs leading-relaxed bg-surface"
                placeholder={t("resourceEditPlaceholder")}
              />
            ) : (
              <div className="p-3 rounded-xl bg-raised/50 border border-line font-mono text-xs break-all max-h-40 overflow-y-auto select-all">
                {resource.data}
              </div>
            )}
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-raised/50 border-t border-line flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            {isAvailable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(resource.id)}
                className="text-bad hover:text-bad hover:bg-bad-soft h-8 text-xs gap-1"
              >
                <Trash size={13} />
                <span>{t("delete")}</span>
              </Button>
            )}
            {resource.is_archived && onRestore ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRestore}
                disabled={restoring || saving || restocking}
                className="text-iris hover:text-iris-hi h-8 text-xs gap-1"
              >
                <RotateCcw size={13} />
                <span>{restoring ? t("inventoryRestoringSingle") : t("inventoryRestoreSingle")}</span>
              </Button>
            ) : canArchiveInventoryResource(resource.status) && onArchive && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleArchive}
                disabled={archiving || saving || restocking}
                className="text-muted hover:text-bad hover:bg-bad-soft h-8 text-xs gap-1"
              >
                <EyeOff size={13} />
                <span>{archiving ? t("inventoryArchivingSingle") : t("inventoryArchiveSingle")}</span>
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("close")}
            </Button>
            {canRestockInventoryResource(resource.status, resource.order_id) && !resource.is_archived && onRestock && (
              <Button
                size="sm"
                onClick={handleRestock}
                disabled={restocking || saving || archiving || !data.trim()}
                className="gap-1 bg-good hover:bg-good/90 text-white"
              >
                <RotateCcw size={13} />
                <span>{restocking ? t("inventoryRestockingSingle") : t("inventoryRestockSingle")}</span>
              </Button>
            )}
            {isEditable && (
              <Button size="sm" onClick={handleSave} disabled={saving || restocking || archiving}>
                {saving ? t("saving") : t("saveChanges")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quick Create Variant Modal inside Inventory workbench */
function QuickCreateVariantModal({
  productId,
  productTitle,
  isOpen,
  onClose,
  onSuccess,
}: {
  productId: number;
  productTitle: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newVariantId: number, price?: number) => void;
}) {
  const t = useTranslations("seller");
  const apiErrorMessage = useApiErrorMessage();
  const { currency: priceCurrency } = useSellerPriceCurrency();
  const [name, setName] = useState("");
  const [price, setPrice] = useState(10000);
  const [deliveryMode, setDeliveryMode] = useState<"instant" | "manual">("instant");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t("variantNameRequired"));
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError(t("variantPriceInvalid"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createVariant(productId, {
        name: name.trim(),
        price,
        delivery_mode: deliveryMode,
      });
      onSuccess(created.id, price);
    } catch (err: unknown) {
      setError(apiErrorMessage(err, t("variantCreateFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-variant-title"
        className="w-full max-w-md bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise"
      >
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-iris bg-iris-soft px-1.5 py-0.5 rounded leading-none">
              {t("variantCreateTitle")}
            </span>
            <h3 id="create-variant-title" className="text-[13.5px] font-bold text-fg truncate max-w-[340px] mt-0.5">
              {productTitle}
            </h3>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-muted hover:text-fg">
            <X size={14} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3.5 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-fg">{t("variantName")}:</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("variantNamePlaceholder")}
              className="h-8.5 text-xs"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="font-semibold text-fg">{t("variantPrice", { currency: priceCurrency })}</label>
              <SellerPriceInput amountVnd={price} onAmountVndChange={setPrice} />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-fg">{t("deliveryMode")}:</label>
              <Select
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value as "instant" | "manual")}
                className="h-8.5 text-xs"
              >
                <option value="instant">{t("autoDelivery")}</option>
                <option value="manual">{t("manualDelivery")}</option>
              </Select>
            </div>
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
              {error}
            </div>
          )}

          <div className="pt-2 border-t border-line flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" type="button" onClick={onClose} disabled={submitting}>
              {t("cancel")}
            </Button>
            <Button size="sm" type="submit" disabled={submitting || !name.trim()}>
              {submitting ? t("creating") : t("createVariant")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

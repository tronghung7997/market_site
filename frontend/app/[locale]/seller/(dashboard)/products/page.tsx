"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/money";
import type { SellerProduct, Variant } from "@/lib/types";
import { cn } from "@/lib/cn";
import {
  downloadRestockTemplate,
  inventoryStockState,
  isInventoryManagedProduct,
  mergeRestockText,
  nextSellerProductStatus,
  parseResourceItems,
  parseRestockFileContent,
  restockableVariants,
} from "@/features/seller-inventory";
import { parseCoverId, ProductCover } from "@/features/product-covers";
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
  Bolt,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Edit2,
  Eye,
  ListFilter,
  Package,
  Plus,
  Search,
  Trash,
  Upload,
  X,
} from "@/components/Icons";

type FilterTab = "all" | "active" | "low_stock" | "out_of_stock" | "paused";

const PAGE_SIZE = 20;

export default function SellerProducts() {
  const t = useTranslations("seller");
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [restockProduct, setRestockProduct] = useState<SellerProduct | null>(null);
  const [page, setPage] = useState(1);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    api.sellerProducts()
      .then(setProducts)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Reset page to 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [activeTab, searchQuery, selectedCategory, selectedService]);

  // KPI Calculations
  const stats = useMemo(() => {
    const total = products.length;
    const active = products.filter((p) => p.status === "active").length;
    const lowStock = products.filter((p) => inventoryStockState(p, 20) === "low").length;
    const outOfStock = products.filter((p) => inventoryStockState(p, 20) === "out").length;
    const paused = products.filter((p) => p.status === "paused" || p.status === "draft").length;
    const totalStock = products.reduce((acc, p) => acc + (p.total_stock || 0), 0);

    return { total, active, lowStock, outOfStock, paused, totalStock };
  }, [products]);

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category_name) set.add(p.category_name);
    }
    return Array.from(set);
  }, [products]);

  // Unique service types for filter dropdown
  const serviceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.service_type) set.add(p.service_type);
    }
    return Array.from(set);
  }, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Tab filter
      if (activeTab === "active" && p.status !== "active") return false;
      if (activeTab === "low_stock" && inventoryStockState(p, 20) !== "low") return false;
      if (activeTab === "out_of_stock" && inventoryStockState(p, 20) !== "out") return false;
      if (activeTab === "paused" && p.status !== "paused" && p.status !== "draft") return false;

      // Category facet filter
      if (selectedCategory && p.category_name !== selectedCategory) return false;

      // Service type facet filter
      if (selectedService && p.service_type !== selectedService) return false;

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchTitle = p.title.toLowerCase().includes(query);
        const matchCategory = p.category_name?.toLowerCase().includes(query);
        const matchService = p.service_type?.toLowerCase().includes(query);
        const matchId = String(p.id).includes(query);
        if (!matchTitle && !matchCategory && !matchService && !matchId) return false;
      }

      return true;
    });
  }, [products, activeTab, selectedCategory, selectedService, searchQuery]);

  // Paginated subset
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredProducts.slice(start, start + PAGE_SIZE);
  }, [filteredProducts, page]);

  const handleToggleStatus = async (product: SellerProduct) => {
    const nextStatus = nextSellerProductStatus(product.status);
    if (!nextStatus) return;
    setTogglingId(product.id);
    try {
      const updated = await api.updateSellerProductStatus(product.id, nextStatus);
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? { ...p, status: updated.status } : p))
      );
    } catch {
      load();
    } finally {
      setTogglingId(null);
    }
  };

  const handleRestockSuccess = (variantId: number, addedCount: number) => {
    if (!restockProduct) return;
    setProducts((prev) =>
      prev.map((p) =>
        p.id === restockProduct.id
          ? { ...p, total_stock: (p.total_stock || 0) + addedCount }
          : p
      )
    );
  };

  const remove = async (id: number) => {
    if (!confirm(t("pauseConfirm"))) return;
    await api.deleteProduct(id);
    load();
  };

  const resetFilters = () => {
    setActiveTab("all");
    setSearchQuery("");
    setSelectedCategory(null);
    setSelectedService(null);
    setPage(1);
  };

  const hasActiveFilters =
    activeTab !== "all" ||
    searchQuery.trim() !== "" ||
    selectedCategory !== null ||
    selectedService !== null;

  return (
    <div className="space-y-5 animate-fade">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-fg tracking-tight">{t("yourProducts")}</h1>
          <p className="text-[12.5px] text-muted">{t("productCount", { count: products.length })}</p>
        </div>
        <Link href="/seller/products/new">
          <Button size="md" className="gap-1.5 shadow-sm">
            <Plus size={15} />
            <span>{t("createNew")}</span>
          </Button>
        </Link>
      </div>

      {loading ? (
        /* SKELETON LOADING STATE (Zero layout shift) */
        <div className="space-y-4 animate-pulse">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-raised border border-line" />
            ))}
          </div>
          <div className="h-10 rounded-lg bg-raised border border-line" />
          <div className="h-80 rounded-xl bg-raised border border-line" />
        </div>
      ) : loadError ? (
        <Card className="p-10 text-center">
          <AlertCircle size={32} className="mx-auto text-bad mb-2" />
          <p className="text-[13.5px] font-medium text-fg mb-3">{t("productsLoadFailed")}</p>
          <Button size="sm" variant="secondary" onClick={load}>{t("retry")}</Button>
        </Card>
      ) : products.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="grid place-items-center h-12 w-12 rounded-xl bg-raised border border-line mx-auto text-faint mb-3">
            <Package size={24} />
          </div>
          <p className="text-[14px] font-medium text-fg mb-1">{t("noProductsYet")}</p>
          <p className="text-[12.5px] text-muted mb-4 max-w-sm mx-auto">
            {t("productsPageFirstDescription")}
          </p>
          <Link href="/seller/products/new">
            <Button size="md">
              <Plus size={15} />
              <span>{t("createFirstProduct")}</span>
            </Button>
          </Link>
        </Card>
      ) : (
        <>
          {/* 4 Clickable KPI Summary Filter Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card
              onClick={() => setActiveTab(activeTab === "active" ? "all" : "active")}
              className={cn(
                "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-good/50 hover:shadow-xs",
                activeTab === "active" && "ring-2 ring-good/40 border-good/50 bg-good-soft/20"
              )}
            >
              <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
                <span>{t("activeProductsKpi")}</span>
                <span className="text-good">
                  <CheckCircle2 size={15} />
                </span>
              </div>
              <div className="text-2xl font-bold font-mono tabular text-fg">
                {stats.active}{" "}
                <span className="text-xs font-normal text-faint font-sans">/ {stats.total}</span>
              </div>
              <div className="text-[11px] text-good font-medium mt-1">
                {t("productsPageActivePercent", {
                  percent: stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0,
                })}
              </div>
            </Card>

            <Card
              onClick={() => setActiveTab(activeTab === "low_stock" ? "all" : "low_stock")}
              className={cn(
                "p-3.5 flex flex-col justify-between border-warn/30 bg-warn-soft/20 cursor-pointer transition-all hover:border-warn/60 hover:shadow-xs",
                activeTab === "low_stock" && "ring-2 ring-warn/50 border-warn bg-warn-soft/40"
              )}
            >
              <div className="flex items-center justify-between text-warn text-[12px] font-medium mb-1">
                <span>{t("lowStockKpi")}</span>
                <AlertTriangle size={15} />
              </div>
              <div className="text-2xl font-bold font-mono tabular text-warn">
                {stats.lowStock}{" "}
                <span className="text-xs font-normal text-muted font-sans">{t("productsUnit")}</span>
              </div>
              <div className="text-[11px] text-warn font-medium mt-1">
                {t("productsPageLowStockHint")}
              </div>
            </Card>

            <Card
              onClick={() => setActiveTab(activeTab === "out_of_stock" ? "all" : "out_of_stock")}
              className={cn(
                "p-3.5 flex flex-col justify-between border-bad/30 bg-bad-soft/20 cursor-pointer transition-all hover:border-bad/60 hover:shadow-xs",
                activeTab === "out_of_stock" && "ring-2 ring-bad/50 border-bad bg-bad-soft/40"
              )}
            >
              <div className="flex items-center justify-between text-bad text-[12px] font-medium mb-1">
                <span>{t("outOfStockKpi")}</span>
                <AlertCircle size={15} />
              </div>
              <div className="text-2xl font-bold font-mono tabular text-bad">
                {stats.outOfStock}{" "}
                <span className="text-xs font-normal text-muted font-sans">{t("productsUnit")}</span>
              </div>
              <div className="text-[11px] text-bad font-medium mt-1">
                {t("productsPageRestockHint")}
              </div>
            </Card>

            <Card
              onClick={() => setActiveTab("all")}
              className={cn(
                "p-3.5 flex flex-col justify-between cursor-pointer transition-all hover:border-iris/50 hover:shadow-xs",
                activeTab === "all" && "ring-2 ring-iris/40 border-iris/50"
              )}
            >
              <div className="flex items-center justify-between text-muted text-[12px] font-medium mb-1">
                <span>{t("totalStockKpi")}</span>
                <span className="text-iris">
                  <Package size={15} />
                </span>
              </div>
              <div className="text-2xl font-bold font-mono tabular text-fg">
                {stats.totalStock.toLocaleString()}{" "}
                <span className="text-xs font-normal text-faint font-sans">{t("itemsUnit")}</span>
              </div>
              <div className="text-[11px] text-faint font-medium mt-1">
                {t("productsPageAvailableHint")}
              </div>
            </Card>
          </div>

          {/* ADMIN-STYLE FILTER & SEARCH CONSOLE */}
          <Card className="p-0 overflow-hidden">
            {/* Top Filter Row: Search & Facet Selects */}
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-line bg-raised/30">
              {/* Category Facet Select */}
              {categories.length > 0 && (
                <div className="relative">
                  <Select
                    value={selectedCategory || "all"}
                    onChange={(e) => setSelectedCategory(e.target.value === "all" ? null : e.target.value)}
                    className="h-9 min-w-[140px] text-xs pl-8 pr-7 rounded-lg"
                  >
                    <option value="all">{t("allCategories")}</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                  <ListFilter size={13} className="absolute left-2.5 top-3 text-muted pointer-events-none" />
                </div>
              )}

              {/* Service Type Facet Select */}
              {serviceTypes.length > 0 && (
                <div className="relative">
                  <Select
                    value={selectedService || "all"}
                    onChange={(e) => setSelectedService(e.target.value === "all" ? null : e.target.value)}
                    className="h-9 min-w-[140px] text-xs pl-8 pr-7 rounded-lg"
                  >
                    <option value="all">{t("allServiceTypes")}</option>
                    {serviceTypes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                  <ListFilter size={13} className="absolute left-2.5 top-3 text-muted pointer-events-none" />
                </div>
              )}

              {/* Search Bar */}
              <div className="relative min-w-[200px] flex-1">
                <span className="absolute left-3 top-2.5 text-muted pointer-events-none" aria-hidden>
                  <Search size={14} />
                </span>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("searchProductsPlaceholder")}
                  className="h-9 pl-9 pr-8 text-xs rounded-lg"
                />
                {searchQuery && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-1 top-1 h-7 w-7 p-0 text-muted hover:text-fg"
                  >
                    <X size={13} />
                  </Button>
                )}
              </div>

              {hasActiveFilters && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={resetFilters}
                  className="h-9 text-xs text-muted hover:text-fg gap-1"
                >
                  <X size={13} />
                  <span>{t("clearFilters")}</span>
                </Button>
              )}
            </div>

            {/* Status Tabs with Colored Dots and Counts */}
            <div className="flex items-center gap-1 overflow-x-auto px-3 py-2 border-b border-line bg-surface text-xs">
              <Button
                size="sm"
                variant={activeTab === "all" ? "secondary" : "ghost"}
                onClick={() => setActiveTab("all")}
                className={cn(
                  "h-7.5 px-2.5 rounded-lg text-[12px] font-medium",
                  activeTab === "all" ? "bg-raised text-fg font-semibold shadow-xs" : "text-muted"
                )}
              >
                {t("filterAll")} <span className="ml-1 text-[11px] font-mono opacity-80">{stats.total}</span>
              </Button>

              <Button
                size="sm"
                variant={activeTab === "active" ? "secondary" : "ghost"}
                onClick={() => setActiveTab("active")}
                className={cn(
                  "h-7.5 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5",
                  activeTab === "active" ? "bg-raised text-fg font-semibold shadow-xs" : "text-muted"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-good" />
                <span>{t("filterActive")}</span>
                <span className="text-[11px] font-mono opacity-80">{stats.active}</span>
              </Button>

              <Button
                size="sm"
                variant={activeTab === "low_stock" ? "secondary" : "ghost"}
                onClick={() => setActiveTab("low_stock")}
                className={cn(
                  "h-7.5 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5",
                  activeTab === "low_stock" ? "bg-raised text-warn font-semibold shadow-xs" : "text-muted"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                <span>{t("filterLowStock")}</span>
                <span className="text-[11px] font-mono opacity-80">{stats.lowStock}</span>
              </Button>

              <Button
                size="sm"
                variant={activeTab === "out_of_stock" ? "secondary" : "ghost"}
                onClick={() => setActiveTab("out_of_stock")}
                className={cn(
                  "h-7.5 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5",
                  activeTab === "out_of_stock" ? "bg-raised text-bad font-semibold shadow-xs" : "text-muted"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-bad" />
                <span>{t("filterOutOfStock")}</span>
                <span className="text-[11px] font-mono opacity-80">{stats.outOfStock}</span>
              </Button>

              <Button
                size="sm"
                variant={activeTab === "paused" ? "secondary" : "ghost"}
                onClick={() => setActiveTab("paused")}
                className={cn(
                  "h-7.5 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1.5",
                  activeTab === "paused" ? "bg-raised text-fg font-semibold shadow-xs" : "text-muted"
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-faint" />
                <span>{t("filterPaused")}</span>
                <span className="text-[11px] font-mono opacity-80">{stats.paused}</span>
              </Button>
            </div>

            {/* Smart Table */}
            {filteredProducts.length === 0 ? (
              <div className="p-8 text-center">
                <Package size={32} className="mx-auto text-faint mb-2" />
                <p className="text-[13.5px] font-medium text-fg mb-1">{t("noMatchingProducts")}</p>
                <p className="text-[12px] text-muted mb-3">
                  {t("productsPageNoMatchHint")}
                </p>
                <Button size="sm" variant="secondary" onClick={resetFilters}>
                  {t("clearFilters")}
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left border-collapse">
                  <thead>
                    <tr className="text-[11.5px] font-semibold text-faint uppercase tracking-wider border-b border-line bg-raised/20">
                      <th className="px-4 py-3">{t("product")}</th>
                      <th className="px-3 py-3 hidden sm:table-cell">{t("category")}</th>
                      <th className="min-w-[176px] px-3 py-3 whitespace-nowrap">{t("productsPageStockCondition")}</th>
                      <th className="px-3 py-3 hidden md:table-cell">{t("variants")}</th>
                      <th className="w-[116px] px-3 py-3 text-center whitespace-nowrap">{t("toggleStatus")}</th>
                      <th className="w-32 px-3 py-3 text-center whitespace-nowrap">{t("actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line text-[13px]">
                    {paginatedProducts.map((p) => {
                      const stockState = inventoryStockState(p, 20);
                      const isInventoryManaged = isInventoryManagedProduct(p);
                      const isLowStock = stockState === "low";
                      const isOutOfStock = stockState === "out";
                      const stockTone = stockState === "not_managed"
                        ? "iris"
                        : isOutOfStock ? "bad" : isLowStock ? "warn" : "good";
                      const stockLabel = stockState === "not_managed"
                        ? (p.pricing_strategy ?? "fixed").toUpperCase()
                        : isOutOfStock
                          ? t("outOfStockLabel")
                          : isLowStock
                            ? t("lowStockLabel")
                            : t("inStockLabel");

                      const isToggling = togglingId === p.id;
                      const isActive = p.status === "active";
                      const nextStatus = nextSellerProductStatus(p.status);

                      return (
                        <tr
                          key={p.id}
                          className={cn(
                            "hover:bg-raised/50 transition-colors",
                            p.status === "paused" && "opacity-75"
                          )}
                        >
                          {/* Product Info */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <ProductCover coverId={parseCoverId(p)} title={p.title} className="h-9 w-9 rounded-lg shrink-0" />
                              <div className="min-w-0">
                                <Link
                                  href={`/seller/products/${p.id}`}
                                  className="font-medium text-[13.5px] text-fg hover:text-iris transition-colors truncate block max-w-[240px] sm:max-w-[300px]"
                                  title={p.title}
                                >
                                  {p.title}
                                </Link>
                                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-faint">
                                  {p.service_type && (
                                    <span className="inline-flex items-center gap-1 text-[10.5px] text-iris-hi bg-iris-soft px-1.5 py-0.2 rounded font-medium">
                                      <Bolt size={11} /> {p.service_type}
                                    </span>
                                  )}
                                  <span className="font-mono">#{p.id}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Category */}
                          <td className="px-3 py-3 text-muted hidden sm:table-cell">
                            {p.category_name ?? "—"}
                          </td>

                          {/* Stock and Progress Indicator */}
                          <td className="px-3 py-3">
                            <div className="space-y-1 min-w-[130px]">
                              <div className="flex items-center justify-between gap-2 text-[12px]">
                                <span className="font-mono font-bold tabular text-fg">
                                  {isInventoryManaged ? p.total_stock.toLocaleString() : "—"}
                                </span>
                                <Tag tone={stockTone}>{stockLabel}</Tag>
                              </div>
                              <div className="w-full bg-raised h-1 rounded-full overflow-hidden">
                                <div
                                  className={cn(
                                    "h-full rounded-full transition-all",
                                    stockState === "not_managed"
                                      ? "bg-iris w-full"
                                      : isOutOfStock
                                        ? "w-0"
                                        : isLowStock
                                          ? "bg-warn w-1/4"
                                          : "bg-good w-4/5"
                                  )}
                                />
                              </div>
                              {/* In-place Quick Restock Button */}
                              {isInventoryManaged && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setRestockProduct(p)}
                                  className={cn(
                                    "h-6 px-1.5 text-[11px] font-semibold gap-1 transition-colors mt-0.5",
                                    isOutOfStock
                                      ? "text-bad hover:bg-bad-soft"
                                      : isLowStock
                                        ? "text-warn hover:bg-warn-soft"
                                        : "text-iris hover:bg-iris-soft"
                                  )}
                                >
                                  <Plus size={11} />
                                  <span>{t("addStock")}</span>
                                </Button>
                              )}
                            </div>
                          </td>

                          {/* Variants Count / Link to Inventory */}
                          <td className="px-3 py-3 hidden md:table-cell">
                            {isInventoryManaged ? (
                              <Link
                                href={`/seller/inventory?product=${p.id}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-line bg-surface hover:bg-raised hover:border-iris/40 text-fg transition-all group"
                                title={t("productsPageInventoryTitle")}
                              >
                                <Package size={12} className="text-iris group-hover:scale-110 transition-transform" />
                                <span className="font-mono font-bold text-[12.5px]">{p.variant_count}</span>
                                <span className="text-[11.5px] text-muted group-hover:text-fg">{t("variants").toLowerCase()}</span>
                                <ChevronRight size={12} className="text-faint group-hover:text-iris transition-colors" />
                              </Link>
                            ) : (
                              <Tag tone="iris">{(p.pricing_strategy ?? "fixed").toUpperCase()}</Tag>
                            )}
                          </td>

                          {/* Status Toggle Switch */}
                          <td className="w-[116px] px-3 py-3 text-center">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={isToggling || nextStatus === null}
                              onClick={() => handleToggleStatus(p)}
                              title={nextStatus === null ? t("suspendedStatus") : isActive ? t("pause") : t("activate")}
                              className={cn(
                                "h-7 px-2.5 rounded-full border text-[11.5px] font-semibold transition-all",
                                isActive
                                  ? "border-good/30 bg-good-soft text-good hover:bg-good-soft/80"
                                  : "border-line-2 bg-raised text-faint hover:text-fg hover:bg-surface"
                              )}
                            >
                              <span
                                className={cn(
                                  "w-1.5 h-1.5 rounded-full mr-1.5",
                                  isActive ? "bg-good" : "bg-faint"
                                )}
                              />
                              {isActive
                                ? t("activeStatus")
                                : p.status === "suspended"
                                  ? t("suspendedStatus")
                                  : p.status === "draft"
                                    ? t("draftStatus")
                                    : t("pausedStatus")}
                            </Button>
                          </td>

                          {/* Actions */}
                          <td className="w-32 px-3 py-3">
                            <div className="grid grid-cols-3 justify-items-center gap-1">
                              <Link href={`/products/${p.id}`} title={t("viewPurchasePage")}>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                  <Eye size={14} />
                                </Button>
                              </Link>
                              <Link href={`/seller/products/${p.id}`} title={t("edit")}>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-iris hover:text-iris-hi">
                                  <Edit2 size={14} />
                                </Button>
                              </Link>
                              {p.status === "active" && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 w-7 p-0 text-bad hover:text-bad"
                                  onClick={() => remove(p.id)}
                                  title={t("pause")}
                                >
                                  <Trash size={14} />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-3 border-t border-line flex items-center justify-between bg-raised/20 text-xs">
                <span className="text-muted text-[12px]">
                  {t("paginationProducts", {
                    from: (page - 1) * PAGE_SIZE + 1,
                    to: Math.min(page * PAGE_SIZE, filteredProducts.length),
                    total: filteredProducts.length,
                  })}
                </span>
                <Pagination page={page} totalPages={totalPages} onChange={setPage} />
              </div>
            )}
          </Card>
        </>
      )}

      {/* In-Place Quick Restock Modal */}
      {restockProduct && (
        <InPlaceRestockModal
          product={restockProduct}
          isOpen={!!restockProduct}
          onClose={() => setRestockProduct(null)}
          onSuccess={handleRestockSuccess}
        />
      )}
    </div>
  );
}

/** In-Place Quick Restock Modal co-located inside products page to satisfy architecture boundaries */
function InPlaceRestockModal({
  product,
  isOpen,
  onClose,
  onSuccess,
}: {
  product: SellerProduct;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (variantId: number, addedCount: number) => void;
}) {
  const t = useTranslations("seller");
  const { formatBrowseMoney } = useMoney();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(true);
  const [textData, setTextData] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [autoDedupe, setAutoDedupe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successCount, setSuccessCount] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTextData("");
      setUploadedFileName(null);
      setError(null);
      setSuccessCount(null);
      return;
    }

    setLoadingVariants(true);
    api.sellerProduct(product.id)
      .then((detail) => {
        const eligibleVariants = restockableVariants(detail.variants || []);
        setVariants(eligibleVariants);
        if (eligibleVariants.length > 0) {
          const sorted = [...eligibleVariants].sort((a, b) => a.stock_count - b.stock_count);
          setSelectedVariantId(sorted[0].id);
        }
      })
      .catch(() => {
        setError(t("variantsLoadFailed"));
      })
      .finally(() => {
        setLoadingVariants(false);
      });
  }, [isOpen, product.id]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const parsedItems = useMemo(
    () => parseResourceItems(textData, autoDedupe),
    [textData, autoDedupe],
  );

  const handleDownloadTemplate = (format: "txt" | "csv") => {
    downloadRestockTemplate(format, "sample_restock_template");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      if (!raw) return;
      setTextData((prev) => mergeRestockText(prev, parseRestockFileContent(file.name, raw)));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleRestock = async () => {
    if (!selectedVariantId) {
      setError(t("variantRequired"));
      return;
    }
    if (parsedItems.length === 0) {
      setError(t("resourcesRequired"));
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await api.addResources(selectedVariantId, parsedItems);
      setSuccessCount(result.count);
      onSuccess(selectedVariantId, result.count);
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("inventoryAddFailed");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-panel/75 backdrop-blur-xs animate-fade">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="restock-title"
        className="w-full max-w-xl bg-surface border border-line rounded-2xl shadow-card-lg overflow-hidden animate-rise"
      >
        {/* Header */}
        <div className="p-4 border-b border-line bg-raised/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ProductCover coverId={parseCoverId(product)} title={product.title} className="h-8 w-8 rounded-lg shrink-0" />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-iris bg-iris-soft px-1.5 py-0.2 rounded">
                  {t("quickRestockTitle")}
                </span>
                <span className="text-[11px] text-faint font-mono">#{product.id}</span>
              </div>
              <h3 id="restock-title" className="text-[13.5px] font-bold text-fg truncate max-w-[320px]">
                {product.title}
              </h3>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0 text-muted hover:text-fg">
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
          {loadingVariants ? (
            <div className="py-8 text-center">
              <Spinner />
            </div>
          ) : variants.length === 0 ? (
            <div className="py-6 text-center text-muted text-xs space-y-2">
              <Package size={28} className="mx-auto text-faint" />
              <p>{t("noVariantsForRestock")}</p>
            </div>
          ) : (
            <>
              {/* Visual Variant Selector Grid / Cards */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="font-semibold text-fg">
                    {t("selectVariant")} · {t("variantsAvailable", { count: variants.length })}
                  </span>
                  <span className="text-[11px] text-faint">{t("variantSelectionHint")}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-0.5">
                  {variants.map((v) => {
                    const isSelected = selectedVariantId === v.id;
                    const isOut = v.stock_count === 0;
                    const isLow = v.stock_count > 0 && v.stock_count <= 5;
                    const tone = isOut ? "bad" : isLow ? "warn" : "good";
                    const toneLabel = isOut
                      ? t("stockOutCount", { count: 0 })
                      : isLow
                        ? t("stockLowCount", { count: v.stock_count })
                        : t("stockCountItems", { count: v.stock_count });

                    return (
                      <div
                        key={v.id}
                        onClick={() => setSelectedVariantId(v.id)}
                        className={cn(
                          "p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex flex-col justify-between gap-1.5 text-left",
                          isSelected
                            ? "border-iris bg-iris-soft/40 shadow-xs ring-1 ring-iris"
                            : "border-line bg-surface hover:bg-raised/60 hover:border-line-2"
                        )}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span
                            className={cn(
                              "font-semibold line-clamp-2 text-[12.5px] leading-snug",
                              isSelected ? "text-iris-hi" : "text-fg"
                            )}
                            title={v.name}
                          >
                            {v.name}
                          </span>
                          {isSelected && (
                            <span className="shrink-0 text-iris">
                              <Check size={14} />
                            </span>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                          <span className="font-mono font-bold text-fg">
                            {formatBrowseMoney(v.price)}
                          </span>
                          <Tag tone={tone} className="text-[10px]">
                            {toneLabel}
                          </Tag>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Data Input Area with Clear Guidance */}
              <div className="space-y-2 pt-1 border-t border-line">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[12px]">
                  <label className="font-semibold text-fg flex items-center gap-1.5">
                    <span>{t("pasteResourcesHint")}</span>
                  </label>

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

                <div className="p-2 rounded-lg bg-raised/50 border border-line text-[11.5px] text-muted space-y-0.5">
                  <p>
                    💡 <strong>{t("restockRuleTitle")}</strong> {t("restockRuleLead")} <code className="text-fg font-mono">user|pass|2fa</code> {t("restockRuleOr")} <code className="text-fg font-mono">license_key</code>{t("restockRuleEnd")}
                  </p>
                </div>

                <Textarea
                  rows={5}
                  value={textData}
                  onChange={(e) => {
                    setTextData(e.target.value);
                    if (uploadedFileName) setUploadedFileName(null);
                  }}
                  placeholder={`uid1|pass1|cookie1\nuid2|pass2|cookie2\nkey_token_example_03`}
                  className="font-mono text-xs leading-relaxed"
                />

                {/* Sub controls & metrics */}
                <div className="flex items-center justify-between text-[11.5px] text-muted">
                  <span className={cn(parsedItems.length > 0 && "text-good font-semibold")}>
                    {t("recognizedLines", { count: parsedItems.length })}
                    {uploadedFileName && <span className="text-muted font-normal ml-1 font-mono">({uploadedFileName})</span>}
                  </span>
                  <label className="flex items-center gap-1.5 cursor-pointer text-muted hover:text-fg">
                    <Input
                      type="checkbox"
                      checked={autoDedupe}
                      onChange={(e) => setAutoDedupe(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-line-2 text-iris focus:ring-0 p-0"
                    />
                    <span>{t("skipDuplicates")}</span>
                  </label>
                </div>

                {/* Live parsed preview feedback */}
                {parsedItems.length > 0 && (
                  <div className="p-2 rounded-lg bg-good-soft/70 border border-good/20 text-good text-[11.5px] space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <CheckCircle2 size={13} />
                      <span>
                        {t("restockReady", { count: parsedItems.length })}
                        {uploadedFileName && <span> {t("fromFile", { name: uploadedFileName })}</span>}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-faint truncate bg-surface/60 px-2 py-0.5 rounded border border-line">
                      {t("firstLineSample", { value: parsedItems[0] })}
                    </div>
                  </div>
                )}
              </div>

              {/* Status alerts */}
              {error && (
                <div className="p-2.5 rounded-lg bg-bad-soft border border-bad/20 text-bad text-xs font-medium">
                  {error}
                </div>
              )}

              {successCount !== null && (
                <div className="p-2.5 rounded-lg bg-good-soft border border-good/20 text-good text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 size={14} />
                  <span>{t("restockSuccess", { count: successCount })}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-raised/50 border-t border-line flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            onClick={handleRestock}
            disabled={submitting || parsedItems.length === 0 || !selectedVariantId || variants.length === 0}
            className="gap-1.5"
          >
            {submitting ? (
              <span>{t("inventoryAdding")}</span>
            ) : (
              <>
                <Plus size={14} />
                <span>{t("confirmRestock")}</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

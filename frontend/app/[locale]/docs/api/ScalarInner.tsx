"use client";

import { useEffect, useRef, type RefObject } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

/* GMMO tokens (app/globals.css) mapped onto Scalar's theme variables. Light
   content with a dark code column (request/response samples) in both modes;
   the dark mode toggle re-maps the content onto the ink-panel palette. The
   sidebar sticks under the docs top bar (h-14 = 56px). */
const GMMO_CSS = `
.scalar-app {
  --scalar-custom-header-height: 56px;
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-radius: 8px;
  --scalar-radius-lg: var(--radius-card);
  --scalar-radius-xl: var(--radius-card);
  --scalar-sidebar-width: 272px;
}
.light-mode {
  --scalar-color-1: var(--color-fg);
  --scalar-color-2: var(--color-muted);
  --scalar-color-3: var(--color-faint);
  --scalar-color-accent: var(--color-iris);
  --scalar-background-1: var(--color-surface);
  --scalar-background-2: var(--color-base);
  --scalar-background-3: var(--color-raised);
  --scalar-background-accent: var(--color-iris-soft);
  --scalar-border-color: var(--color-line);
  --scalar-sidebar-background-1: var(--color-base);
  --scalar-sidebar-color-1: var(--color-fg);
  --scalar-sidebar-color-2: var(--color-muted);
  --scalar-sidebar-color-active: var(--color-iris-hi);
  --scalar-sidebar-item-active-background: var(--color-iris-soft);
  --scalar-sidebar-item-hover-background: var(--color-raised);
  --scalar-sidebar-border-color: var(--color-line);
  --scalar-sidebar-search-background: var(--color-surface);
  --scalar-sidebar-search-border-color: var(--color-line-2);
  --scalar-color-green: var(--color-good);
  --scalar-color-red: var(--color-bad);
  --scalar-color-yellow: var(--color-warn);
  --scalar-color-blue: var(--color-iris);
  --scalar-color-orange: var(--color-warn);
  --scalar-color-purple: var(--color-iris-hi);
  --scalar-button-1: var(--color-iris);
  --scalar-button-1-hover: var(--color-iris-hi);
  --scalar-button-1-color: var(--color-surface);
}
.dark-mode {
  --scalar-color-1: var(--docs-ink-fg);
  --scalar-color-2: var(--docs-ink-muted);
  --scalar-color-3: var(--docs-ink-faint);
  --scalar-color-accent: var(--docs-ink-accent);
  --scalar-background-1: var(--docs-ink);
  --scalar-background-2: var(--docs-ink-raised);
  --scalar-background-3: var(--docs-ink-line);
  --scalar-background-accent: var(--docs-ink-line);
  --scalar-border-color: var(--docs-ink-line);
  --scalar-sidebar-background-1: var(--docs-ink);
  --scalar-sidebar-color-1: var(--docs-ink-fg);
  --scalar-sidebar-color-2: var(--docs-ink-muted);
  --scalar-sidebar-color-active: var(--docs-ink-accent);
  --scalar-sidebar-item-active-background: var(--docs-ink-line);
  --scalar-sidebar-item-hover-background: var(--docs-ink-raised);
  --scalar-sidebar-border-color: var(--docs-ink-line);
  --scalar-sidebar-search-background: var(--docs-ink-raised);
  --scalar-sidebar-search-border-color: var(--docs-ink-line);
  --scalar-button-1: var(--color-iris);
  --scalar-button-1-hover: var(--color-iris-hi);
  --scalar-button-1-color: var(--color-surface);
}
/* The code column: request and response samples on the ink panel. */
.scalar-app .examples .scalar-card,
.scalar-app .introduction-card .scalar-card,
.scalar-app .markdown pre {
  --scalar-background-1: var(--docs-ink);
  --scalar-background-2: var(--docs-ink-raised);
  --scalar-background-3: var(--docs-ink-line);
  --scalar-border-color: var(--docs-ink-line);
  --scalar-color-1: var(--docs-ink-fg);
  --scalar-color-2: var(--docs-ink-muted);
  --scalar-color-3: var(--docs-ink-faint);
  background: var(--docs-ink);
  border-color: var(--docs-ink-line);
  color: var(--docs-ink-fg);
}
.scalar-app .markdown table { font-size: 13px; }
`;

/* Scalar collapses the guide group (the `#` heading of info.description)
   by default; open it once so the guide's sections show in the sidebar. */
function useOpenGuideGroup(root: RefObject<HTMLDivElement | null>, title: string | undefined) {
  useEffect(() => {
    const host = root.current;
    if (!host || !title) return;
    const tryOpen = () => {
      // The toggle's accessible name is an sr-only span inside the group button.
      const label = [...host.querySelectorAll<HTMLElement>(".sr-only")]
        .find((el) => el.textContent?.trim() === `Open Group - ${title}`);
      const button = label?.closest<HTMLElement>("button, a");
      if (!button) return false;
      button.click();
      return true;
    };
    if (tryOpen()) return;
    const observer = new MutationObserver(() => { if (tryOpen()) observer.disconnect(); });
    observer.observe(host, { childList: true, subtree: true });
    const stop = window.setTimeout(() => observer.disconnect(), 10_000);
    return () => { observer.disconnect(); window.clearTimeout(stop); };
  }, [root, title]);
}

function guideTitle(spec: Record<string, unknown>): string | undefined {
  const description = (spec.info as { description?: string } | undefined)?.description ?? "";
  return /^#\s+(.+)$/m.exec(description.trim())?.[1]?.trim();
}

export default function ScalarInner({ spec }: { spec: Record<string, unknown> }) {
  const root = useRef<HTMLDivElement>(null);
  useOpenGuideGroup(root, guideTitle(spec));
  return (
    <div ref={root} className="gmmo-scalar flex-1">
      <ApiReferenceReact
        configuration={{
          content: spec,
          theme: "none",
          layout: "modern",
          customCss: GMMO_CSS,
          withDefaultFonts: false,
          darkMode: false,
          hideDarkModeToggle: false,
          showSidebar: true,
          hideSearch: false,
          searchHotKey: "k",
          defaultOpenAllTags: true,
          hideModels: true,
          documentDownloadType: "none",
          hideClientButton: true,
          hideTestRequestButton: false,
          telemetry: false,
          showDeveloperTools: "never",
          agent: { disabled: true },
          mcp: { disabled: true },
          authentication: { preferredSecurityScheme: "bearerAuth" },
          persistAuth: false,
          defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
          hiddenClients: {
            c: true, clojure: true, csharp: true, dart: true, fsharp: true, http: true, java: true,
            kotlin: true, node: true, objc: true, ocaml: true, powershell: true, r: true, ruby: true,
            rust: true, swift: true,
            shell: ["httpie", "wget"],
            js: ["jquery", "xhr", "ofetch", "axios"],
            python: ["python3", "httpx_sync", "httpx_async"],
            php: ["guzzle"],
          },
        }}
      />
    </div>
  );
}

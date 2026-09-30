"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

/* GMMO tokens (app/globals.css) mapped onto Scalar's theme variables. The
   storefront is light-only, so Scalar is pinned to light mode. */
const GMMO_CSS = `
.scalar-app, .light-mode {
  --scalar-font: var(--font-sans);
  --scalar-font-code: var(--font-mono);
  --scalar-radius: 8px;
  --scalar-radius-lg: var(--radius-card);
  --scalar-radius-xl: var(--radius-card);
  --scalar-color-1: var(--color-fg);
  --scalar-color-2: var(--color-muted);
  --scalar-color-3: var(--color-faint);
  --scalar-color-accent: var(--color-iris);
  --scalar-background-1: var(--color-surface);
  --scalar-background-2: var(--color-raised);
  --scalar-background-3: var(--color-line);
  --scalar-background-accent: var(--color-iris-soft);
  --scalar-border-color: var(--color-line);
  --scalar-color-green: var(--color-good);
  --scalar-color-red: var(--color-bad);
  --scalar-color-yellow: var(--color-warn);
  --scalar-color-blue: var(--color-iris);
  --scalar-color-orange: var(--color-warn);
  --scalar-color-purple: var(--color-iris-hi);
  --scalar-button-1: var(--color-iris);
  --scalar-button-1-hover: var(--color-iris-hi);
  --scalar-button-1-color: #ffffff;
}
.scalar-app .references-layout { min-height: 0; }
`;

export default function ScalarInner({ spec }: { spec: Record<string, unknown> }) {
  return (
    <div className="gmmo-scalar overflow-hidden rounded-card border border-line bg-surface">
      <ApiReferenceReact
        configuration={{
          content: spec,
          theme: "none",
          customCss: GMMO_CSS,
          withDefaultFonts: false,
          forceDarkModeState: "light",
          hideDarkModeToggle: true,
          showSidebar: false,
          hideSearch: true,
          hideModels: true,
          hideDownloadButton: true,
          documentDownloadType: "none",
          hideClientButton: true,
          hideTestRequestButton: false,
          telemetry: false,
          showDeveloperTools: "never",
          agent: { disabled: true },
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

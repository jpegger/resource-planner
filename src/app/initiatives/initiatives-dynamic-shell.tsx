"use client";

import dynamic from "next/dynamic";

import type { InitiativeDTO, ResourceOption } from "./initiatives-client";

/**
 * Loads the heavy initiatives UI only on the client so SSR HTML never hydrates
 * against a mismatched Turbopack client bundle (dev-only placeholder/header drift).
 */
const InitiativesPageClient = dynamic(
  () =>
    import("./initiatives-client").then((m) => ({
      default: m.InitiativesPageClient,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="text-muted-foreground flex min-h-[240px] flex-col items-center justify-center gap-2 p-8 text-sm">
        Loading initiatives…
      </div>
    ),
  }
);

type Props = {
  initiatives: InitiativeDTO[];
  resources: ResourceOption[];
};

export function InitiativesDynamicShell(props: Props) {
  return <InitiativesPageClient {...props} />;
}

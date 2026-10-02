"use client";

import { Suspense } from "react";

import { CrmDealsPage } from "@/components/crm/crm-page";

// "CRM & Deals" — the /pipelines route is kept for existing links.
// `useSearchParams` (the `?view=` tab) needs a Suspense boundary or the
// production build bails out of prerendering with an error; the thin
// wrapper supplies it and the inner component holds all the state.
export default function PipelinesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-12 w-full animate-pulse rounded-xl bg-muted/60" />
          <div className="flex gap-3 overflow-hidden">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        </div>
      }
    >
      <CrmDealsPage />
    </Suspense>
  );
}

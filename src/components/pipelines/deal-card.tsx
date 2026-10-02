"use client";

import { useLocale, useTranslations } from "next-intl";
import { AlarmClock, Check, Clock, X } from "lucide-react";

import type { Deal, PipelineStage } from "@/types";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { formatDayTime, intlLocale } from "@/lib/crm/format";
import { AgentChip } from "@/components/crm/crm-ui";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  /** A pending follow-up on this deal is past due. */
  overdue?: boolean;
  isOverlay?: boolean;
}

export function DealCard({ deal, stage, onEdit, overdue, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const locale = intlLocale(useLocale());
  const contactName = deal.contact?.name || null;
  const contactPhone = deal.contact?.phone || null;
  const contactLine =
    [contactName, contactPhone].filter(Boolean).join(" • ") || t("noContact");
  const updated = formatDayTime(
    deal.updated_at ?? deal.created_at,
    new Date(),
    { today: t("today"), yesterday: t("yesterday"), tomorrow: t("tomorrow") },
    locale,
  );

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border bg-card py-3 pl-4 pr-3 text-left shadow-sm transition-all ${
        overdue ? "border-red-500/40" : "border-border/60"
      } ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 break-words text-sm font-semibold leading-snug text-foreground">
          {deal.title}
        </h4>
        {overdue && (
          <span
            title={t("overdueFollowUp")}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white"
          >
            <AlarmClock className="h-3 w-3" />
            {t("overdue")}
          </span>
        )}
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400">
            <X className="h-3 w-3" />
            {t("lost")}
          </span>
        )}
      </div>

      <p className="mt-1 truncate text-xs text-muted-foreground" title={contactLine}>
        {contactLine}
      </p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-foreground tabular-nums">
          {new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
            Number(deal.value) || 0,
          )}
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
            {(deal.currency || DEFAULT_CURRENCY).toUpperCase()}
          </span>
        </span>
        <AgentChip
          name={deal.assignee?.full_name || deal.assignee?.email || null}
          unassignedLabel={t("unassigned")}
          className="max-w-[55%]"
        />
      </div>

      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3" />
        {t("updated", { when: updated })}
      </p>
    </button>
  );
}

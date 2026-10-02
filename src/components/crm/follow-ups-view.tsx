"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  AlarmClock,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  MessageSquare,
  Phone,
  Plus,
  Send,
  SunMedium,
} from "lucide-react";
import { toast } from "sonner";

import type { DealFollowUp } from "@/types";
import { Button } from "@/components/ui/button";
import { bucketFollowUps } from "@/lib/crm/metrics";
import { formatDayTime, intlLocale } from "@/lib/crm/format";
import { AgentChip, EmptyPanel, StatCard, TableSkeleton } from "./crm-ui";
import type { CrmData } from "./use-crm-data";
import { cn } from "@/lib/utils";

const CHANNEL_ICON = {
  whatsapp: MessageCircle,
  call: Phone,
  task: ClipboardList,
} as const;

export function FollowUpsView({
  data,
  followUps,
  canWrite,
  onAdd,
  onReschedule,
}: {
  data: CrmData;
  /** Already filtered by agent + search. */
  followUps: DealFollowUp[];
  canWrite: boolean;
  onAdd: () => void;
  onReschedule: (f: DealFollowUp) => void;
}) {
  const t = useTranslations("Crm.followUps");
  const [busyId, setBusyId] = useState<string | null>(null);
  const buckets = useMemo(() => bucketFollowUps(followUps, new Date()), [followUps]);
  const now = new Date();

  async function markDone(f: DealFollowUp) {
    setBusyId(f.id);
    const { error } = await data.supabase
      .from("deal_follow_ups")
      .update({ status: "done", completed_at: new Date().toISOString(), status_reason: "completed_manually" })
      .eq("id", f.id);
    setBusyId(null);
    if (error) {
      toast.error(t("markDoneFailed"));
      return;
    }
    toast.success(t("markedDone"));
    await data.refreshFollowUps();
  }

  if (data.loading) return <TableSkeleton rows={8} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        {canWrite && (
          <Button onClick={onAdd} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-1 h-4 w-4" />
            {t("add")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          tone="red"
          icon={AlarmClock}
          label={t("statMissed")}
          value={buckets.missed.length}
          hint={t("statMissedHint")}
        />
        <StatCard
          tone="green"
          icon={CalendarClock}
          label={t("statUpcoming")}
          value={buckets.upcoming.length}
          hint={t("statUpcomingHint")}
        />
        <StatCard
          tone="amber"
          icon={SunMedium}
          label={t("statToday")}
          value={buckets.dueToday.length}
          hint={t("statTodayHint")}
        />
        <StatCard
          tone="indigo"
          icon={Bot}
          label={t("statAutomated")}
          value={buckets.automated.length}
          hint={t("statAutomatedHint")}
        />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("missedTitle", { count: buckets.missed.length })}
        </h2>
        {buckets.missed.length === 0 ? (
          <EmptyPanel
            icon={CheckCircle2}
            tone="success"
            title={t("missedEmptyTitle")}
            hint={t("missedEmptyHint")}
          />
        ) : (
          <FollowUpList
            rows={buckets.missed}
            late
            now={now}
            data={data}
            canWrite={canWrite}
            busyId={busyId}
            onDone={markDone}
            onReschedule={onReschedule}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("upcomingTitle", { count: buckets.upcoming.length })}
        </h2>
        {buckets.upcoming.length === 0 ? (
          <EmptyPanel icon={CalendarClock} title={t("upcomingEmptyTitle")} hint={t("upcomingEmptyHint")} />
        ) : (
          <FollowUpList
            rows={buckets.upcoming}
            now={now}
            data={data}
            canWrite={canWrite}
            busyId={busyId}
            onDone={markDone}
            onReschedule={onReschedule}
          />
        )}
      </section>
    </div>
  );
}

function FollowUpList({
  rows,
  late,
  now,
  data,
  canWrite,
  busyId,
  onDone,
  onReschedule,
}: {
  rows: DealFollowUp[];
  late?: boolean;
  now: Date;
  data: CrmData;
  canWrite: boolean;
  busyId: string | null;
  onDone: (f: DealFollowUp) => void;
  onReschedule: (f: DealFollowUp) => void;
}) {
  const t = useTranslations("Crm.followUps");
  const tc = useTranslations("Crm.common");
  const locale = intlLocale(useLocale());
  const labels = { today: tc("today"), yesterday: tc("yesterday"), tomorrow: tc("tomorrow") };

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {rows.map((f) => {
        const Icon = f.is_automated ? Send : CHANNEL_ICON[f.channel] ?? ClipboardList;
        const deal = f.deal;
        const contact = deal?.contact;
        const agent = f.assigned_to ? data.memberById.get(f.assigned_to) : undefined;
        const conversationId = deal?.conversation_id;
        return (
          <li key={f.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  late
                    ? "bg-red-500/10 text-red-600 dark:text-red-400"
                    : f.is_automated
                      ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {deal?.title ?? t("unknownDeal")}
                  {f.is_automated && (
                    <span className="ml-2 rounded-full bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                      {t("automatedBadge")}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {[contact?.name, contact?.phone].filter(Boolean).join(" • ") || "—"}
                </p>
                {(f.note || f.template_name) && (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {f.is_automated && f.template_name ? t("templateLabel", { name: f.template_name }) : f.note}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <span
                className={cn(
                  "text-xs font-medium tabular-nums",
                  late ? "text-red-600 dark:text-red-400" : "text-foreground",
                )}
              >
                {formatDayTime(f.due_at, now, labels, locale)}
              </span>
              <AgentChip name={agent?.full_name ?? null} unassignedLabel={tc("unassigned")} />
              {canWrite && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === f.id}
                    onClick={() => onDone(f)}
                    className="border-border"
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    {t("markDone")}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onReschedule(f)} className="border-border">
                    <CalendarClock className="mr-1 h-3.5 w-3.5" />
                    {t("reschedule")}
                  </Button>
                </>
              )}
              {conversationId ? (
                <Link
                  href={`/inbox?c=${conversationId}`}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {t("openChat")}
                </Link>
              ) : (
                <span className="text-xs text-muted-foreground" title={t("noChatHint")}>
                  {t("noChat")}
                </span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

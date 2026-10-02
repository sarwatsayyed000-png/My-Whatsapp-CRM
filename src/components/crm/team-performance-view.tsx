"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Briefcase,
  Mail,
  Percent,
  Target,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import type { AgentTarget, ReportFrequency, TargetPeriod, TeamReportSettings } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/currency";
import { pairResponseSamples } from "@/lib/dashboard/response-time";
import {
  averageResponseByAgent,
  buildLeaderboard,
  computeKpis,
  DEFAULT_TARGET_DEALS_WON,
  periodStart,
  type PerfDeal,
} from "@/lib/crm/metrics";
import { formatMinutes } from "@/lib/crm/format";
import { AGENT_ALL, AGENT_UNASSIGNED, matchesAgent, matchesSearch } from "@/lib/crm/filters";
import { EMAIL_PROVIDER_CONFIGURED } from "@/lib/crm/email";
import { EmptyPanel, NativeSelect, ProgressBar, SettingRow, StatCard, TableSkeleton } from "./crm-ui";
import type { CrmData, CrmMember } from "./use-crm-data";

interface PerfBundle {
  deals: PerfDeal[];
  targets: AgentTarget[];
  responseMinutes: Map<string, number | null>;
}

const MESSAGE_CAP = 20_000;

export function TeamPerformanceView({
  data,
  agentFilter,
  search,
  canEditSettings,
}: {
  data: CrmData;
  agentFilter: string;
  search: string;
  canEditSettings: boolean;
}) {
  const t = useTranslations("Crm.performance");
  const { defaultCurrency } = useAuth();
  const { supabase, accountId, members } = data;

  const [period, setPeriod] = useState<TargetPeriod>("monthly");
  const [bundle, setBundle] = useState<PerfBundle | null>(null);
  const [error, setError] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targetAgent, setTargetAgent] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const start = periodStart(period, new Date()).toISOString();
    const [dealsRes, targetsRes, msgRes, convRes] = await Promise.all([
      supabase
        .from("deals")
        .select("assigned_to, status, value, created_at, closed_at")
        .eq("account_id", accountId)
        .or(`status.eq.open,created_at.gte.${start},closed_at.gte.${start}`),
      supabase.from("agent_targets").select("*").eq("account_id", accountId).eq("period", period),
      supabase
        .from("messages")
        .select("conversation_id, sender_type, created_at")
        .gte("created_at", start)
        .order("conversation_id", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(MESSAGE_CAP),
      supabase
        .from("conversations")
        .select("id, assigned_agent_id")
        .eq("account_id", accountId)
        .not("assigned_agent_id", "is", null),
    ]);
    if (dealsRes.error) {
      setError(true);
      return;
    }
    const convAgent = new Map<string, string | null>(
      (convRes.data ?? []).map((c) => [c.id as string, (c.assigned_agent_id as string | null) ?? null]),
    );
    const samples = pairResponseSamples(
      (msgRes.data ?? []) as { conversation_id: string; sender_type: string; created_at: string }[],
    );
    setError(false);
    setBundle({
      deals: (dealsRes.data ?? []) as PerfDeal[],
      targets: (targetsRes.data ?? []) as AgentTarget[],
      responseMinutes: averageResponseByAgent(samples, convAgent),
    });
  }, [supabase, accountId, period]);

  useEffect(() => {
    // State is set inside the async load's callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const agents = useMemo(
    () => members.filter((m) => m.account_role !== "viewer"),
    [members],
  );

  const view = useMemo(() => {
    if (!bundle) return null;
    const now = new Date();
    const deals = bundle.deals.filter((d) => matchesAgent(d.assigned_to, agentFilter));
    const kpis = computeKpis(deals, period, now);
    const targets = new Map(bundle.targets.map((x) => [x.agent_id, x.target_deals_won]));
    const visibleAgents = agents.filter(
      (a) =>
        (agentFilter === AGENT_ALL || a.id === agentFilter) &&
        agentFilter !== AGENT_UNASSIGNED &&
        matchesSearch(search, [a.full_name, a.email]),
    );
    const rows = buildLeaderboard({
      agents: visibleAgents.map((a) => ({ id: a.id, user_id: a.user_id, full_name: a.full_name })),
      deals,
      targets,
      responseMinutes: bundle.responseMinutes,
      period,
      now,
    });
    return { kpis, rows };
  }, [bundle, agentFilter, search, agents, period]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("overviewPeriod")}
          <NativeSelect
            value={period}
            onChange={(e) => {
              setBundle(null);
              setPeriod(e.target.value as TargetPeriod);
            }}
            className="w-48"
          >
            <option value="weekly">{t("weekly")}</option>
            <option value="monthly">{t("monthly")}</option>
            <option value="quarterly">{t("quarterly")}</option>
          </NativeSelect>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canEditSettings}
            title={canEditSettings ? undefined : t("adminOnly")}
            onClick={() => {
              setTargetAgent(null);
              setTargetsOpen(true);
            }}
            className="border-border bg-card"
          >
            <Target className="mr-1.5 h-4 w-4" />
            {t("configureTargets")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setEmailOpen(true)}
            className="border-border bg-card"
          >
            <Mail className="mr-1.5 h-4 w-4" />
            {t("emailReportSettings")}
          </Button>
        </div>
      </div>

      {error ? (
        <EmptyPanel icon={Users} title={t("loadFailed")}>
          <Button size="sm" variant="outline" onClick={() => void load()} className="mt-2">
            {t("retry")}
          </Button>
        </EmptyPanel>
      ) : !view ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[104px] animate-pulse rounded-xl border border-border bg-card" />
            ))}
          </div>
          <TableSkeleton rows={5} />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard icon={Briefcase} label={t("kpiActive")} value={view.kpis.totalActiveLeads} hint={t("kpiActiveHint")} />
            <StatCard tone="green" icon={Trophy} label={t("kpiWon")} value={view.kpis.dealsWon} hint={t(`hint_${period}`)} />
            <StatCard
              tone="primary"
              icon={Wallet}
              label={t("kpiClosedValue")}
              value={formatCurrency(view.kpis.closedValue, defaultCurrency)}
              hint={t(`hint_${period}`)}
            />
            <StatCard
              tone="indigo"
              icon={Percent}
              label={t("kpiWinRate")}
              value={`${view.kpis.winRate}%`}
              hint={t("kpiWinRateHint", { won: view.kpis.dealsWon, lost: view.kpis.dealsLost })}
            />
          </div>

          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">{t("leaderboardTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("leaderboardDesc")}</p>
            </header>
            {view.rows.length === 0 ? (
              <div className="p-4">
                <EmptyPanel icon={Users} title={t("noAgents")} hint={t("noAgentsHint")} />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-muted-foreground">{t("colAgent")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colLeads")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colWon")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colLost")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colRevenue")}</TableHead>
                    <TableHead className="min-w-[180px] text-muted-foreground">{t("colTarget")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colResponse")}</TableHead>
                    <TableHead className="text-right text-muted-foreground">{t("colActions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.rows.map((r, i) => (
                    <TableRow key={r.agentId} className="border-border">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              i === 0 && r.revenueClosed > 0
                                ? "flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-bold text-amber-600 dark:text-amber-400"
                                : "flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground"
                            }
                          >
                            {i + 1}
                          </span>
                          <span className="font-medium text-foreground">{r.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r.leadsAssigned}</TableCell>
                      <TableCell className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                        {r.won}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-red-600 tabular-nums dark:text-red-400">
                        {r.lost}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(r.revenueClosed, defaultCurrency)}
                      </TableCell>
                      <TableCell>
                        <ProgressBar percent={r.progress.percent} met={r.progress.met} />
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t("targetLine", { target: r.targetDealsWon, percent: r.progress.rawPercent })}
                        </p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinutes(r.avgResponseMinutes)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!canEditSettings}
                          onClick={() => {
                            setTargetAgent(r.agentId);
                            setTargetsOpen(true);
                          }}
                          className="text-primary hover:bg-primary/10"
                        >
                          {t("editTarget")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </>
      )}

      <TargetsDialog
        open={targetsOpen}
        onOpenChange={setTargetsOpen}
        data={data}
        agents={targetAgent ? agents.filter((a) => a.id === targetAgent) : agents}
        period={period}
        existing={bundle?.targets ?? []}
        onSaved={load}
      />
      <EmailReportDialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        data={data}
        canEdit={canEditSettings}
      />
    </div>
  );
}

function TargetsDialog({
  open,
  onOpenChange,
  data,
  agents,
  period,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: CrmData;
  agents: CrmMember[];
  period: TargetPeriod;
  existing: AgentTarget[];
  onSaved: () => void;
}) {
  const t = useTranslations("Crm.targets");
  const tp = useTranslations("Crm.performance");
  const { defaultCurrency } = useAuth();
  const [values, setValues] = useState<Record<string, { won: string; revenue: string }>>({});
  const [saving, setSaving] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    const next: Record<string, { won: string; revenue: string }> = {};
    for (const a of agents) {
      const row = existing.find((x) => x.agent_id === a.id);
      next[a.id] = {
        won: String(row?.target_deals_won ?? DEFAULT_TARGET_DEALS_WON),
        revenue: String(row?.target_revenue ?? 0),
      };
    }
    setValues(next);
  }, [open, agents, existing]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    if (!data.accountId) return;
    const rows = agents.map((a) => ({
      account_id: data.accountId,
      agent_id: a.id,
      period,
      target_deals_won: Math.max(0, Math.round(Number(values[a.id]?.won) || 0)),
      target_revenue: Math.max(0, Number(values[a.id]?.revenue) || 0),
    }));
    setSaving(true);
    const { error } = await data.supabase
      .from("agent_targets")
      .upsert(rows, { onConflict: "account_id,agent_id,period" });
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {agents.length === 1 ? t("editTitle", { name: agents[0].full_name }) : t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc", { period: tp(period) })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto py-1">
          {agents.length === 0 && <p className="text-sm text-muted-foreground">{tp("noAgents")}</p>}
          {agents.map((a) => (
            <div key={a.id} className="grid grid-cols-1 items-end gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_110px_140px]">
              <p className="truncate text-sm font-medium text-foreground sm:pb-2">{a.full_name}</p>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">{t("dealsWon")}</Label>
                <Input
                  type="number"
                  min={0}
                  value={values[a.id]?.won ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id], won: e.target.value } }))}
                  className="border-border bg-muted"
                />
              </div>
              <div className="grid gap-1">
                <Label className="text-xs text-muted-foreground">{t("revenue", { currency: defaultCurrency })}</Label>
                <Input
                  type="number"
                  min={0}
                  value={values[a.id]?.revenue ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [a.id]: { ...v[a.id], revenue: e.target.value } }))}
                  className="border-border bg-muted"
                />
              </div>
            </div>
          ))}
        </div>
        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving || agents.length === 0} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function EmailReportDialog({
  open,
  onOpenChange,
  data,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: CrmData;
  canEdit: boolean;
}) {
  const t = useTranslations("Crm.emailReport");
  const [enabled, setEnabled] = useState(false);
  const [frequency, setFrequency] = useState<ReportFrequency>("weekly");
  const [recipients, setRecipients] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !data.accountId) return;
    let cancelled = false;
    (async () => {
      const { data: row } = await data.supabase
        .from("team_report_settings")
        .select("*")
        .eq("account_id", data.accountId)
        .maybeSingle();
      if (cancelled) return;
      const s = row as TeamReportSettings | null;
      setEnabled(s?.enabled ?? false);
      setFrequency(s?.frequency ?? "weekly");
      setRecipients((s?.recipients ?? []).join(", "));
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data.accountId, data.supabase]);

  async function save() {
    const list = recipients
      .split(/[\s,;]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    const bad = list.filter((r) => !EMAIL_RE.test(r));
    if (bad.length > 0) {
      toast.error(t("invalidEmail", { email: bad[0] }));
      return;
    }
    if (enabled && list.length === 0) {
      toast.error(t("needRecipient"));
      return;
    }
    setSaving(true);
    const { error } = await data.supabase.from("team_report_settings").upsert(
      { account_id: data.accountId, enabled, frequency, recipients: list },
      { onConflict: "account_id" },
    );
    setSaving(false);
    if (error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>
        {!EMAIL_PROVIDER_CONFIGURED && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <p className="font-semibold">{t("notConfiguredTitle")}</p>
            <p className="mt-0.5">{t("notConfiguredDesc")}</p>
          </div>
        )}
        <div className={loaded ? "space-y-3" : "pointer-events-none space-y-3 opacity-50"}>
          <SettingRow
            title={t("enable")}
            description={t("enableDesc")}
            control={<Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canEdit} />}
          />
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">{t("frequency")}</Label>
            <NativeSelect
              value={frequency}
              disabled={!canEdit}
              onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
            >
              <option value="daily">{t("daily")}</option>
              <option value="weekly">{t("weekly")}</option>
              <option value="monthly">{t("monthly")}</option>
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">{t("recipients")}</Label>
            <Textarea
              value={recipients}
              disabled={!canEdit}
              onChange={(e) => setRecipients(e.target.value)}
              placeholder={t("recipientsPlaceholder")}
              className="min-h-[70px] border-border bg-muted"
            />
          </div>
        </div>
        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            {t("cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={saving || !canEdit || !loaded}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? t("saving") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

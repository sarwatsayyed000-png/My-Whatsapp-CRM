"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BellRing,
  ChevronDown,
  GitBranch,
  KanbanSquare,
  List,
  ListChecks,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trophy,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import type { Deal, DealFollowUp } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PipelineBoard } from "@/components/pipelines/pipeline-board";
import { PipelineSettings } from "@/components/pipelines/pipeline-settings";
import { PipelineAnalytics } from "@/components/pipelines/pipeline-analytics";
import { DealForm } from "@/components/pipelines/deal-form";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatCurrency } from "@/lib/currency";
import { DEFAULT_PIPELINE_STAGES, parseCrmView, type CrmView } from "@/lib/crm/constants";
import {
  AGENT_ALL,
  AGENT_UNASSIGNED,
  filterDeals,
  matchesAgent,
  matchesSearch,
} from "@/lib/crm/filters";
import { overdueDealIds } from "@/lib/crm/metrics";
import { cn } from "@/lib/utils";
import { CadencesDialog } from "./cadences-dialog";
import { NativeSelect } from "./crm-ui";
import { FollowUpDialog } from "./follow-up-dialog";
import { FollowUpsView } from "./follow-ups-view";
import { LeadQualificationDialog } from "./lead-qualification-dialog";
import { LeadsListView } from "./leads-list-view";
import { TeamPerformanceView } from "./team-performance-view";
import { useCrmData } from "./use-crm-data";

const VIEW_TABS: { id: CrmView; icon: typeof KanbanSquare; key: string }[] = [
  { id: "kanban", icon: KanbanSquare, key: "kanban" },
  { id: "list", icon: List, key: "list" },
  { id: "follow-ups", icon: ListChecks, key: "followUps" },
  { id: "performance", icon: Trophy, key: "performance" },
];

export function CrmDealsPage() {
  const t = useTranslations("Crm.page");
  const tp = useTranslations("Pipelines.page");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseCrmView(searchParams.get("view"));

  const { defaultCurrency, accountId } = useAuth();
  const canEditSettings = useCan("edit-settings");
  const canWrite = useCan("send-messages");
  const data = useCrmData();
  const { pipelines, selectedPipelineId, stages, deals, followUps, supabase } = data;

  const [agentFilter, setAgentFilter] = useState(AGENT_ALL);
  const [search, setSearch] = useState("");

  // Dialogs
  const [newPipelineOpen, setNewPipelineOpen] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualificationOpen, setQualificationOpen] = useState(false);
  const [cadencesOpen, setCadencesOpen] = useState(false);
  const [dealFormOpen, setDealFormOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [defaultStageId, setDefaultStageId] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [editingFollowUp, setEditingFollowUp] = useState<DealFollowUp | null>(null);

  const setView = useCallback(
    (next: CrmView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "kanban") params.delete("view");
      else params.set("view", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const filteredDeals = useMemo(
    () => filterDeals(deals, agentFilter, search),
    [deals, agentFilter, search],
  );
  const openDeals = filteredDeals.filter((d) => !d.status || d.status === "open");
  const pipelineTotal = openDeals.reduce((s, d) => s + (Number(d.value) || 0), 0);

  const pendingFollowUps = useMemo(
    () => followUps.filter((f) => f.status === "pending"),
    [followUps],
  );
  const overdue = useMemo(() => overdueDealIds(pendingFollowUps, new Date()), [pendingFollowUps]);

  const filteredFollowUps = useMemo(
    () =>
      pendingFollowUps.filter(
        (f) =>
          matchesAgent(f.assigned_to, agentFilter) &&
          matchesSearch(search, [
            f.note,
            f.template_name,
            f.deal?.title,
            f.deal?.contact?.name,
            f.deal?.contact?.phone,
          ]),
      ),
    [pendingFollowUps, agentFilter, search],
  );

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);

  const handleDealMoved = useCallback(
    async (dealId: string, newStageId: string) => {
      data.setDeals((prev) =>
        prev.map((d) =>
          d.id === dealId ? { ...d, stage_id: newStageId, updated_at: new Date().toISOString() } : d,
        ),
      );
      const { error } = await supabase.from("deals").update({ stage_id: newStageId }).eq("id", dealId);
      if (error) {
        toast.error(tp("toastFailedMoveDeal"));
        void data.refreshDeals();
      }
    },
    [supabase, data, tp],
  );

  const handleAddDeal = useCallback(
    (stageId?: string) => {
      setEditingDeal(null);
      setDefaultStageId(stageId ?? stages[0]?.id ?? "");
      setDealFormOpen(true);
    },
    [stages],
  );

  const handleEditDeal = useCallback((deal: Deal) => {
    setEditingDeal(deal);
    setDefaultStageId(deal.stage_id);
    setDealFormOpen(true);
  }, []);

  async function handleCreatePipeline() {
    const name = newPipelineName.trim();
    if (!name) return;
    setCreating(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user || !accountId) {
      toast.error(tp("toastNotLinkedToAccount"));
      setCreating(false);
      return;
    }
    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: session.user.id, account_id: accountId, name })
      .select()
      .single();
    if (error || !pipeline) {
      toast.error(tp("toastFailedCreatePipeline"));
      setCreating(false);
      return;
    }
    await supabase
      .from("pipeline_stages")
      .insert(DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, pipeline_id: pipeline.id })));
    setNewPipelineName("");
    setNewPipelineOpen(false);
    await data.refreshPipelines();
    data.setSelectedPipelineId(pipeline.id);
    setCreating(false);
    toast.success(tp("toastPipelineCreated"));
  }

  const agentOptions = data.members.filter((m) => m.account_role !== "viewer");

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{t("title")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {data.loading || data.dealsLoading ? (
              <span className="inline-block h-4 w-56 animate-pulse rounded bg-muted align-middle" />
            ) : (
              t("subtitle", {
                total: formatCurrency(pipelineTotal, defaultCurrency),
                count: openDeals.length,
              })
            )}
          </p>
        </div>
        <GatedButton
          canAct={canWrite}
          gateReason="create deals"
          disabled={!selectedPipelineId || stages.length === 0}
          onClick={() => handleAddDeal()}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-1 h-4 w-4" />
          {tp("addDeal")}
        </GatedButton>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-2 lg:flex-row lg:items-center">
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted data-[popup-open]:bg-muted lg:flex-none">
              <GitBranch className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate font-semibold">{selectedPipeline?.name ?? tp("selectPipeline")}</span>
              <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64 border-border bg-popover text-popover-foreground">
              {pipelines.length === 0 && (
                <DropdownMenuItem disabled className="text-muted-foreground">
                  {tp("noPipelinesYet")}
                </DropdownMenuItem>
              )}
              {pipelines.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  onClick={() => data.setSelectedPipelineId(p.id)}
                  className={p.id === selectedPipelineId ? "text-primary" : "text-popover-foreground"}
                >
                  <GitBranch className="mr-2 h-3.5 w-3.5" />
                  {p.name}
                </DropdownMenuItem>
              ))}
              {selectedPipeline && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem onClick={() => setSettingsOpen(true)} className="text-popover-foreground">
                    <Settings className="mr-2 h-3.5 w-3.5" />
                    {tp("managePipelines")}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <GatedButton
            variant="outline"
            canAct={canEditSettings}
            gateReason="create pipelines"
            aria-label={tp("addPipeline")}
            onClick={() => setNewPipelineOpen(true)}
            className="h-9 w-9 shrink-0 border-border bg-card p-0 text-foreground hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
          </GatedButton>
        </div>

        <div className="flex items-center gap-2">
          <Users className="hidden h-4 w-4 text-muted-foreground sm:block" />
          <NativeSelect
            aria-label={t("agentFilter")}
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="w-full lg:w-44"
          >
            <option value={AGENT_ALL}>{t("allAgents")}</option>
            <option value={AGENT_UNASSIGNED}>{t("unassigned")}</option>
            {agentOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={view === "follow-ups" ? t("searchFollowUps") : view === "performance" ? t("searchAgents") : t("searchLeads")}
            aria-label={t("searchLeads")}
            className="h-9 border-border bg-card pl-9"
          />
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex">
          <Button
            variant="outline"
            onClick={() => setQualificationOpen(true)}
            className="h-9 min-w-0 border-border bg-card text-foreground hover:bg-muted"
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
            <span className="truncate">{t("leadQualification")}</span>
          </Button>
          <Button
            variant="outline"
            disabled={!selectedPipelineId}
            onClick={() => setCadencesOpen(true)}
            className="h-9 min-w-0 border-border bg-card text-foreground hover:bg-muted"
          >
            <BellRing className="mr-1.5 h-4 w-4" />
            <span className="truncate">{t("automatedFollowUps")}</span>
          </Button>
        </div>
      </div>

      {/* View tabs (segmented control) */}
      <div
        role="tablist"
        aria-label={t("views")}
        className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border bg-muted/60 p-1 sm:w-fit"
      >
        {VIEW_TABS.map(({ id, icon: Icon, key }) => {
          const active = view === id;
          return (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setView(id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(`tab_${key}`)}
              {id === "follow-ups" && overdue.size > 0 && (
                <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                  {overdue.size}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Views */}
      {data.loading ? (
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-20">
          <GitBranch className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium text-foreground">{tp("noPipelinesYet")}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{tp("createToStartTracking")}</p>
          <GatedButton
            canAct={canEditSettings}
            gateReason="create pipelines"
            onClick={() => setNewPipelineOpen(true)}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" />
            {tp("createPipeline")}
          </GatedButton>
        </div>
      ) : view === "kanban" ? (
        data.dealsLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-96 w-72 shrink-0 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </div>
        ) : (
          <>
            <PipelineAnalytics stages={stages} deals={filteredDeals} />
            <PipelineBoard
              stages={stages}
              deals={filteredDeals}
              onDealMoved={handleDealMoved}
              onAddDeal={handleAddDeal}
              onEditDeal={handleEditDeal}
              overdueDealIds={overdue}
              canCreate={canWrite}
            />
          </>
        )
      ) : view === "list" ? (
        <LeadsListView
          data={data}
          deals={filteredDeals}
          canWrite={canWrite}
          onOpenDeal={handleEditDeal}
          pipelineName={selectedPipeline?.name ?? "leads"}
        />
      ) : view === "follow-ups" ? (
        <FollowUpsView
          data={data}
          followUps={filteredFollowUps}
          canWrite={canWrite}
          onAdd={() => {
            setEditingFollowUp(null);
            setFollowUpOpen(true);
          }}
          onReschedule={(f) => {
            setEditingFollowUp(f);
            setFollowUpOpen(true);
          }}
        />
      ) : (
        <TeamPerformanceView
          data={data}
          agentFilter={agentFilter}
          search={search}
          canEditSettings={canEditSettings}
        />
      )}

      {/* New pipeline */}
      <Dialog open={newPipelineOpen} onOpenChange={setNewPipelineOpen}>
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{tp("newPipeline")}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-muted-foreground">{tp("pipelineName")}</Label>
            <Input
              value={newPipelineName}
              onChange={(e) => setNewPipelineName(e.target.value)}
              placeholder={tp("pipelineNamePlaceholder")}
              className="mt-2 border-border bg-muted text-foreground"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreatePipeline();
              }}
            />
            <p className="mt-2 text-xs text-muted-foreground">{tp("defaultStagesDesc")}</p>
          </div>
          <DialogFooter className="border-border bg-popover/50">
            <Button variant="outline" onClick={() => setNewPipelineOpen(false)} className="border-border text-muted-foreground hover:bg-muted">
              {tp("cancel")}
            </Button>
            <Button
              onClick={() => void handleCreatePipeline()}
              disabled={creating || !newPipelineName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {creating ? tp("creating") : tp("createPipelineBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedPipeline && (
        <PipelineSettings
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          pipeline={selectedPipeline}
          stages={stages}
          onPipelinesChanged={data.refreshPipelines}
          onStagesChanged={data.refreshDeals}
          onCreateNewPipeline={() => {
            setSettingsOpen(false);
            setNewPipelineOpen(true);
          }}
        />
      )}

      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={selectedPipelineId}
        stages={stages}
        defaultStageId={defaultStageId}
        onSaved={() => void data.refreshAll()}
        followUps={editingDeal ? pendingFollowUps.filter((f) => f.deal_id === editingDeal.id) : []}
      />

      <FollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        data={data}
        deals={deals}
        editing={editingFollowUp}
        onNewDeal={canWrite && stages.length > 0 ? () => handleAddDeal() : undefined}
      />

      <LeadQualificationDialog
        open={qualificationOpen}
        onOpenChange={setQualificationOpen}
        data={data}
        canEdit={canEditSettings}
      />

      {selectedPipelineId && (
        <CadencesDialog
          open={cadencesOpen}
          onOpenChange={setCadencesOpen}
          data={data}
          pipelineId={selectedPipelineId}
          stages={stages}
          canEdit={canEditSettings}
        />
      )}
    </div>
  );
}

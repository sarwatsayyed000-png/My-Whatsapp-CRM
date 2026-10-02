"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Clock,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type {
  CadenceDelayUnit,
  CadenceStopWhen,
  FollowUpCadence,
  MessageTemplate,
  PipelineStage,
} from "@/types";
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
import { countTemplateVariables } from "@/lib/crm/cadence";
import { EmptyPanel, NativeSelect, StagePill } from "./crm-ui";
import type { CrmData } from "./use-crm-data";

interface DraftStep {
  delay_value: string;
  delay_unit: CadenceDelayUnit;
  template_name: string;
  template_language: string | null;
  template_params: string[];
}

interface Draft {
  id: string | null;
  name: string;
  trigger_stage_id: string;
  whatsapp_config_id: string;
  stop_when: CadenceStopWhen;
  is_active: boolean;
  steps: DraftStep[];
}

const emptyStep = (): DraftStep => ({
  delay_value: "1",
  delay_unit: "days",
  template_name: "",
  template_language: null,
  template_params: [],
});

type TemplateRow = Pick<MessageTemplate, "id" | "name" | "language" | "body_text" | "status">;

export function CadencesDialog({
  open,
  onOpenChange,
  data,
  pipelineId,
  stages,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: CrmData;
  pipelineId: string;
  stages: PipelineStage[];
  canEdit: boolean;
}) {
  const t = useTranslations("Crm.cadences");
  const { supabase, accountId } = data;

  const [cadences, setCadences] = useState<FollowUpCadence[] | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [config, setConfig] = useState<{ id: string; phone_number_id: string } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  const load = useCallback(async () => {
    if (!accountId || !pipelineId) return;
    const [c, tpl, cfg] = await Promise.all([
      supabase
        .from("follow_up_cadences")
        .select("*, steps:follow_up_cadence_steps(*)")
        .eq("account_id", accountId)
        .eq("pipeline_id", pipelineId)
        .order("created_at"),
      supabase
        .from("message_templates")
        .select("id, name, language, body_text, status")
        .eq("account_id", accountId)
        .order("name"),
      supabase.from("whatsapp_config").select("id, phone_number_id").eq("account_id", accountId).maybeSingle(),
    ]);
    setCadences(
      ((c.data ?? []) as FollowUpCadence[]).map((x) => ({
        ...x,
        steps: [...(x.steps ?? [])].sort((a, b) => a.position - b.position),
      })),
    );
    setTemplates(
      ((tpl.data ?? []) as TemplateRow[]).filter((x) => String(x.status ?? "").toUpperCase() === "APPROVED"),
    );
    setConfig((cfg.data as { id: string; phone_number_id: string } | null) ?? null);
  }, [supabase, accountId, pipelineId]);

  useEffect(() => {
    if (!open) return;
    // State updates happen in the async load callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(null);
    void load();
  }, [open, load]);

  function startNew() {
    setDraft({
      id: null,
      name: "",
      trigger_stage_id: stages[0]?.id ?? "",
      whatsapp_config_id: config?.id ?? "",
      stop_when: "reply_or_closed",
      is_active: true,
      steps: [emptyStep()],
    });
  }

  function startEdit(c: FollowUpCadence) {
    setDraft({
      id: c.id,
      name: c.name,
      trigger_stage_id: c.trigger_stage_id,
      whatsapp_config_id: c.whatsapp_config_id ?? config?.id ?? "",
      stop_when: c.stop_when,
      is_active: c.is_active,
      steps: (c.steps ?? []).map((s) => ({
        delay_value: String(s.delay_value),
        delay_unit: s.delay_unit,
        template_name: s.template_name,
        template_language: s.template_language,
        template_params: Array.isArray(s.template_params) ? s.template_params.map(String) : [],
      })),
    });
  }

  async function toggleActive(c: FollowUpCadence, value: boolean) {
    setCadences((prev) => prev?.map((x) => (x.id === c.id ? { ...x, is_active: value } : x)) ?? null);
    const { error } = await supabase.from("follow_up_cadences").update({ is_active: value }).eq("id", c.id);
    if (error) {
      toast.error(t("toggleFailed"));
      void load();
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("follow_up_cadences").delete().eq("id", id);
    setConfirmDeleteId(null);
    if (error) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("deleted"));
    void load();
    void data.refreshFollowUps();
  }

  async function save() {
    if (!draft || !accountId) return;
    const name = draft.name.trim();
    if (!name || !draft.trigger_stage_id) {
      toast.error(t("requiredFields"));
      return;
    }
    if (draft.steps.length === 0 || draft.steps.some((s) => !s.template_name)) {
      toast.error(t("requiredSteps"));
      return;
    }
    setSaving(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const payload = {
      account_id: accountId,
      pipeline_id: pipelineId,
      name,
      trigger_stage_id: draft.trigger_stage_id,
      whatsapp_config_id: draft.whatsapp_config_id || null,
      stop_when: draft.stop_when,
      is_active: draft.is_active,
    };
    let cadenceId = draft.id;
    if (cadenceId) {
      const { error } = await supabase.from("follow_up_cadences").update(payload).eq("id", cadenceId);
      if (error) return fail();
      const { error: delErr } = await supabase.from("follow_up_cadence_steps").delete().eq("cadence_id", cadenceId);
      if (delErr) return fail();
    } else {
      const { data: created, error } = await supabase
        .from("follow_up_cadences")
        .insert({ ...payload, created_by: session?.user.id ?? null })
        .select("id")
        .single();
      if (error || !created) return fail();
      cadenceId = created.id as string;
    }
    const { error: stepErr } = await supabase.from("follow_up_cadence_steps").insert(
      draft.steps.map((s, i) => ({
        cadence_id: cadenceId,
        position: i,
        delay_value: Math.max(0, Math.round(Number(s.delay_value) || 0)),
        delay_unit: s.delay_unit,
        template_name: s.template_name,
        template_language: s.template_language,
        template_params: s.template_params,
      })),
    );
    if (stepErr) return fail();
    setSaving(false);
    toast.success(t("saved"));
    setDraft(null);
    void load();

    function fail() {
      setSaving(false);
      toast.error(t("saveFailed"));
    }
  }

  const updateStep = (i: number, patch: Partial<DraftStep>) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : d));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            {draft && (
              <button
                type="button"
                aria-label={t("back")}
                onClick={() => setDraft(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {draft ? (draft.id ? t("editTitle") : t("newTitle")) : t("title")}
          </DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[62vh] overflow-y-auto pr-1">
          {!draft ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("configured")}
                </p>
                <Button
                  size="sm"
                  disabled={!canEdit || stages.length === 0}
                  onClick={startNew}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="mr-1 h-4 w-4" />
                  {t("newCadence")}
                </Button>
              </div>
              {cadences === null ? (
                <div className="space-y-2">
                  {[0, 1].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              ) : cadences.length === 0 ? (
                <EmptyPanel icon={Repeat} title={t("emptyTitle")} hint={t("emptyHint")} />
              ) : (
                <ul className="space-y-2">
                  {cadences.map((c) => {
                    const stage = stageById.get(c.trigger_stage_id);
                    return (
                      <li key={c.id} className="rounded-lg border border-border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              {stage && <StagePill name={stage.name} color={stage.color} />}
                              <span>{t("stepsCount", { count: c.steps?.length ?? 0 })}</span>
                              <span>· {t(`stop_${c.stop_when}`)}</span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Switch
                              aria-label={t("active")}
                              checked={c.is_active}
                              disabled={!canEdit}
                              onCheckedChange={(v) => void toggleActive(c, v)}
                            />
                            <Button size="sm" variant="ghost" disabled={!canEdit} onClick={() => startEdit(c)} aria-label={t("edit")}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {confirmDeleteId === c.id ? (
                              <>
                                <Button size="sm" onClick={() => void remove(c.id)} className="bg-red-600 text-white hover:bg-red-700">
                                  {t("confirmDelete")}
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => setConfirmDeleteId(null)} aria-label={t("cancel")}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={!canEdit}
                                onClick={() => setConfirmDeleteId(c.id)}
                                aria-label={t("delete")}
                                className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!canEdit && <p className="text-xs text-muted-foreground">{t("adminOnly")}</p>}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">{t("name")}</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={t("namePlaceholder")}
                  className="border-border bg-muted"
                />
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("triggerStage")}</Label>
                  <NativeSelect
                    value={draft.trigger_stage_id}
                    onChange={(e) => setDraft({ ...draft, trigger_stage_id: e.target.value })}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                  <p className="text-[11px] text-muted-foreground">{t("triggerStageHint")}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("channel")}</Label>
                  <NativeSelect
                    value={draft.whatsapp_config_id}
                    onChange={(e) => setDraft({ ...draft, whatsapp_config_id: e.target.value })}
                  >
                    {config ? (
                      <option value={config.id}>{t("channelOption", { id: config.phone_number_id })}</option>
                    ) : (
                      <option value="">{t("noNumber")}</option>
                    )}
                  </NativeSelect>
                  {!config && <p className="text-[11px] text-amber-600 dark:text-amber-400">{t("noNumberHint")}</p>}
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">{t("stopWhen")}</Label>
                <NativeSelect
                  value={draft.stop_when}
                  onChange={(e) => setDraft({ ...draft, stop_when: e.target.value as CadenceStopWhen })}
                >
                  <option value="reply_or_closed">{t("stop_reply_or_closed")}</option>
                  <option value="closed">{t("stop_closed")}</option>
                  <option value="never">{t("stop_never")}</option>
                </NativeSelect>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("steps")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDraft({ ...draft, steps: [...draft.steps, emptyStep()] })}
                    className="border-border"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t("addStep")}
                  </Button>
                </div>
                {templates.length === 0 && (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    {t("noTemplates")}
                  </p>
                )}
                {draft.steps.map((s, i) => (
                  <StepEditor
                    key={i}
                    index={i}
                    step={s}
                    templates={templates}
                    onChange={(patch) => updateStep(i, patch)}
                    onRemove={
                      draft.steps.length > 1
                        ? () => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })
                        : undefined
                    }
                  />
                ))}
                <p className="text-[11px] text-muted-foreground">{t("variablesHint")}</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-border bg-popover/50">
          {draft ? (
            <>
              <Button variant="outline" onClick={() => setDraft(null)} className="border-border">
                {t("cancel")}
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving || !canEdit}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : t("save")}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
              {t("close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepEditor({
  index,
  step,
  templates,
  onChange,
  onRemove,
}: {
  index: number;
  step: DraftStep;
  templates: TemplateRow[];
  onChange: (patch: Partial<DraftStep>) => void;
  onRemove?: () => void;
}) {
  const t = useTranslations("Crm.cadences");
  const tpl = templates.find(
    (x) => x.name === step.template_name && (step.template_language ? x.language === step.template_language : true),
  );
  const varCount = countTemplateVariables(tpl?.body_text);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          {t("stepLabel", { n: index + 1 })}
        </p>
        {onRemove && (
          <Button size="sm" variant="ghost" onClick={onRemove} aria-label={t("removeStep")} className="h-7 w-7 p-0 text-muted-foreground">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-[90px_120px_1fr]">
        <Input
          type="number"
          min={0}
          aria-label={t("delay")}
          value={step.delay_value}
          onChange={(e) => onChange({ delay_value: e.target.value })}
          className="border-border bg-card"
        />
        <NativeSelect
          aria-label={t("delayUnit")}
          value={step.delay_unit}
          onChange={(e) => onChange({ delay_unit: e.target.value as CadenceDelayUnit })}
        >
          <option value="minutes">{t("minutes")}</option>
          <option value="hours">{t("hours")}</option>
          <option value="days">{t("days")}</option>
        </NativeSelect>
        <NativeSelect
          aria-label={t("template")}
          value={tpl ? `${tpl.name}::${tpl.language ?? ""}` : ""}
          onChange={(e) => {
            const [name, language] = e.target.value.split("::");
            const picked = templates.find((x) => x.name === name && (x.language ?? "") === language);
            const n = countTemplateVariables(picked?.body_text);
            onChange({
              template_name: name ?? "",
              template_language: language || null,
              template_params: Array.from({ length: n }, (_, k) => step.template_params[k] ?? ""),
            });
          }}
        >
          <option value="">{step.template_name && !tpl ? step.template_name : t("selectTemplate")}</option>
          {templates.map((x) => (
            <option key={x.id} value={`${x.name}::${x.language ?? ""}`}>
              {x.name} {x.language ? `(${x.language})` : ""}
            </option>
          ))}
        </NativeSelect>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {index === 0 ? t("delayHintFirst") : t("delayHintNext")}
      </p>
      {tpl?.body_text && (
        <p className="whitespace-pre-wrap rounded-md bg-card px-2 py-1.5 text-xs text-muted-foreground">{tpl.body_text}</p>
      )}
      {varCount > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: varCount }, (_, k) => (
            <Input
              key={k}
              aria-label={t("variable", { n: k + 1 })}
              placeholder={k === 0 ? "{{contact.name}}" : t("variable", { n: k + 1 })}
              value={step.template_params[k] ?? ""}
              onChange={(e) => {
                const params = Array.from({ length: varCount }, (_, j) => step.template_params[j] ?? "");
                params[k] = e.target.value;
                onChange({ template_params: params });
              }}
              className="border-border bg-card"
            />
          ))}
        </div>
      )}
    </div>
  );
}


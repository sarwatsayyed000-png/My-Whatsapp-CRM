"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bot, Shuffle, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_CRM_SETTINGS } from "@/lib/crm/constants";
import { NativeSelect, SettingRow } from "./crm-ui";
import type { CrmData } from "./use-crm-data";

interface FlowOption {
  id: string;
  name: string;
  status: string;
}

/**
 * Lead Qualification Settings — plus the lead-distribution switches
 * (auto-create deals, round-robin) that qualification feeds into.
 */
export function LeadQualificationDialog({
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
  const t = useTranslations("Crm.qualification");
  const { supabase, accountId } = data;

  const [loaded, setLoaded] = useState(false);
  const [autoCreate, setAutoCreate] = useState<boolean>(DEFAULT_CRM_SETTINGS.auto_create_deals);
  const [roundRobin, setRoundRobin] = useState<boolean>(DEFAULT_CRM_SETTINGS.round_robin_enabled);
  const [qualify, setQualify] = useState(false);
  const [flowId, setFlowId] = useState("");
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !accountId) return;
    let cancelled = false;
    (async () => {
      const [crm, qual, fl] = await Promise.all([
        supabase.from("crm_settings").select("auto_create_deals, round_robin_enabled").eq("account_id", accountId).maybeSingle(),
        supabase.from("lead_qualification_settings").select("enabled, flow_id").eq("account_id", accountId).maybeSingle(),
        supabase.from("flows").select("id, name, status").eq("account_id", accountId).neq("status", "archived").order("name"),
      ]);
      if (cancelled) return;
      setAutoCreate(crm.data?.auto_create_deals ?? DEFAULT_CRM_SETTINGS.auto_create_deals);
      setRoundRobin(crm.data?.round_robin_enabled ?? DEFAULT_CRM_SETTINGS.round_robin_enabled);
      setQualify(qual.data?.enabled ?? false);
      setFlowId(qual.data?.flow_id ?? "");
      setFlows((fl.data ?? []) as FlowOption[]);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, accountId, supabase]);

  async function save() {
    if (!accountId) return;
    if (qualify && !flowId) {
      toast.error(t("pickFlow"));
      return;
    }
    setSaving(true);
    const [a, b] = await Promise.all([
      supabase
        .from("crm_settings")
        .upsert(
          { account_id: accountId, auto_create_deals: autoCreate, round_robin_enabled: roundRobin },
          { onConflict: "account_id" },
        ),
      supabase
        .from("lead_qualification_settings")
        .upsert({ account_id: accountId, enabled: qualify, flow_id: flowId || null }, { onConflict: "account_id" }),
    ]);
    setSaving(false);
    if (a.error || b.error) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"));
    onOpenChange(false);
  }

  const selectedFlow = flows.find((f) => f.id === flowId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>

        <div className={loaded ? "space-y-4" : "pointer-events-none space-y-4 opacity-50"}>
          <div className="space-y-2">
            <SettingRow
              title={t("enableTitle")}
              description={t("enableDesc")}
              control={<Switch checked={qualify} onCheckedChange={setQualify} disabled={!canEdit} />}
            />
            {qualify && (
              <div className="grid gap-1.5 pl-1">
                <Label className="text-muted-foreground">{t("flow")}</Label>
                <NativeSelect value={flowId} disabled={!canEdit} onChange={(e) => setFlowId(e.target.value)}>
                  <option value="">{t("selectFlow")}</option>
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.status !== "active" ? ` (${f.status})` : ""}
                    </option>
                  ))}
                </NativeSelect>
                {flows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("noFlows")}{" "}
                    <Link href="/flows" className="font-medium text-primary hover:underline">
                      {t("createFlow")}
                    </Link>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {selectedFlow && selectedFlow.status !== "active" ? t("draftNote") : t("flowHint")}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("distribution")}</p>
            <SettingRow
              title={t("autoCreateTitle")}
              description={t("autoCreateDesc")}
              control={<Switch checked={autoCreate} onCheckedChange={setAutoCreate} disabled={!canEdit} />}
            />
            <SettingRow
              title={t("roundRobinTitle")}
              description={t("roundRobinDesc")}
              control={<Switch checked={roundRobin} onCheckedChange={setRoundRobin} disabled={!canEdit} />}
            />
          </div>

          <ol className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t("step1")}
            </li>
            <li className={`flex items-center gap-2 ${qualify ? "" : "opacity-50 line-through"}`}>
              <Bot className="h-3.5 w-3.5 text-primary" />
              {t("step2")}
            </li>
            <li className={`flex items-center gap-2 ${roundRobin ? "" : "opacity-50 line-through"}`}>
              <Shuffle className="h-3.5 w-3.5 text-primary" />
              {t("step3")}
            </li>
          </ol>
          {!canEdit && <p className="text-xs text-muted-foreground">{t("adminOnly")}</p>}
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void save()}
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

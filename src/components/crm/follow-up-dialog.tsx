"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { Deal, DealFollowUp, FollowUpChannel } from "@/types";
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
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "./crm-ui";
import type { CrmData } from "./use-crm-data";

/** `<input type="datetime-local">` value for a Date, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Tomorrow at 10:00 local — the default reminder slot. */
export function defaultReminder(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return toLocalInput(d);
}

/**
 * Create a follow-up, or reschedule an existing one (only the due time
 * changes then). `deals` feeds the deal picker on create.
 */
export function FollowUpDialog({
  open,
  onOpenChange,
  data,
  deals,
  editing,
  presetDealId,
  onNewDeal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CrmData;
  deals: Deal[];
  editing?: DealFollowUp | null;
  presetDealId?: string | null;
  onNewDeal?: () => void;
}) {
  const t = useTranslations("Crm.followUpDialog");
  const { supabase, members } = data;

  const [dealId, setDealId] = useState("");
  const [dueAt, setDueAt] = useState(defaultReminder());
  const [channel, setChannel] = useState<FollowUpChannel>("whatsapp");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset every time the dialog opens — a legitimate prop-driven sync.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setDealId(editing.deal_id);
      setDueAt(toLocalInput(new Date(editing.due_at)));
      setChannel(editing.channel);
      setNote(editing.note ?? "");
      setAssignedTo(editing.assigned_to ?? "");
    } else {
      const preset = presetDealId ?? "";
      setDealId(preset);
      setDueAt(defaultReminder());
      setChannel("whatsapp");
      setNote("");
      setAssignedTo(deals.find((d) => d.id === preset)?.assigned_to ?? "");
    }
  }, [open, editing, presetDealId, deals]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function save() {
    if (!dueAt || (!editing && !dealId)) {
      toast.error(t("required"));
      return;
    }
    const due = new Date(dueAt);
    if (Number.isNaN(due.getTime())) {
      toast.error(t("invalidDate"));
      return;
    }
    setSaving(true);
    let error: { message: string } | null = null;
    if (editing) {
      ({ error } = await supabase
        .from("deal_follow_ups")
        .update({ due_at: due.toISOString(), notified_at: null })
        .eq("id", editing.id));
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      ({ error } = await supabase.from("deal_follow_ups").insert({
        // account_id is overwritten from the deal by a DB trigger; it is
        // sent only because the column is NOT NULL.
        account_id: data.accountId,
        deal_id: dealId,
        due_at: due.toISOString(),
        channel,
        note: note.trim() || null,
        assigned_to: assignedTo || null,
        is_automated: false,
        created_by: session?.user.id ?? null,
      }));
    }
    setSaving(false);
    if (error) {
      toast.error(editing ? t("rescheduleFailed") : t("createFailed"));
      return;
    }
    toast.success(editing ? t("rescheduled") : t("created"));
    onOpenChange(false);
    await data.refreshFollowUps();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {editing ? t("rescheduleTitle") : t("createTitle")}
          </DialogTitle>
          <DialogDescription>{editing ? t("rescheduleDesc") : t("createDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {!editing && (
            <div className="grid gap-1.5">
              <Label className="text-muted-foreground">{t("deal")}</Label>
              <NativeSelect
                value={dealId}
                onChange={(e) => {
                  setDealId(e.target.value);
                  const d = deals.find((x) => x.id === e.target.value);
                  setAssignedTo(d?.assigned_to ?? "");
                }}
              >
                <option value="">{t("selectDeal")}</option>
                {deals
                  .filter((d) => d.status === "open" || !d.status)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                      {d.contact?.name ? ` — ${d.contact.name}` : ""}
                    </option>
                  ))}
              </NativeSelect>
              {onNewDeal && (
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onNewDeal();
                  }}
                  className="self-start text-xs font-medium text-primary hover:underline"
                >
                  {t("newDealInstead")}
                </button>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-muted-foreground">{t("dueAt")}</Label>
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="border-border bg-muted text-foreground"
            />
          </div>

          {!editing && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("channel")}</Label>
                  <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value as FollowUpChannel)}>
                    <option value="whatsapp">{t("channelWhatsapp")}</option>
                    <option value="call">{t("channelCall")}</option>
                    <option value="task">{t("channelTask")}</option>
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-muted-foreground">{t("assignTo")}</Label>
                  <NativeSelect value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                    <option value="">{t("unassigned")}</option>
                    {members
                      .filter((m) => m.account_role !== "viewer")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-muted-foreground">{t("note")}</Label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("notePlaceholder")}
                  className="min-h-[80px] border-border bg-muted text-foreground"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="border-border bg-popover/50">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-border">
            {t("cancel")}
          </Button>
          <Button onClick={save} disabled={saving} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving ? t("saving") : editing ? t("reschedule") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

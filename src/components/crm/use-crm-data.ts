"use client";

// ============================================================
// useCrmData — everything the CRM & Deals page needs for the
// selected pipeline: pipelines, stages, deals (with contact, tags and
// assignee), account members, and the account's follow-ups. Follow-
// ups refresh live over Realtime (migration 044 publishes them) so the
// overdue badge and the Follow-ups view stay current.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_PIPELINE_NAME, DEFAULT_PIPELINE_STAGES } from "@/lib/crm/constants";
import type { Contact, Deal, DealFollowUp, Pipeline, PipelineStage, Tag } from "@/types";

export interface CrmMember {
  /** profiles.id — deals.assigned_to / deal_follow_ups.assigned_to. */
  id: string;
  /** auth.users.id — conversations.assigned_agent_id. */
  user_id: string;
  full_name: string;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

export const DEAL_SELECT =
  "*, contact:contacts(id, name, phone, contact_tags(tags(id, name, color))), assignee:profiles!deals_assigned_to_fkey(id, user_id, full_name, email, avatar_url)";

type RawDeal = Omit<Deal, "contact"> & {
  contact?: (Contact & { contact_tags?: { tags: Tag | null }[] }) | null;
};

export function normalizeDeal(raw: RawDeal): Deal {
  if (!raw.contact) return raw as Deal;
  const { contact_tags, ...contact } = raw.contact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? []).map((ct) => ct.tags).filter((t): t is Tag => !!t),
    },
  } as Deal;
}

export const FOLLOW_UP_SELECT =
  "*, deal:deals(id, title, status, stage_id, pipeline_id, contact_id, conversation_id, assigned_to, contact:contacts(id, name, phone))";

export function useCrmData() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState("");
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [members, setMembers] = useState<CrmMember[]>([]);
  const [followUps, setFollowUps] = useState<DealFollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [dealsLoading, setDealsLoading] = useState(true);
  const seedAttempted = useRef(false);

  const loadPipelines = useCallback(async () => {
    const { data, error } = await supabase.from("pipelines").select("*").order("created_at");
    if (error) {
      console.error("[crm] load pipelines failed:", error.message);
      return [] as Pipeline[];
    }
    return (data ?? []) as Pipeline[];
  }, [supabase]);

  const seedDefaultPipeline = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user || !accountId) return null;
    const { data: pipeline, error } = await supabase
      .from("pipelines")
      .insert({ user_id: session.user.id, account_id: accountId, name: DEFAULT_PIPELINE_NAME })
      .select()
      .single();
    if (error || !pipeline) return null;
    await supabase
      .from("pipeline_stages")
      .insert(DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, pipeline_id: pipeline.id })));
    return pipeline as Pipeline;
  }, [supabase, accountId]);

  const loadMembers = useCallback(async () => {
    if (!accountId) return;
    const { data } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email, avatar_url, account_role, created_at")
      .eq("account_id", accountId)
      .order("full_name");
    setMembers(((data ?? []) as CrmMember[]).map((m) => ({ ...m, full_name: m.full_name || m.email || "—" })));
  }, [supabase, accountId]);

  const loadFollowUps = useCallback(async () => {
    if (!accountId) return;
    // Pending rows drive every view; recent closed ones are kept for
    // the deal drawer's history. 60 days is plenty for both.
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("deal_follow_ups")
      .select(FOLLOW_UP_SELECT)
      .eq("account_id", accountId)
      .or(`status.eq.pending,created_at.gte.${since}`)
      .order("due_at", { ascending: true })
      .limit(1000);
    if (error) {
      // Table missing → migration 044 not applied yet. Degrade quietly.
      console.error("[crm] load follow-ups failed:", error.message);
      setFollowUps([]);
      return;
    }
    setFollowUps((data ?? []) as DealFollowUp[]);
  }, [supabase, accountId]);

  const loadDeals = useCallback(
    async (pipelineId: string) => {
      const [{ data: s }, { data: d }] = await Promise.all([
        supabase.from("pipeline_stages").select("*").eq("pipeline_id", pipelineId).order("position"),
        supabase
          .from("deals")
          .select(DEAL_SELECT)
          .eq("pipeline_id", pipelineId)
          .order("updated_at", { ascending: false }),
      ]);
      return {
        stages: (s ?? []) as PipelineStage[],
        deals: ((d ?? []) as RawDeal[]).map(normalizeDeal),
      };
    },
    [supabase],
  );

  // Initial load.
  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      let list = await loadPipelines();
      if (list.length === 0 && !seedAttempted.current) {
        seedAttempted.current = true;
        if (await seedDefaultPipeline()) list = await loadPipelines();
      }
      await Promise.all([loadMembers(), loadFollowUps()]);
      if (cancelled) return;
      setPipelines(list);
      setSelectedPipelineId((prev) =>
        prev && list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? ""),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadPipelines, seedDefaultPipeline, loadMembers, loadFollowUps]);

  // Stages + deals for the selected pipeline. State is cleared/set in
  // the async callback, not synchronously in the effect body.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedPipelineId) {
        if (!cancelled) {
          setStages([]);
          setDeals([]);
          setDealsLoading(false);
        }
        return;
      }
      setDealsLoading(true);
      const res = await loadDeals(selectedPipelineId);
      if (cancelled) return;
      setStages(res.stages);
      setDeals(res.deals);
      setDealsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPipelineId, loadDeals]);

  // Live follow-ups (cron sends, teammates completing, triggers).
  useEffect(() => {
    if (!accountId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`crm-follow-ups-${accountId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deal_follow_ups", filter: `account_id=eq.${accountId}` },
        () => {
          // Debounce bursts (a bulk move schedules many rows at once).
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void loadFollowUps(), 400);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, accountId, loadFollowUps]);

  const refreshPipelines = useCallback(async () => {
    const list = await loadPipelines();
    setPipelines(list);
    setSelectedPipelineId((prev) =>
      list.some((p) => p.id === prev) ? prev : (list[0]?.id ?? ""),
    );
  }, [loadPipelines]);

  const refreshDeals = useCallback(async () => {
    if (!selectedPipelineId) return;
    const res = await loadDeals(selectedPipelineId);
    setStages(res.stages);
    setDeals(res.deals);
  }, [selectedPipelineId, loadDeals]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshDeals(), loadFollowUps()]);
  }, [refreshDeals, loadFollowUps]);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  return {
    supabase,
    accountId,
    loading,
    dealsLoading,
    pipelines,
    selectedPipelineId,
    setSelectedPipelineId,
    stages,
    deals,
    setDeals,
    members,
    memberById,
    followUps,
    refreshPipelines,
    refreshDeals,
    refreshFollowUps: loadFollowUps,
    refreshAll,
  };
}

export type CrmData = ReturnType<typeof useCrmData>;

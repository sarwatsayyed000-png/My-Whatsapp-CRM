// ============================================================
// CRM & Deals — server-side orchestration (service-role client).
//
// Called from:
//   - the WhatsApp webhook (src/app/api/whatsapp/webhook/route.ts):
//       prepareNewConversation   → auto-create the deal, decide whether
//                                  a lead-qualification flow runs first
//       cancelFollowUpsOnInbound → stop "until reply" cadences
//       assignIfQualified        → round-robin once no flow is running
//   - the automations cron (src/app/api/automations/cron/route.ts):
//       runCrmCron               → send due cadence steps, notify agents
//                                  of due follow-ups, assign stragglers
//
// Every export owns its try/catch and never throws: CRM bookkeeping
// must never drop an inbound message or stall the cron.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { engineSendTemplate } from "@/lib/automations/meta-send";
import type { CadenceStopWhen, DealStatus } from "@/types";
import {
  addDelay,
  cadenceStopReason,
  nextCadenceStep,
  resolveTemplateParams,
  stopsOnReply,
} from "./cadence";
import {
  DEFAULT_CRM_SETTINGS,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  PENDING_ASSIGN_GRACE_MS,
} from "./constants";
import {
  eligibleAgents,
  pickRoundRobin,
  type RoundRobinMember,
  type RoundRobinPresence,
} from "./round-robin";

type DB = SupabaseClient;

const log = (msg: string, err?: unknown) =>
  console.error(`[crm] ${msg}`, err instanceof Error ? err.message : (err ?? ""));

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------

export interface ResolvedCrmSettings {
  auto_create_deals: boolean;
  round_robin_enabled: boolean;
  qualification_flow_id: string | null;
}

export async function loadCrmSettings(db: DB, accountId: string): Promise<ResolvedCrmSettings> {
  const [crm, qual] = await Promise.all([
    db
      .from("crm_settings")
      .select("auto_create_deals, round_robin_enabled")
      .eq("account_id", accountId)
      .maybeSingle(),
    db
      .from("lead_qualification_settings")
      .select("enabled, flow_id")
      .eq("account_id", accountId)
      .maybeSingle(),
  ]);
  return {
    auto_create_deals: crm.data?.auto_create_deals ?? DEFAULT_CRM_SETTINGS.auto_create_deals,
    round_robin_enabled:
      crm.data?.round_robin_enabled ?? DEFAULT_CRM_SETTINGS.round_robin_enabled,
    qualification_flow_id: qual.data?.enabled && qual.data.flow_id ? qual.data.flow_id : null,
  };
}

// ------------------------------------------------------------
// New conversation → deal (+ pending round-robin)
// ------------------------------------------------------------

export interface NewConversationInput {
  accountId: string;
  contactId: string;
  conversationId: string;
  contactName: string | null;
  contactPhone: string | null;
  /** NOT NULL audit user for created rows (the WhatsApp config owner). */
  configOwnerUserId: string;
}

export interface NewConversationResult {
  /** Flow to run before round-robin, when lead qualification is on. */
  forceEntryFlowId: string | null;
  dealId: string | null;
}

/**
 * Runs once, when the webhook has just created a conversation:
 * auto-creates "{contact} Deal" in the default pipeline's first stage
 * (unless the contact already has an open deal) and marks the
 * conversation as waiting for round-robin. Assignment itself happens
 * in `assignIfQualified`, right after flow dispatch — immediately when
 * no qualification flow is configured, or once that flow ends.
 */
export async function prepareNewConversation(
  db: DB,
  input: NewConversationInput,
): Promise<NewConversationResult> {
  const result: NewConversationResult = { forceEntryFlowId: null, dealId: null };
  try {
    const settings = await loadCrmSettings(db, input.accountId);

    if (settings.auto_create_deals) {
      result.dealId = await autoCreateDeal(db, input);
    }

    if (settings.round_robin_enabled) {
      await db
        .from("conversations")
        .update({ crm_assign_pending: true })
        .eq("id", input.conversationId)
        .eq("account_id", input.accountId)
        .is("assigned_agent_id", null);
    }

    result.forceEntryFlowId = settings.qualification_flow_id;
  } catch (err) {
    log("prepareNewConversation failed", err);
  }
  return result;
}

async function autoCreateDeal(db: DB, input: NewConversationInput): Promise<string | null> {
  const { data: existing } = await db
    .from("deals")
    .select("id")
    .eq("account_id", input.accountId)
    .eq("contact_id", input.contactId)
    .eq("status", "open")
    .limit(1);
  if (existing && existing.length > 0) return null;

  const target = await resolveDefaultStage(db, input.accountId, input.configOwnerUserId);
  if (!target) return null;

  const { data: account } = await db
    .from("accounts")
    .select("default_currency")
    .eq("id", input.accountId)
    .maybeSingle();

  const label = input.contactName?.trim() || input.contactPhone?.trim() || "New";
  const { data: deal, error } = await db
    .from("deals")
    .insert({
      account_id: input.accountId,
      user_id: input.configOwnerUserId,
      pipeline_id: target.pipelineId,
      stage_id: target.stageId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      title: `${label} Deal`,
      value: 0,
      currency: account?.default_currency ?? "USD",
      status: "open",
      source: "whatsapp_auto",
    })
    .select("id")
    .single();
  if (error) {
    log("auto-create deal failed", error);
    return null;
  }
  return deal.id as string;
}

/** Oldest pipeline = the default one (the board selects it first). Seeds
 *  the standard pipeline when the account has none yet. */
async function resolveDefaultStage(
  db: DB,
  accountId: string,
  ownerUserId: string,
): Promise<{ pipelineId: string; stageId: string } | null> {
  const { data: pipelines } = await db
    .from("pipelines")
    .select("id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1);

  let pipelineId = pipelines?.[0]?.id as string | undefined;
  if (!pipelineId) {
    const { data: created, error } = await db
      .from("pipelines")
      .insert({ account_id: accountId, user_id: ownerUserId, name: DEFAULT_PIPELINE_NAME })
      .select("id")
      .single();
    if (error || !created) {
      log("seed pipeline failed", error);
      return null;
    }
    pipelineId = created.id as string;
    await db
      .from("pipeline_stages")
      .insert(DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s, pipeline_id: pipelineId })));
  }

  const { data: stages } = await db
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true })
    .limit(1);
  const stageId = stages?.[0]?.id as string | undefined;
  return stageId ? { pipelineId, stageId } : null;
}

// ------------------------------------------------------------
// Round-robin assignment
// ------------------------------------------------------------

/**
 * Assign a pending conversation once no flow run is active for the
 * contact (i.e. qualification finished, or never started). Called by
 * the webhook after every flow dispatch — a cheap partial-index probe
 * when nothing is pending.
 */
export async function assignIfQualified(
  db: DB,
  args: { accountId: string; contactId: string; conversationId: string },
): Promise<void> {
  try {
    const { data: pending } = await db
      .from("conversations")
      .select("id")
      .eq("id", args.conversationId)
      .eq("account_id", args.accountId)
      .eq("crm_assign_pending", true)
      .maybeSingle();
    if (!pending) return;

    if (await hasActiveFlowRun(db, args.accountId, args.contactId)) return;
    await claimAndAssign(db, args);
  } catch (err) {
    log("assignIfQualified failed", err);
  }
}

async function hasActiveFlowRun(db: DB, accountId: string, contactId: string) {
  const { data } = await db
    .from("flow_runs")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .eq("status", "active")
    .limit(1);
  return !!data && data.length > 0;
}

/**
 * Claim the pending marker (only one concurrent caller wins, so the
 * counter advances exactly once per lead), then give the conversation
 * and the contact's unassigned open deal to the next agent in turn.
 */
async function claimAndAssign(
  db: DB,
  args: { accountId: string; contactId: string; conversationId: string },
): Promise<string | null> {
  const { data: claimed } = await db
    .from("conversations")
    .update({ crm_assign_pending: false })
    .eq("id", args.conversationId)
    .eq("account_id", args.accountId)
    .eq("crm_assign_pending", true)
    .select("id, assigned_agent_id")
    .maybeSingle();
  if (!claimed) return null;

  const settings = await loadCrmSettings(db, args.accountId);
  if (!settings.round_robin_enabled) return null;

  const [membersRes, presenceRes] = await Promise.all([
    db
      .from("profiles")
      .select("id, user_id, full_name, account_role, created_at")
      .eq("account_id", args.accountId),
    db
      .from("member_presence")
      .select("user_id, status, last_seen_at")
      .eq("account_id", args.accountId),
  ]);
  const candidates = eligibleAgents(
    (membersRes.data ?? []) as RoundRobinMember[],
    (presenceRes.data ?? []) as RoundRobinPresence[],
    Date.now(),
  );
  if (candidates.length === 0) return null;

  const { data: counter, error: rpcErr } = await db.rpc("crm_bump_round_robin", {
    p_account_id: args.accountId,
  });
  if (rpcErr) {
    log("crm_bump_round_robin failed", rpcErr);
    return null;
  }
  const agent = pickRoundRobin(candidates, Number(counter) || 1);
  if (!agent) return null;

  if (!claimed.assigned_agent_id) {
    await db
      .from("conversations")
      .update({ assigned_agent_id: agent.user_id })
      .eq("id", args.conversationId)
      .is("assigned_agent_id", null);
  }
  await db
    .from("deals")
    .update({ assigned_to: agent.id })
    .eq("account_id", args.accountId)
    .eq("contact_id", args.contactId)
    .eq("status", "open")
    .is("assigned_to", null);
  await db
    .from("crm_settings")
    .update({ last_assigned_profile_id: agent.id })
    .eq("account_id", args.accountId);
  return agent.id;
}

// ------------------------------------------------------------
// Inbound reply → stop "until reply" cadences
// ------------------------------------------------------------

export async function cancelFollowUpsOnInbound(
  db: DB,
  args: { accountId: string; contactId: string },
): Promise<void> {
  try {
    const { data: deals } = await db
      .from("deals")
      .select("id")
      .eq("account_id", args.accountId)
      .eq("contact_id", args.contactId)
      .eq("status", "open");
    const dealIds = (deals ?? []).map((d) => d.id as string);
    if (dealIds.length === 0) return;

    const { data: rows } = await db
      .from("deal_follow_ups")
      .select("id, cadence:follow_up_cadences(stop_when)")
      .in("deal_id", dealIds)
      .eq("status", "pending")
      .eq("is_automated", true);
    const ids = (rows ?? [])
      .filter((r) => {
        const c = one(r.cadence) as { stop_when: CadenceStopWhen } | null;
        return c ? stopsOnReply(c.stop_when) : false;
      })
      .map((r) => r.id as string);
    if (ids.length === 0) return;

    await db
      .from("deal_follow_ups")
      .update({
        status: "cancelled",
        status_reason: "customer_replied",
        completed_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("status", "pending");
  } catch (err) {
    log("cancelFollowUpsOnInbound failed", err);
  }
}

// ------------------------------------------------------------
// Cron
// ------------------------------------------------------------

export interface CrmCronResult {
  sent: number;
  cancelled: number;
  failed: number;
  notified: number;
  assigned: number;
}

const CLAIM_STALE_MS = 10 * 60_000;

/** Supabase embeds come back as an object or a one-element array. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function runCrmCron(db: DB, now = new Date()): Promise<CrmCronResult> {
  const result: CrmCronResult = { sent: 0, cancelled: 0, failed: 0, notified: 0, assigned: 0 };
  try {
    await dispatchAutomatedFollowUps(db, now, result);
  } catch (err) {
    log("dispatchAutomatedFollowUps failed", err);
  }
  try {
    await notifyDueFollowUps(db, now, result);
  } catch (err) {
    log("notifyDueFollowUps failed", err);
  }
  try {
    await assignStalePending(db, now, result);
  } catch (err) {
    log("assignStalePending failed", err);
  }
  return result;
}

interface DueRow {
  id: string;
  account_id: string;
  deal_id: string;
  cadence_id: string | null;
  cadence_step_position: number | null;
  created_at: string;
}

async function dispatchAutomatedFollowUps(db: DB, now: Date, result: CrmCronResult) {
  const nowIso = now.toISOString();
  const { data: due, error } = await db
    .from("deal_follow_ups")
    .select("id, account_id, deal_id, cadence_id, cadence_step_position, created_at")
    .eq("status", "pending")
    .eq("is_automated", true)
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  // Release claims left by a crashed run (older than 10 minutes) so
  // those rows are retried.
  const staleIso = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  await db
    .from("deal_follow_ups")
    .update({ completed_at: null })
    .eq("status", "pending")
    .eq("is_automated", true)
    .lt("completed_at", staleIso);

  for (const row of (due ?? []) as DueRow[]) {
    // Claim: completed_at doubles as a short-lived lock so overlapping
    // cron runs never double-send. Plain filters only — PostgREST
    // re-applies an `or=` filter to the returned row, which would hide
    // a successful claim.
    const { data: claim, error: claimErr } = await db
      .from("deal_follow_ups")
      .update({ completed_at: nowIso })
      .eq("id", row.id)
      .eq("status", "pending")
      .is("completed_at", null)
      .select("id")
      .maybeSingle();
    if (claimErr) log("claim follow-up failed", claimErr);
    if (!claim) continue;

    const finish = (patch: Record<string, unknown>) =>
      db.from("deal_follow_ups").update(patch).eq("id", row.id);

    try {
      await sendOneAutomated(db, row, now, result, finish);
    } catch (err) {
      result.failed++;
      await finish({
        status: "skipped",
        status_reason: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      });
    }
  }
}

async function sendOneAutomated(
  db: DB,
  row: DueRow,
  now: Date,
  result: CrmCronResult,
  finish: (patch: Record<string, unknown>) => PromiseLike<unknown>,
) {
  if (!row.cadence_id || row.cadence_step_position === null) {
    result.cancelled++;
    await finish({ status: "cancelled", status_reason: "cadence_deleted" });
    return;
  }

  const [{ data: deal }, { data: cadence }, { data: steps }] = await Promise.all([
    db
      .from("deals")
      .select(
        "id, account_id, user_id, status, stage_id, title, contact_id, conversation_id, assigned_to, contact:contacts(name, phone), assignee:profiles!deals_assigned_to_fkey(full_name)",
      )
      .eq("id", row.deal_id)
      .maybeSingle(),
    db
      .from("follow_up_cadences")
      .select("id, account_id, name, stop_when, is_active, trigger_stage_id, created_by")
      .eq("id", row.cadence_id)
      .maybeSingle(),
    db
      .from("follow_up_cadence_steps")
      .select("position, delay_value, delay_unit, template_name, template_language, template_params")
      .eq("cadence_id", row.cadence_id)
      .order("position", { ascending: true }),
  ]);

  if (!deal || !cadence || cadence.account_id !== deal.account_id || !deal.contact_id) {
    result.cancelled++;
    await finish({ status: "cancelled", status_reason: "deal_or_cadence_missing" });
    return;
  }

  const conversationId = await resolveConversationId(db, deal);
  const lastInboundAt = conversationId ? await lastCustomerMessageAt(db, conversationId) : null;

  const stop = cadenceStopReason({
    stopWhen: cadence.stop_when as CadenceStopWhen,
    cadenceActive: !!cadence.is_active,
    dealStatus: deal.status as DealStatus,
    dealStageId: deal.stage_id as string,
    triggerStageId: cadence.trigger_stage_id as string,
    scheduledAt: row.created_at,
    lastInboundAt,
  });
  if (stop) {
    result.cancelled++;
    await finish({ status: "cancelled", status_reason: stop });
    return;
  }
  if (!conversationId) {
    result.failed++;
    await finish({ status: "skipped", status_reason: "no_conversation" });
    return;
  }

  const step = (steps ?? []).find((s) => s.position === row.cadence_step_position);
  if (!step) {
    result.cancelled++;
    await finish({ status: "cancelled", status_reason: "step_deleted" });
    return;
  }

  const contact = one(deal.contact) as { name: string | null; phone: string | null } | null;
  const assignee = one(deal.assignee) as { full_name: string | null } | null;
  const params = resolveTemplateParams(step.template_params, {
    contactName: contact?.name,
    contactPhone: contact?.phone,
    dealTitle: deal.title as string,
    agentName: assignee?.full_name,
  });

  const sent = await engineSendTemplate({
    accountId: deal.account_id as string,
    userId: (cadence.created_by as string | null) ?? (deal.user_id as string),
    conversationId,
    contactId: deal.contact_id as string,
    templateName: step.template_name as string,
    language: (step.template_language as string | null) ?? undefined,
    params: params.length > 0 ? params : undefined,
  });

  result.sent++;
  await finish({ status: "done", whatsapp_message_id: sent.whatsapp_message_id });

  const next = nextCadenceStep(steps ?? [], row.cadence_step_position);
  if (next) {
    const { error } = await db.from("deal_follow_ups").insert({
      account_id: deal.account_id,
      deal_id: deal.id,
      assigned_to: deal.assigned_to,
      due_at: addDelay(now, next.delay_value, next.delay_unit).toISOString(),
      channel: "whatsapp",
      template_name: next.template_name,
      is_automated: true,
      cadence_id: cadence.id,
      cadence_step_position: next.position,
      note: (cadence.name as string | null) ?? null,
    });
    // 23505 = a pending row for this cadence already exists (a fresh
    // stage entry re-started the sequence) — that one wins.
    if (error && !String(error.code).includes("23505")) log("schedule next step failed", error);
  }
}

async function resolveConversationId(
  db: DB,
  deal: { account_id: unknown; contact_id: unknown; conversation_id: unknown },
): Promise<string | null> {
  if (deal.conversation_id) return deal.conversation_id as string;
  const { data } = await db
    .from("conversations")
    .select("id")
    .eq("account_id", deal.account_id as string)
    .eq("contact_id", deal.contact_id as string)
    .order("created_at", { ascending: true })
    .limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

async function lastCustomerMessageAt(db: DB, conversationId: string): Promise<string | null> {
  const { data } = await db
    .from("messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("sender_type", "customer")
    .order("created_at", { ascending: false })
    .limit(1);
  return (data?.[0]?.created_at as string | undefined) ?? null;
}

async function notifyDueFollowUps(db: DB, now: Date, result: CrmCronResult) {
  const { data: rows, error } = await db
    .from("deal_follow_ups")
    .select(
      "id, account_id, note, channel, assignee:profiles!deal_follow_ups_assigned_to_fkey(user_id), deal:deals(title, contact_id, conversation_id)",
    )
    .eq("status", "pending")
    .eq("is_automated", false)
    .is("notified_at", null)
    .not("assigned_to", "is", null)
    .lte("due_at", now.toISOString())
    .limit(100);
  if (error) throw error;

  for (const r of rows ?? []) {
    // Claim first so a parallel run can't notify twice.
    const { data: claim } = await db
      .from("deal_follow_ups")
      .update({ notified_at: now.toISOString() })
      .eq("id", r.id)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();
    if (!claim) continue;

    const assignee = one(r.assignee) as { user_id: string } | null;
    const deal = one(r.deal) as {
      title: string;
      contact_id: string | null;
      conversation_id: string | null;
    } | null;
    if (!assignee || !deal) continue;

    const { error: insErr } = await db.from("notifications").insert({
      account_id: r.account_id,
      user_id: assignee.user_id,
      type: "follow_up_due",
      conversation_id: deal.conversation_id,
      contact_id: deal.contact_id,
      title: "Follow-up due",
      body: r.note ? `${deal.title}: ${r.note}` : deal.title,
    });
    if (insErr) log("follow-up notification insert failed", insErr);
    else result.notified++;
  }
}

async function assignStalePending(db: DB, now: Date, result: CrmCronResult) {
  const cutoff = new Date(now.getTime() - PENDING_ASSIGN_GRACE_MS).toISOString();
  const { data: rows, error } = await db
    .from("conversations")
    .select("id, account_id, contact_id")
    .eq("crm_assign_pending", true)
    .lte("created_at", cutoff)
    .limit(50);
  if (error) throw error;

  for (const c of rows ?? []) {
    const args = {
      accountId: c.account_id as string,
      contactId: c.contact_id as string,
      conversationId: c.id as string,
    };
    if (await hasActiveFlowRun(db, args.accountId, args.contactId)) continue;
    if (await claimAndAssign(db, args)) result.assigned++;
  }
}

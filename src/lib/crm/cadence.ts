// ============================================================
// Automated follow-up cadences — pure, unit-testable, no I/O.
//
// Lifecycle (see migration 044 + src/lib/crm/server.ts):
//   1. A deal enters a cadence's trigger stage → the `deals_sync_
//      cadences` trigger inserts ONE pending row for step 0, due
//      `delay(step 0)` after entry.
//   2. The cron dispatches the row (after re-checking the stop
//      condition with `cadenceStopReason`), then schedules the next
//      step with `nextCadenceStep` + `addDelay`, relative to the send.
//   3. Pending rows are cancelled when the stop condition hits: an
//      inbound reply (webhook), the deal closing or leaving the stage
//      (DB trigger). The cron guard below is the belt-and-braces check
//      for anything that slipped between those writes.
// ============================================================

import type {
  CadenceDelayUnit,
  CadenceStopWhen,
  DealStatus,
  FollowUpCadenceStep,
} from "@/types";

const UNIT_MS: Record<CadenceDelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

/** `base` shifted forward by one step's delay. */
export function addDelay(
  base: Date,
  delayValue: number,
  unit: CadenceDelayUnit,
): Date {
  const value = Number.isFinite(delayValue) ? Math.max(0, delayValue) : 0;
  return new Date(base.getTime() + value * UNIT_MS[unit]);
}

/** The step after `position`, or null when the sequence is finished. */
export function nextCadenceStep<
  T extends Pick<FollowUpCadenceStep, "position">,
>(steps: T[], position: number): T | null {
  const later = steps
    .filter((s) => s.position > position)
    .sort((a, b) => a.position - b.position);
  return later[0] ?? null;
}

/**
 * Cumulative send offsets (ms after stage entry) for every step — the
 * cadence dialog's "sends 2h, then 1d later" preview.
 */
export function cadenceTimeline(
  steps: Pick<FollowUpCadenceStep, "position" | "delay_value" | "delay_unit">[],
): number[] {
  let total = 0;
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      total += Math.max(0, s.delay_value) * UNIT_MS[s.delay_unit];
      return total;
    });
}

export type CadenceStopReason =
  | "cadence_inactive"
  | "deal_closed"
  | "left_stage"
  | "customer_replied";

export interface CadenceGuardInput {
  stopWhen: CadenceStopWhen;
  cadenceActive: boolean;
  dealStatus: DealStatus | null | undefined;
  dealStageId: string;
  triggerStageId: string;
  /** When this follow-up row was scheduled. */
  scheduledAt: string;
  /** Latest customer message on the deal's conversation, if any. */
  lastInboundAt: string | null;
}

/**
 * Why an automated follow-up must NOT be sent right now, or null when
 * it may go out. Mirrors the cancellation rules in the DB trigger and
 * the webhook so a row that slipped through is still caught.
 */
export function cadenceStopReason(i: CadenceGuardInput): CadenceStopReason | null {
  if (!i.cadenceActive) return "cadence_inactive";
  if (i.stopWhen === "never") return null;

  if (i.dealStatus === "won" || i.dealStatus === "lost") return "deal_closed";
  if (i.dealStageId !== i.triggerStageId) return "left_stage";

  if (
    i.stopWhen === "reply_or_closed" &&
    i.lastInboundAt &&
    new Date(i.lastInboundAt).getTime() > new Date(i.scheduledAt).getTime()
  ) {
    return "customer_replied";
  }
  return null;
}

/** Whether an inbound customer message stops this cadence. */
export function stopsOnReply(stopWhen: CadenceStopWhen): boolean {
  return stopWhen === "reply_or_closed";
}

export interface TemplateTokenContext {
  contactName?: string | null;
  contactPhone?: string | null;
  dealTitle?: string | null;
  agentName?: string | null;
}

/**
 * Resolve `{{contact.name}}`, `{{contact.phone}}`, `{{deal.title}}`,
 * `{{agent.name}}` inside a step's positional template params. Unknown
 * tokens are left as-is; empty values fall back to a safe default so
 * Meta never receives an empty parameter (which it rejects).
 */
export function resolveTemplateParams(
  params: unknown,
  ctx: TemplateTokenContext,
): string[] {
  const list = Array.isArray(params) ? params : [];
  const values: Record<string, string> = {
    "contact.name": ctx.contactName?.trim() || ctx.contactPhone?.trim() || "there",
    "contact.phone": ctx.contactPhone?.trim() || "",
    "deal.title": ctx.dealTitle?.trim() || "",
    "agent.name": ctx.agentName?.trim() || "our team",
  };
  return list.map((raw) => {
    const out = String(raw ?? "").replace(
      /\{\{\s*([a-z]+\.[a-z]+)\s*\}\}/gi,
      (match, key: string) => values[key.toLowerCase()] ?? match,
    );
    return out.trim() === "" ? "-" : out;
  });
}

/** Number of positional `{{n}}` variables a template body expects. */
export function countTemplateVariables(body: string | null | undefined): number {
  let max = 0;
  for (const m of (body ?? "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    max = Math.max(max, Number(m[1]));
  }
  return max;
}

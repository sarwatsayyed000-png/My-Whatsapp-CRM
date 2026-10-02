// ============================================================
// CRM & Deals maths — pure, unit-testable, no I/O.
//
// Team Performance KPIs + leaderboard, target progress, follow-up
// buckets and the "Today, 09:15 PM" timestamps. `now` is always
// injected so results are deterministic in tests.
// ============================================================

import type { DealStatus, TargetPeriod } from "@/types";
import type { ResponseSample } from "@/lib/dashboard/response-time";

export const DEFAULT_TARGET_DEALS_WON = 10;

// ---- periods ----------------------------------------------------------

/** Start of the current week (Monday 00:00 local), month or quarter. */
export function periodStart(period: TargetPeriod, now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === "weekly") {
    const mondayOffset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - mondayOffset);
    return d;
  }
  if (period === "monthly") return new Date(now.getFullYear(), now.getMonth(), 1);
  const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
  return new Date(now.getFullYear(), quarterMonth, 1);
}

function inPeriod(iso: string | null | undefined, start: Date, now: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t >= start.getTime() && t <= now.getTime();
}

// ---- rates & targets --------------------------------------------------

/**
 * Win rate in percent, one decimal: won / (won + lost). Open deals
 * aren't decided yet, so they don't drag the rate down. 0 when nothing
 * has closed.
 */
export function winRate(won: number, lost: number): number {
  const decided = won + lost;
  if (decided <= 0) return 0;
  return Math.round((won / decided) * 1000) / 10;
}

export interface TargetProgress {
  /** 0–100, for the progress bar. */
  percent: number;
  /** Uncapped percentage, e.g. 150 when the target is beaten by half. */
  rawPercent: number;
  met: boolean;
}

/** Deals-won progress against a target. A target of 0 means "no target". */
export function targetProgress(won: number, target: number): TargetProgress {
  if (!Number.isFinite(target) || target <= 0) {
    return { percent: 0, rawPercent: 0, met: false };
  }
  const raw = Math.round((Math.max(0, won) / target) * 100);
  return { percent: Math.min(100, raw), rawPercent: raw, met: won >= target };
}

// ---- KPIs + leaderboard -----------------------------------------------

export interface PerfDeal {
  assigned_to: string | null;
  status: DealStatus | null | undefined;
  value: number | string | null;
  created_at: string;
  closed_at: string | null;
}

export interface PerfAgent {
  id: string;
  user_id: string;
  full_name: string;
}

export interface TeamKpis {
  totalActiveLeads: number;
  dealsWon: number;
  dealsLost: number;
  closedValue: number;
  winRate: number;
}

const num = (v: number | string | null | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Account-level KPI cards. Active leads are a live snapshot (all open
 * deals); won / lost / closed value count deals closed in the period.
 */
export function computeKpis(
  deals: PerfDeal[],
  period: TargetPeriod,
  now: Date,
): TeamKpis {
  const start = periodStart(period, now);
  let active = 0;
  let won = 0;
  let lost = 0;
  let value = 0;
  for (const d of deals) {
    if (d.status === "open" || !d.status) active++;
    else if (inPeriod(d.closed_at, start, now)) {
      if (d.status === "won") {
        won++;
        value += num(d.value);
      } else if (d.status === "lost") lost++;
    }
  }
  return {
    totalActiveLeads: active,
    dealsWon: won,
    dealsLost: lost,
    closedValue: value,
    winRate: winRate(won, lost),
  };
}

export interface LeaderboardRow {
  agentId: string;
  name: string;
  leadsAssigned: number;
  won: number;
  lost: number;
  revenueClosed: number;
  targetDealsWon: number;
  progress: TargetProgress;
  winRate: number;
  /** Average first-response minutes, null when no samples. */
  avgResponseMinutes: number | null;
}

/**
 * One row per agent. "Leads assigned" counts deals assigned to the
 * agent that were created in the period; won/lost/revenue count deals
 * closed in the period. Sorted by revenue, then deals won.
 */
export function buildLeaderboard(args: {
  agents: PerfAgent[];
  deals: PerfDeal[];
  targets: Map<string, number>;
  /** Keyed by auth user id (conversations.assigned_agent_id). */
  responseMinutes: Map<string, number | null>;
  period: TargetPeriod;
  now: Date;
}): LeaderboardRow[] {
  const start = periodStart(args.period, args.now);
  const rows = new Map<string, LeaderboardRow>();
  for (const a of args.agents) {
    const target = args.targets.get(a.id) ?? DEFAULT_TARGET_DEALS_WON;
    rows.set(a.id, {
      agentId: a.id,
      name: a.full_name,
      leadsAssigned: 0,
      won: 0,
      lost: 0,
      revenueClosed: 0,
      targetDealsWon: target,
      progress: targetProgress(0, target),
      winRate: 0,
      avgResponseMinutes: args.responseMinutes.get(a.user_id) ?? null,
    });
  }
  for (const d of args.deals) {
    const row = d.assigned_to ? rows.get(d.assigned_to) : undefined;
    if (!row) continue;
    if (inPeriod(d.created_at, start, args.now)) row.leadsAssigned++;
    if (inPeriod(d.closed_at, start, args.now)) {
      if (d.status === "won") {
        row.won++;
        row.revenueClosed += num(d.value);
      } else if (d.status === "lost") row.lost++;
    }
  }
  for (const row of rows.values()) {
    row.progress = targetProgress(row.won, row.targetDealsWon);
    row.winRate = winRate(row.won, row.lost);
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.revenueClosed - a.revenueClosed ||
      b.won - a.won ||
      a.name.localeCompare(b.name),
  );
}

// ---- response time ----------------------------------------------------
// Pairing lives in src/lib/dashboard/response-time.ts (shared with the
// dashboard chart); this only attributes samples to agents.

export type { ResponseSample } from "@/lib/dashboard/response-time";

/** Average response minutes per agent, attributing each conversation
 *  to its assigned agent (auth user id). */
export function averageResponseByAgent(
  samples: ResponseSample[],
  conversationAgent: Map<string, string | null>,
): Map<string, number | null> {
  const sums = new Map<string, { total: number; n: number }>();
  for (const s of samples) {
    const agent = conversationAgent.get(s.conversationId);
    if (!agent) continue;
    const mins = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000;
    if (mins < 0) continue;
    const acc = sums.get(agent) ?? { total: 0, n: 0 };
    acc.total += mins;
    acc.n++;
    sums.set(agent, acc);
  }
  const out = new Map<string, number | null>();
  for (const [agent, { total, n }] of sums) out.set(agent, n ? total / n : null);
  return out;
}

// ---- follow-up buckets ------------------------------------------------

export interface BucketFollowUp {
  status: string;
  due_at: string;
  is_automated: boolean;
}

export interface FollowUpBuckets<T> {
  /** Pending and past due — "Missed / Late". */
  missed: T[];
  /** Pending, not yet due — "Upcoming". */
  upcoming: T[];
  /** Pending and due later today (subset of upcoming). */
  dueToday: T[];
  /** Pending automated WhatsApp sends (any due time). */
  automated: T[];
}

function sameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function bucketFollowUps<T extends BucketFollowUp>(
  rows: T[],
  now: Date,
): FollowUpBuckets<T> {
  const out: FollowUpBuckets<T> = { missed: [], upcoming: [], dueToday: [], automated: [] };
  const sorted = [...rows].sort((a, b) => a.due_at.localeCompare(b.due_at));
  for (const r of sorted) {
    if (r.status !== "pending") continue;
    const due = new Date(r.due_at);
    if (r.is_automated) out.automated.push(r);
    if (due.getTime() < now.getTime()) out.missed.push(r);
    else {
      out.upcoming.push(r);
      if (sameLocalDay(due, now)) out.dueToday.push(r);
    }
  }
  return out;
}

/** True when the deal has a pending follow-up that is past due. */
export function overdueDealIds(rows: (BucketFollowUp & { deal_id: string })[], now: Date): Set<string> {
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.status === "pending" && new Date(r.due_at).getTime() < now.getTime()) ids.add(r.deal_id);
  }
  return ids;
}

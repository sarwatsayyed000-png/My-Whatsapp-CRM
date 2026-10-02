// ============================================================
// Round-robin lead distribution — pure, unit-testable, no I/O.
//
// The webhook (src/lib/crm/server.ts) loads the account's members +
// presence rows, asks `eligibleAgents` who may receive a new lead,
// advances the per-account counter atomically in Postgres
// (`crm_bump_round_robin`, migration 044) and hands the counter to
// `pickRoundRobin`. Keeping the selection here (not in SQL) means the
// rotation rules are covered by tests and readable in one place.
// ============================================================

import type { AccountRole } from "@/lib/auth/roles";
import { hasMinRole, isAccountRole } from "@/lib/auth/roles";
import { derivePresence, type StoredPresence } from "@/lib/presence";

export interface RoundRobinMember {
  /** profiles.id — what deals.assigned_to references. */
  id: string;
  /** auth.users.id — what conversations.assigned_agent_id references. */
  user_id: string;
  full_name?: string | null;
  account_role: AccountRole | string | null;
  created_at: string;
}

export interface RoundRobinPresence {
  user_id: string;
  status: StoredPresence;
  last_seen_at: string;
}

/**
 * Members who may receive auto-assigned leads, in a stable rotation
 * order (oldest member first, id as tie-break).
 *
 * - Viewers are read-only, so they never receive leads.
 * - When presence data exists, members who are online are preferred,
 *   then members who are away (idle tab). Offline members are skipped.
 * - If nobody is online or away — or the account has no presence rows
 *   at all (presence never deployed / nobody signed in yet) — every
 *   eligible member stays in the rotation so leads are never dropped.
 */
export function eligibleAgents(
  members: RoundRobinMember[],
  presence: RoundRobinPresence[],
  now: number,
): RoundRobinMember[] {
  const roster = members
    .filter(
      (m) => isAccountRole(m.account_role) && hasMinRole(m.account_role, "agent"),
    )
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  if (roster.length === 0 || presence.length === 0) return roster;

  const byUser = new Map(presence.map((p) => [p.user_id, p]));
  const statusOf = (m: RoundRobinMember) => {
    const p = byUser.get(m.user_id);
    return derivePresence(p?.status, p?.last_seen_at, now);
  };

  const online = roster.filter((m) => statusOf(m) === "online");
  if (online.length > 0) return online;
  const away = roster.filter((m) => statusOf(m) === "away");
  if (away.length > 0) return away;
  return roster;
}

/**
 * Pick the agent for the `counter`-th assignment (1-based — the value
 * `crm_bump_round_robin` returns after incrementing). Returns null
 * when there is nobody to assign to.
 */
export function pickRoundRobin<T>(candidates: T[], counter: number): T | null {
  if (candidates.length === 0) return null;
  const n = candidates.length;
  const idx = (((Math.trunc(counter) - 1) % n) + n) % n;
  return candidates[idx];
}

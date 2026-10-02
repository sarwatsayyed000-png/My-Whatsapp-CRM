import { describe, expect, it } from "vitest";

import { eligibleAgents, pickRoundRobin, type RoundRobinMember } from "./round-robin";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const fresh = new Date(NOW - 10_000).toISOString();
const stale = new Date(NOW - 10 * 60_000).toISOString();

function member(id: string, role: string, created: string): RoundRobinMember {
  return { id: `p-${id}`, user_id: `u-${id}`, full_name: id, account_role: role, created_at: created };
}

const team = [
  member("carol", "agent", "2026-03-01T00:00:00Z"),
  member("alice", "owner", "2026-01-01T00:00:00Z"),
  member("vic", "viewer", "2026-01-15T00:00:00Z"),
  member("bob", "admin", "2026-02-01T00:00:00Z"),
];

describe("eligibleAgents", () => {
  it("excludes viewers and orders oldest member first", () => {
    expect(eligibleAgents(team, [], NOW).map((m) => m.full_name)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });

  it("drops members with an unknown role", () => {
    const odd = [...team, member("x", "superuser", "2025-01-01T00:00:00Z")];
    expect(eligibleAgents(odd, [], NOW)).toHaveLength(3);
  });

  it("prefers online members when presence data exists", () => {
    const presence = [
      { user_id: "u-bob", status: "online" as const, last_seen_at: fresh },
      { user_id: "u-carol", status: "online" as const, last_seen_at: stale }, // offline
      { user_id: "u-alice", status: "away" as const, last_seen_at: fresh },
    ];
    expect(eligibleAgents(team, presence, NOW).map((m) => m.full_name)).toEqual(["bob"]);
  });

  it("falls back to away members when nobody is online", () => {
    const presence = [
      { user_id: "u-alice", status: "away" as const, last_seen_at: fresh },
      { user_id: "u-bob", status: "online" as const, last_seen_at: stale },
    ];
    expect(eligibleAgents(team, presence, NOW).map((m) => m.full_name)).toEqual(["alice"]);
  });

  it("keeps everyone in rotation when everybody is offline", () => {
    const presence = [{ user_id: "u-alice", status: "online" as const, last_seen_at: stale }];
    expect(eligibleAgents(team, presence, NOW)).toHaveLength(3);
  });

  it("returns an empty list when only viewers exist", () => {
    expect(eligibleAgents([member("v", "viewer", fresh)], [], NOW)).toEqual([]);
  });
});

describe("pickRoundRobin", () => {
  const agents = ["a", "b", "c"];

  it("rotates through candidates in order using the 1-based counter", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => pickRoundRobin(agents, n))).toEqual([
      "a",
      "b",
      "c",
      "a",
      "b",
      "c",
      "a",
    ]);
  });

  it("gives every agent an equal share over a full cycle", () => {
    const counts = new Map<string, number>();
    for (let n = 1; n <= 300; n++) {
      const pick = pickRoundRobin(agents, n)!;
      counts.set(pick, (counts.get(pick) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([100, 100, 100]);
  });

  it("handles a single agent and an empty roster", () => {
    expect(pickRoundRobin(["solo"], 42)).toBe("solo");
    expect(pickRoundRobin([], 1)).toBeNull();
  });

  it("never indexes out of range for zero/negative/fractional counters", () => {
    for (const n of [0, -1, -7, 2.9]) {
      expect(agents).toContain(pickRoundRobin(agents, n));
    }
  });
});

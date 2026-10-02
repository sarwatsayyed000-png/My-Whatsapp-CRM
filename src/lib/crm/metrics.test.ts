import { describe, expect, it } from "vitest";

import { pairResponseSamples } from "@/lib/dashboard/response-time";
import {
  averageResponseByAgent,
  bucketFollowUps,
  buildLeaderboard,
  computeKpis,
  DEFAULT_TARGET_DEALS_WON,
  overdueDealIds,
  periodStart,
  targetProgress,
  winRate,
  type PerfDeal,
} from "./metrics";
import { csvSafe, formatDayTime, formatMinutes } from "./format";

// Thursday 2 Oct 2026, 15:00 local.
const NOW = new Date(2026, 9, 2, 15, 0, 0);
const iso = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe("winRate", () => {
  it("is won / (won + lost) with one decimal", () => {
    expect(winRate(1, 2)).toBe(33.3);
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(5, 0)).toBe(100);
  });
  it("is 0 when nothing has closed", () => {
    expect(winRate(0, 0)).toBe(0);
  });
});

describe("targetProgress", () => {
  it("computes percent and caps the bar at 100", () => {
    expect(targetProgress(0, 10)).toEqual({ percent: 0, rawPercent: 0, met: false });
    expect(targetProgress(3, 10)).toEqual({ percent: 30, rawPercent: 30, met: false });
    expect(targetProgress(10, 10)).toEqual({ percent: 100, rawPercent: 100, met: true });
    expect(targetProgress(15, 10)).toEqual({ percent: 100, rawPercent: 150, met: true });
  });
  it("treats a zero/invalid target as no target", () => {
    expect(targetProgress(4, 0).percent).toBe(0);
    expect(targetProgress(4, Number.NaN).met).toBe(false);
  });
  it("defaults targets to 10 won", () => {
    expect(DEFAULT_TARGET_DEALS_WON).toBe(10);
  });
});

describe("periodStart", () => {
  it("starts weeks on Monday", () => {
    expect(periodStart("weekly", NOW)).toEqual(new Date(2026, 8, 28));
  });
  it("starts months on the 1st and quarters on Jan/Apr/Jul/Oct 1st", () => {
    expect(periodStart("monthly", NOW)).toEqual(new Date(2026, 9, 1));
    expect(periodStart("quarterly", NOW)).toEqual(new Date(2026, 9, 1));
    expect(periodStart("quarterly", new Date(2026, 7, 20))).toEqual(new Date(2026, 6, 1));
  });
});

const deals: PerfDeal[] = [
  { assigned_to: "p1", status: "open", value: 100, created_at: iso(2026, 9, 1), closed_at: null },
  { assigned_to: "p1", status: "won", value: "250.50", created_at: iso(2026, 8, 30), closed_at: iso(2026, 9, 2, 9) },
  { assigned_to: "p1", status: "lost", value: 999, created_at: iso(2026, 8, 1), closed_at: iso(2026, 9, 1) },
  { assigned_to: "p2", status: "won", value: 1000, created_at: iso(2026, 7, 1), closed_at: iso(2026, 8, 10) }, // last month
  { assigned_to: "p2", status: "won", value: 400, created_at: iso(2026, 9, 2), closed_at: iso(2026, 9, 2, 10) },
  { assigned_to: null, status: "open", value: 50, created_at: iso(2026, 9, 2), closed_at: null },
];

describe("computeKpis", () => {
  it("counts active leads live and closed deals within the period", () => {
    expect(computeKpis(deals, "weekly", NOW)).toEqual({
      totalActiveLeads: 2,
      dealsWon: 2,
      dealsLost: 1,
      closedValue: 650.5,
      winRate: 66.7,
    });
  });
  it("widens with the period", () => {
    expect(computeKpis(deals, "quarterly", NOW).dealsWon).toBe(2);
    expect(computeKpis(deals, "quarterly", new Date(2026, 8, 30)).dealsWon).toBe(1);
  });
});

describe("buildLeaderboard", () => {
  const rows = buildLeaderboard({
    agents: [
      { id: "p1", user_id: "u1", full_name: "Aisha" },
      { id: "p2", user_id: "u2", full_name: "Omar" },
      { id: "p3", user_id: "u3", full_name: "Zed" },
    ],
    deals,
    targets: new Map([["p2", 2]]),
    responseMinutes: new Map([["u1", 12.5]]),
    period: "monthly",
    now: NOW,
  });

  it("aggregates per agent and sorts by revenue", () => {
    expect(rows.map((r) => r.name)).toEqual(["Omar", "Aisha", "Zed"]);
    const aisha = rows.find((r) => r.name === "Aisha")!;
    expect(aisha).toMatchObject({
      leadsAssigned: 1, // the open deal created this month
      won: 1,
      lost: 1,
      revenueClosed: 250.5,
      targetDealsWon: 10,
      winRate: 50,
      avgResponseMinutes: 12.5,
    });
    expect(aisha.progress.percent).toBe(10);
  });

  it("uses configured targets and defaults the rest", () => {
    const omar = rows.find((r) => r.name === "Omar")!;
    expect(omar.won).toBe(1); // September win is outside October
    expect(omar.targetDealsWon).toBe(2);
    expect(omar.progress.percent).toBe(50);
    expect(rows.find((r) => r.name === "Zed")!.progress).toEqual({
      percent: 0,
      rawPercent: 0,
      met: false,
    });
  });
});

describe("response time", () => {
  it("pairs the first unanswered customer message with the next reply", () => {
    const samples = pairResponseSamples([
      { conversation_id: "c1", sender_type: "customer", created_at: "2026-10-02T10:00:00Z" },
      { conversation_id: "c1", sender_type: "customer", created_at: "2026-10-02T10:01:00Z" },
      { conversation_id: "c1", sender_type: "agent", created_at: "2026-10-02T10:10:00Z" },
      { conversation_id: "c2", sender_type: "customer", created_at: "2026-10-02T11:00:00Z" },
      { conversation_id: "c2", sender_type: "bot", created_at: "2026-10-02T11:30:00Z" },
      { conversation_id: "c3", sender_type: "customer", created_at: "2026-10-02T12:00:00Z" },
    ]);
    expect(samples).toHaveLength(2);
    const avg = averageResponseByAgent(
      samples,
      new Map([
        ["c1", "u1"],
        ["c2", "u1"],
      ]),
    );
    expect(avg.get("u1")).toBe(20);
  });
});

describe("bucketFollowUps", () => {
  const rows = [
    { id: "late", deal_id: "d1", status: "pending", is_automated: false, due_at: iso(2026, 9, 1) },
    { id: "today", deal_id: "d2", status: "pending", is_automated: true, due_at: iso(2026, 9, 2, 18) },
    { id: "later", deal_id: "d3", status: "pending", is_automated: false, due_at: iso(2026, 9, 5) },
    { id: "done", deal_id: "d1", status: "done", is_automated: false, due_at: iso(2026, 8, 1) },
  ];

  it("splits pending rows into missed / upcoming / due today / automated", () => {
    const b = bucketFollowUps(rows, NOW);
    expect(b.missed.map((r) => r.id)).toEqual(["late"]);
    expect(b.upcoming.map((r) => r.id)).toEqual(["today", "later"]);
    expect(b.dueToday.map((r) => r.id)).toEqual(["today"]);
    expect(b.automated.map((r) => r.id)).toEqual(["today"]);
  });

  it("flags deals with an overdue pending follow-up", () => {
    expect([...overdueDealIds(rows, NOW)]).toEqual(["d1"]);
  });
});

describe("format helpers", () => {
  const labels = { today: "Today", yesterday: "Yesterday", tomorrow: "Tomorrow" };
  it("renders relative day + time", () => {
    expect(formatDayTime(new Date(2026, 9, 2, 21, 15).toISOString(), NOW, labels)).toBe(
      "Today, 09:15 PM",
    );
    expect(formatDayTime(new Date(2026, 9, 1, 8, 2).toISOString(), NOW, labels)).toBe(
      "Yesterday, 08:02 AM",
    );
    expect(formatDayTime(null, NOW, labels)).toBe("—");
  });
  it("formats minutes compactly", () => {
    expect(formatMinutes(null)).toBe("—");
    expect(formatMinutes(0.4)).toBe("<1m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(130)).toBe("2h 10m");
    expect(formatMinutes(60 * 27)).toBe("1d 3h");
  });
  it("neutralises CSV formula injection", () => {
    expect(csvSafe("=HYPERLINK()")).toBe("'=HYPERLINK()");
    expect(csvSafe("Ali")).toBe("Ali");
    expect(csvSafe(-5)).toBe(-5);
  });
});

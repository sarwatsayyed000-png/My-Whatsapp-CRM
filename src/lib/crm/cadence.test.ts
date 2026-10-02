import { describe, expect, it } from "vitest";

import {
  addDelay,
  cadenceStopReason,
  cadenceTimeline,
  nextCadenceStep,
  resolveTemplateParams,
  stopsOnReply,
  type CadenceGuardInput,
} from "./cadence";

const base = new Date("2026-10-02T10:00:00Z");

describe("addDelay", () => {
  it("adds minutes, hours and days", () => {
    expect(addDelay(base, 30, "minutes").toISOString()).toBe("2026-10-02T10:30:00.000Z");
    expect(addDelay(base, 2, "hours").toISOString()).toBe("2026-10-02T12:00:00.000Z");
    expect(addDelay(base, 3, "days").toISOString()).toBe("2026-10-05T10:00:00.000Z");
  });

  it("treats negative or invalid delays as immediate", () => {
    expect(addDelay(base, -5, "days").getTime()).toBe(base.getTime());
    expect(addDelay(base, Number.NaN, "hours").getTime()).toBe(base.getTime());
  });
});

describe("nextCadenceStep / cadenceTimeline", () => {
  const steps = [
    { position: 2, delay_value: 1, delay_unit: "days" as const },
    { position: 0, delay_value: 2, delay_unit: "hours" as const },
    { position: 1, delay_value: 30, delay_unit: "minutes" as const },
  ];

  it("returns the next step by position, regardless of array order", () => {
    expect(nextCadenceStep(steps, 0)?.position).toBe(1);
    expect(nextCadenceStep(steps, 1)?.position).toBe(2);
  });

  it("returns null after the last step", () => {
    expect(nextCadenceStep(steps, 2)).toBeNull();
  });

  it("skips gaps in positions (a deleted middle step)", () => {
    expect(nextCadenceStep([{ position: 0 }, { position: 5 }], 0)?.position).toBe(5);
  });

  it("builds cumulative offsets from stage entry", () => {
    const h = 3_600_000;
    expect(cadenceTimeline(steps)).toEqual([2 * h, 2.5 * h, 26.5 * h]);
  });
});

describe("cadenceStopReason", () => {
  const ok: CadenceGuardInput = {
    stopWhen: "reply_or_closed",
    cadenceActive: true,
    dealStatus: "open",
    dealStageId: "s1",
    triggerStageId: "s1",
    scheduledAt: "2026-10-02T10:00:00Z",
    lastInboundAt: "2026-10-02T09:00:00Z",
  };

  it("allows the send when nothing stopped the sequence", () => {
    expect(cadenceStopReason(ok)).toBeNull();
    expect(cadenceStopReason({ ...ok, lastInboundAt: null })).toBeNull();
  });

  it("stops when the cadence was switched off", () => {
    expect(cadenceStopReason({ ...ok, cadenceActive: false })).toBe("cadence_inactive");
    expect(cadenceStopReason({ ...ok, cadenceActive: false, stopWhen: "never" })).toBe(
      "cadence_inactive",
    );
  });

  it("stops on a customer reply after scheduling (reply_or_closed only)", () => {
    const replied = { ...ok, lastInboundAt: "2026-10-02T10:05:00Z" };
    expect(cadenceStopReason(replied)).toBe("customer_replied");
    expect(cadenceStopReason({ ...replied, stopWhen: "closed" })).toBeNull();
    expect(cadenceStopReason({ ...replied, stopWhen: "never" })).toBeNull();
  });

  it("stops when the deal is won or lost unless set to never", () => {
    expect(cadenceStopReason({ ...ok, dealStatus: "won" })).toBe("deal_closed");
    expect(cadenceStopReason({ ...ok, stopWhen: "closed", dealStatus: "lost" })).toBe(
      "deal_closed",
    );
    expect(cadenceStopReason({ ...ok, stopWhen: "never", dealStatus: "won" })).toBeNull();
  });

  it("stops when the deal left the trigger stage", () => {
    expect(cadenceStopReason({ ...ok, dealStageId: "s2" })).toBe("left_stage");
    expect(cadenceStopReason({ ...ok, stopWhen: "never", dealStageId: "s2" })).toBeNull();
  });

  it("reports which stop conditions react to replies", () => {
    expect(stopsOnReply("reply_or_closed")).toBe(true);
    expect(stopsOnReply("closed")).toBe(false);
    expect(stopsOnReply("never")).toBe(false);
  });
});

describe("resolveTemplateParams", () => {
  it("substitutes known tokens and keeps literal text", () => {
    expect(
      resolveTemplateParams(["Hi {{contact.name}}", "{{deal.title}}", "{{ agent.name }}", "Dubai"], {
        contactName: "Ali",
        dealTitle: "Family visa",
        agentName: "Sara",
      }),
    ).toEqual(["Hi Ali", "Family visa", "Sara", "Dubai"]);
  });

  it("falls back to phone / safe defaults and never sends an empty param", () => {
    expect(
      resolveTemplateParams(["{{contact.name}}", "{{agent.name}}", "", "{{deal.title}}"], {
        contactPhone: "+971500000000",
      }),
    ).toEqual(["+971500000000", "our team", "-", "-"]);
  });

  it("leaves unknown tokens untouched and tolerates non-array input", () => {
    expect(resolveTemplateParams(["{{foo.bar}}"], {})).toEqual(["{{foo.bar}}"]);
    expect(resolveTemplateParams(null, {})).toEqual([]);
  });
});

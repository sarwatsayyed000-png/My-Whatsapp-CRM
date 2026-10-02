// Shared CRM constants (client + server safe).

/** Seed stages for a new pipeline — name and colour per the product spec. */
export const DEFAULT_PIPELINE_STAGES = [
  { name: "New Lead", color: "#3b82f6", position: 0 }, // blue
  { name: "Qualified", color: "#eab308", position: 1 }, // yellow
  { name: "Proposal Sent", color: "#f97316", position: 2 }, // orange
  { name: "Negotiation", color: "#8b5cf6", position: 3 }, // purple
  { name: "Won", color: "#22c55e", position: 4 }, // green
] as const;

export const DEFAULT_PIPELINE_NAME = "Sales Pipeline";

/** Defaults when an account has no crm_settings row yet. */
export const DEFAULT_CRM_SETTINGS = {
  auto_create_deals: true,
  round_robin_enabled: true,
} as const;

/**
 * Pending-assignment safety net: a conversation still waiting for
 * round-robin this long after creation, with no active flow run, is
 * assigned by the cron (covers flows that never started or ended via
 * a path the webhook doesn't see).
 */
export const PENDING_ASSIGN_GRACE_MS = 2 * 60_000;

export const CRM_VIEWS = ["kanban", "list", "follow-ups", "performance"] as const;
export type CrmView = (typeof CRM_VIEWS)[number];

export function parseCrmView(value: string | null | undefined): CrmView {
  return (CRM_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as CrmView)
    : "kanban";
}

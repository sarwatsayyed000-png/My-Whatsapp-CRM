// ============================================================
// CRM filters — pure. The agent filter and search box in the CRM
// toolbar apply to every view, so they live in one place.
// ============================================================

/** "all" · "unassigned" · a profiles.id */
export type AgentFilter = string;
export const AGENT_ALL = "all";
export const AGENT_UNASSIGNED = "unassigned";

export function matchesAgent(assignedTo: string | null | undefined, filter: AgentFilter): boolean {
  if (filter === AGENT_ALL) return true;
  if (filter === AGENT_UNASSIGNED) return !assignedTo;
  return assignedTo === filter;
}

/** Lower-cased, digits-tolerant match for names, titles and phones. */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = q.replace(/\D/g, "");
  return fields.some((f) => {
    if (!f) return false;
    const v = f.toLowerCase();
    if (v.includes(q)) return true;
    // "+971 50 123" should find "+97150123…": compare digits only when
    // the query is mostly a number.
    return qDigits.length >= 3 && qDigits.length >= q.replace(/\s/g, "").length - 1
      ? v.replace(/\D/g, "").includes(qDigits)
      : false;
  });
}

export interface FilterableDeal {
  title: string;
  assigned_to?: string | null;
  contact?: { name?: string | null; phone?: string | null } | null;
}

export function filterDeals<T extends FilterableDeal>(
  deals: T[],
  agent: AgentFilter,
  search: string,
): T[] {
  return deals.filter(
    (d) =>
      matchesAgent(d.assigned_to, agent) &&
      matchesSearch(search, [d.title, d.contact?.name, d.contact?.phone]),
  );
}

export type SortDir = "asc" | "desc";

export function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  const mul = dir === "asc" ? 1 : -1;
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1; // blanks last
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  return String(a).localeCompare(String(b), undefined, { numeric: true }) * mul;
}

export function paginate<T>(rows: T[], page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    page: current,
    pageCount,
  };
}

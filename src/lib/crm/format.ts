// ============================================================
// CRM display formatting — pure; `now` and labels are injected so
// the output is deterministic and translatable.
// ============================================================

export interface RelativeDayLabels {
  today: string;
  yesterday: string;
  tomorrow: string;
}

function dayDiff(a: Date, b: Date): number {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da - db) / 86_400_000);
}

/**
 * "Today, 09:15 PM" · "Yesterday, 08:02 AM" · "Tomorrow, 10:00 AM" ·
 * otherwise "Oct 1, 09:15 PM" (year added when not the current year).
 */
export function formatDayTime(
  iso: string | null | undefined,
  now: Date,
  labels: RelativeDayLabels,
  locale = "en-US",
): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const diff = dayDiff(d, now);
  if (diff === 0) return `${labels.today}, ${time}`;
  if (diff === -1) return `${labels.yesterday}, ${time}`;
  if (diff === 1) return `${labels.tomorrow}, ${time}`;
  const date = d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${date}, ${time}`;
}

/** Short numeric date, e.g. "10/2/2026" in en-US. */
export function formatShortDate(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(locale);
}

/** "45m", "2h 10m", "1d 3h" — compact response-time display. */
export function formatMinutes(mins: number | null | undefined): string {
  if (mins === null || mins === undefined || !Number.isFinite(mins)) return "—";
  if (mins < 1) return "<1m";
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/**
 * Neutralise spreadsheet formula injection in CSV exports: a cell that
 * starts with = + - @ (or a tab/CR) would execute in Excel/Sheets.
 */
export function csvSafe(value: string | number | null | undefined): string | number | null | undefined {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Locale for Intl formatting from the build-time app locale. */
export function intlLocale(appLocale: string | undefined): string {
  switch (appLocale) {
    case "ko":
      return "ko-KR";
    case "pt":
      return "pt-BR";
    case "es":
      return "es-419";
    default:
      return "en-US";
  }
}

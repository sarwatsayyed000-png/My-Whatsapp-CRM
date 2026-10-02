// ============================================================
// Team report email delivery.
//
// The app has no email provider today (Supabase Auth sends its own
// auth emails, but nothing in-app can send arbitrary mail). Report
// settings are saved in `team_report_settings` so they're ready, and
// the UI tells the admin sending isn't configured. When a provider is
// added, flip this flag and send from runCrmCron (src/lib/crm/server.ts),
// which already runs on the automations cron.
// ============================================================

export const EMAIL_PROVIDER_CONFIGURED = false;

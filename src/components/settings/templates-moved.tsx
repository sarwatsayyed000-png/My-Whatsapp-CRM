'use client';

import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

/**
 * Settings → Templates now points at the standalone /templates page.
 * The section stays so `?tab=templates` deep links keep landing
 * somewhere useful.
 */
export function TemplatesMoved() {
  const t = useTranslations('Templates.moved');
  return (
    <section className="animate-in fade-in-50 space-y-4 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <Link
        href="/templates"
        className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/60"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <span className="flex-1 text-sm font-medium text-foreground">{t('cta')}</span>
        <ArrowRight className="size-4 text-muted-foreground" />
      </Link>
    </section>
  );
}

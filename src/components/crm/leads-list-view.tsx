'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type { Deal, DealStatus, PipelineStage } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toCsv } from '@/lib/analytics/calculations';
import { compareValues, paginate, type SortDir } from '@/lib/crm/filters';
import {
  csvSafe,
  formatDayTime,
  formatShortDate,
  intlLocale,
} from '@/lib/crm/format';
import {
  AgentChip,
  EmptyPanel,
  NativeSelect,
  StagePill,
  TableSkeleton,
} from './crm-ui';
import type { CrmData } from './use-crm-data';

const PAGE_SIZE = 25;

type SortKey = 'title' | 'contact' | 'stage' | 'value' | 'agent' | 'updated';

export function LeadsListView({
  data,
  deals,
  canWrite,
  onOpenDeal,
  pipelineName,
}: {
  data: CrmData;
  /** Already filtered by the toolbar's agent filter + search. */
  deals: Deal[];
  canWrite: boolean;
  onOpenDeal: (deal: Deal) => void;
  pipelineName: string;
}) {
  const t = useTranslations('Crm.list');
  const tc = useTranslations('Crm.common');
  const locale = intlLocale(useLocale());
  const { stages, members, supabase, dealsLoading } = data;

  const [stageFilter, setStageFilter] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'updated',
    dir: 'desc',
  });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stageById = useMemo(
    () => new Map(stages.map((s) => [s.id, s])),
    [stages]
  );
  const now = new Date();
  const dayLabels = {
    today: tc('today'),
    yesterday: tc('yesterday'),
    tomorrow: tc('tomorrow'),
  };

  const rows = useMemo(() => {
    const filtered =
      stageFilter === 'all'
        ? deals
        : deals.filter((d) => d.stage_id === stageFilter);
    const keyOf = (d: Deal): unknown => {
      switch (sort.key) {
        case 'title':
          return d.title.toLowerCase();
        case 'contact':
          return (d.contact?.name || d.contact?.phone || '').toLowerCase();
        case 'stage':
          return stageById.get(d.stage_id)?.position ?? null;
        case 'value':
          return Number(d.value) || 0;
        case 'agent':
          return (d.assignee?.full_name || '').toLowerCase();
        case 'updated':
          return d.updated_at ?? d.created_at;
      }
    };
    return [...filtered].sort((a, b) =>
      compareValues(keyOf(a), keyOf(b), sort.dir)
    );
  }, [deals, stageFilter, sort, stageById]);

  const {
    rows: pageRows,
    page: currentPage,
    pageCount,
  } = paginate(rows, page, PAGE_SIZE);
  const visibleSelected = rows.filter((r) => selected.has(r.id));
  const allOnPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const someOnPageSelected = pageRows.some((r) => selected.has(r.id));

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'updated' || key === 'value' ? 'desc' : 'asc' }
    );
  }

  function togglePage(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  async function runBulk(
    label: string,
    op: () => PromiseLike<{ error: { message: string } | null }>
  ) {
    setBusy(label);
    const { error } = await op();
    setBusy(null);
    if (error) {
      toast.error(t('bulkFailed'));
      return;
    }
    toast.success(t('bulkDone', { count: visibleSelected.length }));
    setSelected(new Set());
    setConfirmDelete(false);
    await data.refreshAll();
  }

  const ids = visibleSelected.map((d) => d.id);
  const bulkStage = (stageId: string) =>
    runBulk('stage', () =>
      supabase.from('deals').update({ stage_id: stageId }).in('id', ids)
    );
  const bulkAssign = (agent: string) =>
    runBulk('assign', () =>
      supabase
        .from('deals')
        .update({ assigned_to: agent === 'none' ? null : agent })
        .in('id', ids)
    );
  const bulkStatus = (status: DealStatus) =>
    runBulk(status, () =>
      supabase.from('deals').update({ status }).in('id', ids)
    );
  const bulkDelete = () =>
    runBulk('delete', () => supabase.from('deals').delete().in('id', ids));

  function exportCsv() {
    const csv = toCsv(
      [
        t('colTitle'),
        t('colContactName'),
        t('colPhone'),
        t('colStage'),
        t('colValue'),
        t('colCurrency'),
        t('colStatus'),
        t('colAgent'),
        t('colTags'),
        t('colUpdated'),
        t('colCreated'),
      ],
      rows.map((d) =>
        [
          d.title,
          d.contact?.name ?? '',
          d.contact?.phone ?? '',
          stageById.get(d.stage_id)?.name ?? '',
          Number(d.value) || 0,
          d.currency ?? '',
          d.status ?? 'open',
          d.assignee?.full_name ?? '',
          (d.contact?.tags ?? []).map((tg) => tg.name).join('; '),
          d.updated_at ?? '',
          d.created_at,
        ].map(csvSafe)
      )
    );
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const slug =
      pipelineName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'leads';
    a.download = `${slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-muted-foreground flex items-center gap-2 text-sm">
            {t('filterStage')}
            <NativeSelect
              value={stageFilter}
              onChange={(e) => {
                setStageFilter(e.target.value);
                setPage(1);
              }}
              className="w-44"
            >
              <option value="all">{t('allStages')}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <span className="text-muted-foreground text-sm">
            {t('found', { count: rows.length })}
          </span>
        </div>
        <Button
          variant="outline"
          onClick={exportCsv}
          disabled={rows.length === 0}
          className="border-border bg-card text-foreground hover:bg-muted"
        >
          <Download className="mr-1.5 h-4 w-4" />
          {t('exportCsv')}
        </Button>
      </div>

      {canWrite && visibleSelected.length > 0 && (
        <BulkBar
          count={visibleSelected.length}
          stages={stages}
          members={members}
          busy={busy}
          confirmDelete={confirmDelete}
          setConfirmDelete={setConfirmDelete}
          onStage={bulkStage}
          onAssign={bulkAssign}
          onStatus={bulkStatus}
          onDelete={bulkDelete}
          onClear={() => setSelected(new Set())}
        />
      )}

      {dealsLoading ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyPanel
          icon={Search}
          title={t('emptyTitle')}
          hint={t('emptyHint')}
        />
      ) : (
        <div className="border-border bg-card overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                {canWrite && (
                  <TableHead className="w-10">
                    <div className="flex items-center">
                      <Checkbox
                        aria-label={t('selectPage')}
                        checked={allOnPageSelected}
                        indeterminate={!allOnPageSelected && someOnPageSelected}
                        onCheckedChange={(c) => togglePage(!!c)}
                      />
                    </div>
                  </TableHead>
                )}
                <SortHead sort={sort} onSort={toggleSort} k="title">
                  {t('colLeadTitle')}
                </SortHead>
                <SortHead sort={sort} onSort={toggleSort} k="contact">
                  {t('colContact')}
                </SortHead>
                <SortHead sort={sort} onSort={toggleSort} k="stage">
                  {t('colStage')}
                </SortHead>
                <SortHead
                  sort={sort}
                  onSort={toggleSort}
                  k="value"
                  className="text-right"
                >
                  {t('colValue')}
                </SortHead>
                <SortHead sort={sort} onSort={toggleSort} k="agent">
                  {t('colAgent')}
                </SortHead>
                <TableHead className="text-muted-foreground">
                  {t('colTags')}
                </TableHead>
                <SortHead sort={sort} onSort={toggleSort} k="updated">
                  {t('colLastUpdated')}
                </SortHead>
                <TableHead className="text-muted-foreground text-right">
                  {t('colActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((d) => {
                const stage: PipelineStage | undefined = stageById.get(
                  d.stage_id
                );
                const tags = d.contact?.tags ?? [];
                return (
                  <TableRow
                    key={d.id}
                    data-state={selected.has(d.id) ? 'selected' : undefined}
                    className="border-border"
                  >
                    {canWrite && (
                      <TableCell>
                        <div className="flex items-center">
                          <Checkbox
                            aria-label={t('selectRow', { title: d.title })}
                            checked={selected.has(d.id)}
                            onCheckedChange={(c) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (c) next.add(d.id);
                                else next.delete(d.id);
                                return next;
                              })
                            }
                          />
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="max-w-[220px]">
                      <p className="text-foreground truncate font-medium">
                        {d.title}
                      </p>
                      {d.status && d.status !== 'open' && (
                        <span
                          className={
                            d.status === 'won'
                              ? 'text-[11px] font-semibold text-emerald-600 dark:text-emerald-400'
                              : 'text-[11px] font-semibold text-red-600 dark:text-red-400'
                          }
                        >
                          {d.status === 'won' ? tc('won') : tc('lost')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <p className="text-foreground truncate">
                        {d.contact?.name || '—'}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {d.contact?.phone || ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      {stage ? (
                        <StagePill name={stage.name} color={stage.color} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="text-foreground font-semibold">
                        {new Intl.NumberFormat(locale, {
                          maximumFractionDigits: 2,
                        }).format(Number(d.value) || 0)}
                      </span>{' '}
                      <span className="text-muted-foreground text-xs">
                        {d.currency}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[180px]">
                      <AgentChip
                        name={d.assignee?.full_name || null}
                        unassignedLabel={tc('unassigned')}
                      />
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <div className="flex flex-wrap gap-1">
                        {tags.length === 0 && (
                          <span className="text-muted-foreground text-xs">
                            —
                          </span>
                        )}
                        {tags.slice(0, 3).map((tg) => (
                          <span
                            key={tg.id}
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: `${tg.color}22`,
                              color: tg.color,
                            }}
                          >
                            {tg.name}
                          </span>
                        ))}
                        {tags.length > 3 && (
                          <span className="text-muted-foreground text-[10px]">
                            +{tags.length - 3}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <p className="text-foreground">
                        {formatDayTime(
                          d.updated_at ?? d.created_at,
                          now,
                          dayLabels,
                          locale
                        )}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {t('created', {
                          date: formatShortDate(d.created_at, locale),
                        })}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOpenDeal(d)}
                        className="border-border text-foreground hover:bg-muted bg-transparent"
                      >
                        {t('viewDetails')}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {pageCount > 1 && (
            <div className="border-border text-muted-foreground flex items-center justify-between border-t px-4 py-2 text-sm">
              <span>
                {t('pageOf', { page: currentPage, total: pageCount })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                  aria-label={t('prevPage')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={currentPage >= pageCount}
                  onClick={() => setPage(currentPage + 1)}
                  aria-label={t('nextPage')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BulkBar({
  count,
  stages,
  members,
  busy,
  confirmDelete,
  setConfirmDelete,
  onStage,
  onAssign,
  onStatus,
  onDelete,
  onClear,
}: {
  count: number;
  stages: PipelineStage[];
  members: CrmData['members'];
  busy: string | null;
  confirmDelete: boolean;
  setConfirmDelete: (v: boolean) => void;
  onStage: (id: string) => void;
  onAssign: (id: string) => void;
  onStatus: (s: DealStatus) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTranslations('Crm.list');
  return (
    <div className="border-primary/30 bg-primary/5 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
      <span className="text-foreground text-sm font-medium">
        {t('selected', { count })}
      </span>
      {busy && <Loader2 className="text-primary h-4 w-4 animate-spin" />}
      <NativeSelect
        aria-label={t('bulkStage')}
        value=""
        disabled={!!busy}
        onChange={(e) => e.target.value && onStage(e.target.value)}
        className="w-40"
      >
        <option value="">{t('bulkStage')}</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={t('bulkAssign')}
        value=""
        disabled={!!busy}
        onChange={(e) => e.target.value && onAssign(e.target.value)}
        className="w-40"
      >
        <option value="">{t('bulkAssign')}</option>
        <option value="none">{t('unassign')}</option>
        {members
          .filter((m) => m.account_role !== 'viewer')
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
      </NativeSelect>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => onStatus('won')}
        className="border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        <Check className="mr-1 h-3.5 w-3.5" />
        {t('markWon')}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={!!busy}
        onClick={() => onStatus('lost')}
        className="border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400"
      >
        <X className="mr-1 h-3.5 w-3.5" />
        {t('markLost')}
      </Button>
      {confirmDelete ? (
        <span className="flex items-center gap-1 text-sm">
          <span className="text-red-600 dark:text-red-400">
            {t('deleteConfirm', { count })}
          </span>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={onDelete}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {t('delete')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(false)}
          >
            {t('cancel')}
          </Button>
        </span>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={!!busy}
          onClick={() => setConfirmDelete(true)}
          className="text-red-600 hover:bg-red-500/10 dark:text-red-400"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {t('delete')}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={onClear}
        className="text-muted-foreground ml-auto"
      >
        {t('clearSelection')}
      </Button>
    </div>
  );
}

function SortHead({
  k,
  sort,
  onSort,
  children,
  className,
}: {
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  children: string;
  className?: string;
}) {
  return (
    <TableHead
      className={className}
      aria-sort={
        sort.key === k
          ? sort.dir === 'asc'
            ? 'ascending'
            : 'descending'
          : 'none'
      }
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium"
      >
        {children}
        {sort.key !== k ? (
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        ) : sort.dir === 'asc' ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        )}
      </button>
    </TableHead>
  );
}

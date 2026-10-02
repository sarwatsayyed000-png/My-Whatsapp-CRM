"use client"

import Link from 'next/link'
import {
  BarChart3,
  Briefcase,
  FileText,
  Radio,
  Upload,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react'
import type { ComponentType } from 'react'

import { useTranslations } from 'next-intl'

// Quick-action shortcuts. Each navigates to the page that owns the
// relevant "create" flow. We deliberately don't try to auto-open any
// modal on the target page — that'd require touching those pages,
// which is out of scope here.
interface Action {
  labelKey: string
  href: string
  icon: ComponentType<{ className?: string }>
  tint: string
}

const ACTIONS: Action[] = [
  { labelKey: 'newContact', href: '/contacts', icon: UserPlus, tint: 'text-primary' },
  { labelKey: 'newDeal', href: '/pipelines', icon: Briefcase, tint: 'text-blue-400' },
  { labelKey: 'newBroadcast', href: '/broadcasts/new', icon: Radio, tint: 'text-amber-400' },
  { labelKey: 'newAutomation', href: '/automations/new', icon: Zap, tint: 'text-primary' },
]

// Messaging-focused shortcuts shown with the analytics overview.
const SHORTCUTS: Action[] = [
  { labelKey: 'importContacts', href: '/contacts', icon: Upload, tint: 'text-blue-400' },
  { labelKey: 'newTemplate', href: '/templates', icon: FileText, tint: 'text-emerald-400' },
  { labelKey: 'buildFlow', href: '/flows', icon: Workflow, tint: 'text-violet-400' },
  { labelKey: 'viewReports', href: '/analytics', icon: BarChart3, tint: 'text-primary' },
]

export function QuickActions() {
  return <ActionGrid actions={ACTIONS} />
}

export function ShortcutActions() {
  return <ActionGrid actions={SHORTCUTS} />
}

function ActionGrid({ actions }: { actions: Action[] }) {
  const t = useTranslations('Dashboard.quickActions')

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {actions.map((a) => {
        const Icon = a.icon
        return (
          <Link
            key={a.labelKey}
            href={a.href}
            className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-border hover:bg-muted/60"
          >
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted ${a.tint}`}>
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-foreground">{t(a.labelKey as string)}</span>
          </Link>
        )
      })}
    </div>
  )
}

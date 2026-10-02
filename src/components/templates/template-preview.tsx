"use client"

import { Copy, ExternalLink, FileText, ImageIcon, Phone, Reply, Video } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { splitVariables } from '@/lib/templates/template-helpers'
import type { TemplateButton } from '@/types'

export interface TemplatePreviewData {
  header_type?: 'none' | 'text' | 'image' | 'video' | 'document'
  header_content?: string
  header_media_url?: string
  header_sample?: string
  body_text: string
  body_samples?: string[]
  footer_text?: string
  buttons?: TemplateButton[]
}

const MEDIA_LABEL_KEY = {
  image: 'media.image',
  video: 'media.video',
  document: 'media.document',
} as const

const BUTTON_ICON = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
} as const

function Rendered({ text, samples }: { text: string; samples?: string[] }) {
  return (
    <>
      {splitVariables(text, samples).map((seg, i) =>
        seg.kind === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <span
            key={i}
            className={cn(
              'rounded px-0.5',
              seg.filled ? 'bg-primary/10 text-primary' : 'bg-amber-500/15 text-amber-600',
            )}
          >
            {seg.value}
          </span>
        ),
      )}
    </>
  )
}

/**
 * Chat-bubble preview of a template as a customer would see it. Uses
 * theme tokens (muted chat backdrop, card bubble) so it follows the
 * app's light / dark mode rather than hard-coding WhatsApp's colours.
 */
export function TemplatePreview({ data, className }: { data: TemplatePreviewData; className?: string }) {
  const t = useTranslations('Templates.preview')
  const header = data.header_type ?? 'none'
  const MediaIcon = header === 'video' ? Video : header === 'document' ? FileText : ImageIcon
  const hasBody = data.body_text.trim().length > 0

  return (
    <div className={cn('rounded-xl bg-muted/60 p-4', className)} aria-label={t('ariaLabel')}>
      <div className="max-w-[320px] overflow-hidden rounded-lg rounded-tl-none bg-card text-sm text-foreground shadow-sm">
        {header === 'text' && data.header_content?.trim() && (
          <p className="px-3 pt-2.5 font-semibold">
            <Rendered text={data.header_content} samples={data.header_sample ? [data.header_sample] : []} />
          </p>
        )}
        {header !== 'none' && header !== 'text' && (
          <div className="p-1">
            {header === 'image' && data.header_media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={data.header_media_url}
                alt=""
                className="max-h-44 w-full rounded-md object-cover"
              />
            ) : (
              <div className="flex h-28 flex-col items-center justify-center gap-1 rounded-md bg-muted text-muted-foreground">
                <MediaIcon className="h-6 w-6" />
                <span className="text-xs">{t(MEDIA_LABEL_KEY[header])}</span>
              </div>
            )}
          </div>
        )}
        <div className="px-3 pt-2 pb-1.5">
          <p className="break-words whitespace-pre-wrap">
            {hasBody ? (
              <Rendered text={data.body_text} samples={data.body_samples} />
            ) : (
              <span className="text-muted-foreground italic">{t('emptyBody')}</span>
            )}
          </p>
          {data.footer_text?.trim() && (
            <p className="mt-1 text-xs text-muted-foreground">{data.footer_text}</p>
          )}
          <p className="mt-0.5 text-right text-[10px] text-muted-foreground tabular-nums">12:00</p>
        </div>
        {data.buttons && data.buttons.length > 0 && (
          <div className="divide-y divide-border border-t border-border">
            {data.buttons.map((b, i) => {
              const Icon = BUTTON_ICON[b.type]
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-sky-600"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="truncate">{b.text.trim() || t('buttonPlaceholder')}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

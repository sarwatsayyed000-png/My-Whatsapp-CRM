import { describe, expect, it } from 'vitest'
import type { MessageTemplate } from '@/types'
import {
  countByStatus,
  duplicateName,
  filterTemplates,
  splitVariables,
  statusGroup,
} from './template-helpers'

function tpl(p: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: p.name ?? 'x',
    user_id: 'u',
    name: 'x',
    category: 'Marketing',
    body_text: '',
    created_at: '2026-01-01',
    ...p,
  }
}

describe('statusGroup / countByStatus', () => {
  it('groups raw Meta statuses into tabs', () => {
    expect(statusGroup('APPROVED')).toBe('approved')
    expect(statusGroup('IN_APPEAL')).toBe('pending')
    expect(statusGroup('PAUSED')).toBe('inactive')
    expect(statusGroup('PENDING_DELETION')).toBe('inactive')
    expect(statusGroup(undefined)).toBe('draft')
  })

  it('counts every template once plus the total', () => {
    expect(
      countByStatus([
        { status: 'APPROVED' },
        { status: 'APPROVED' },
        { status: 'PENDING' },
        { status: 'DISABLED' },
        {},
      ]),
    ).toEqual({ all: 5, approved: 2, pending: 1, rejected: 0, draft: 1, inactive: 1 })
  })
})

describe('filterTemplates', () => {
  const list = [
    tpl({ name: 'welcome_offer', status: 'APPROVED', body_text: 'Hi {{1}}, enjoy 10% off' }),
    tpl({ name: 'order_update', status: 'PENDING', category: 'Utility', body_text: 'Your order shipped' }),
    tpl({ name: 'old_promo', status: 'REJECTED', footer_text: 'Reply STOP to opt out' }),
  ]

  it('filters by status tab and category', () => {
    expect(filterTemplates(list, { query: '', status: 'approved', category: 'all' }).map((t) => t.name)).toEqual(['welcome_offer'])
    expect(filterTemplates(list, { query: '', status: 'all', category: 'Utility' }).map((t) => t.name)).toEqual(['order_update'])
  })

  it('searches name, body and footer case-insensitively', () => {
    expect(filterTemplates(list, { query: 'ORDER', status: 'all', category: 'all' }).map((t) => t.name)).toEqual(['order_update'])
    expect(filterTemplates(list, { query: '10% off', status: 'all', category: 'all' })).toHaveLength(1)
    expect(filterTemplates(list, { query: 'stop', status: 'all', category: 'all' }).map((t) => t.name)).toEqual(['old_promo'])
    expect(filterTemplates(list, { query: '  ', status: 'all', category: 'all' })).toHaveLength(3)
  })
})

describe('duplicateName', () => {
  it('appends _copy and counts up on collisions', () => {
    expect(duplicateName('promo', [])).toBe('promo_copy')
    expect(duplicateName('promo', ['promo_copy'])).toBe('promo_copy_2')
    expect(duplicateName('promo', ['promo_copy', 'promo_copy_2'])).toBe('promo_copy_3')
  })
  it('does not stack suffixes when copying a copy', () => {
    expect(duplicateName('promo_copy', ['promo_copy'])).toBe('promo_copy_2')
    expect(duplicateName('promo_copy_2', ['promo_copy', 'promo_copy_2'])).toBe('promo_copy_3')
  })
  it('stays within Meta’s 512-character limit', () => {
    const long = 'a'.repeat(512)
    const out = duplicateName(long, [])
    expect(out).toHaveLength(512)
    expect(out.endsWith('_copy')).toBe(true)
  })
})

describe('splitVariables', () => {
  it('substitutes samples and keeps unfilled placeholders', () => {
    expect(splitVariables('Hi {{1}}, code {{2}}!', ['Asha', ' '])).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'var', index: 1, value: 'Asha', filled: true },
      { kind: 'text', value: ', code ' },
      { kind: 'var', index: 2, value: '{{2}}', filled: false },
      { kind: 'text', value: '!' },
    ])
  })
  it('handles text without variables and spaced braces', () => {
    expect(splitVariables('Plain')).toEqual([{ kind: 'text', value: 'Plain' }])
    expect(splitVariables('{{ 1 }}', ['x'])).toEqual([{ kind: 'var', index: 1, value: 'x', filled: true }])
  })
})

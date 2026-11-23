import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'

/**
 * Composable table parts: the single source of the table look. `Table` (the
 * columns API) renders with these, and hand-written tables use them directly
 * when they need markup the columns API cannot express (footers, colSpan,
 * inputs inside cells).
 *
 * No 'use client': they hold no state, so server pages can use them too.
 */

export type CellAlign = 'left' | 'center' | 'right'

const ALIGN_CLASS: Record<CellAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

// Classes are appended without a merge helper, so two padding utilities on
// one cell would race on stylesheet order. A cell that brings its own padding
// (compact tables, footer rows) therefore drops the default one entirely.
const PADDING_RE = /(^|\s)!?p[xytrbl]?-/

function withDefaultPadding(className: string, padding: string): string {
  return PADDING_RE.test(className) ? className : `${padding} ${className}`.trim()
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join(' ')
}

export function TableFrame({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={join(
        'overflow-x-auto rounded-lg border border-line-2 bg-panel',
        className,
      )}
      {...rest}
    />
  )
}

export function DataTable({ className = '', ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={join('w-full border-collapse text-[13.5px] text-text tabular-nums', className)}
      {...rest}
    />
  )
}

export interface THeadProps extends HTMLAttributes<HTMLTableSectionElement> {
  /** Extra classes for the single header row. */
  rowClassName?: string
}

/** Renders `<thead>` plus its one header row; children are `Th` cells. */
export function THead({ className = '', rowClassName = '', children, ...rest }: THeadProps) {
  return (
    <thead className={className || undefined} {...rest}>
      <tr className={join('border-b border-line bg-panel-2', rowClassName)}>{children}</tr>
    </thead>
  )
}

export function TBody({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className || undefined} {...rest} />
}

export function TFoot({ className = '', ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tfoot className={join('border-t border-line', className)} {...rest} />
}

export function Tr({ className = '', ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={join(
        'border-b border-line transition-colors last:border-b-0 hover:bg-hover',
        className,
      )}
      {...rest}
    />
  )
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: CellAlign
}

export function Th({ align = 'left', className = '', ...rest }: ThProps) {
  return (
    <th
      data-align={align}
      className={join(
        'whitespace-nowrap font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted',
        ALIGN_CLASS[align],
        withDefaultPadding(className, 'px-4 py-2.5'),
      )}
      {...rest}
    />
  )
}

export interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** Omitted: the cell inherits alignment from the row/table. */
  align?: CellAlign
}

export function Td({ align, className = '', ...rest }: TdProps) {
  return (
    <td
      data-align={align}
      className={join(
        'align-middle',
        align ? ALIGN_CLASS[align] : '',
        withDefaultPadding(className, 'px-4 py-3'),
      )}
      {...rest}
    />
  )
}

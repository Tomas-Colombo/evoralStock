import type { HTMLAttributes } from 'react'

export type CardPadding = 'none' | 'sm' | 'md' | 'lg'

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article'
  /** `none` when the caller sets its own padding (or a table/header bleeds to the edge). */
  padding?: CardPadding
}

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

/**
 * The bordered surface every panel in the app sits on. Padding is a prop,
 * not a class, because an appended `p-6` would race the default `p-4` on
 * stylesheet order: pass `padding="none"` and your own padding instead.
 */
export function Card({ as: Tag = 'div', padding = 'md', className = '', ...rest }: CardProps) {
  return (
    <Tag
      className={['rounded-lg border border-line-2 bg-card', PADDING_CLASS[padding], className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    />
  )
}

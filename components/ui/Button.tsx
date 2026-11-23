import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'neutral'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'bare'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

// Button hierarchy (tema Grafito + Lino):
//   primary  — ink block (bg-block / text-block-ink invert together between
//              themes). Everything that commits something.
//   accent   — the lino accent. Reserved for ONE action: «Nueva venta». Text on
//              it is always --accent-ink.
//   neutral  — ink on bg, the quieter commit.
//   secondary/ghost — outline and bare, for escape hatches.
//   bare     — no box, no colour and no size padding: inline text actions
//              (underlined links, «Quitar») whose look the caller supplies.
//              Without a class-merge helper an appended colour or padding
//              would race the variant's, so this variant sets neither.
//   danger   — the alert channel. --alerta-ink is a DARK red in light mode and
//              a LIGHT one in dark mode, so the readable text flips with it:
//              that is what --alerta-on carries.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-block text-block-ink font-bold hover:opacity-90 focus-visible:ring-ink',
  accent: 'bg-accent text-accent-ink font-bold hover:brightness-95 focus-visible:ring-ink',
  neutral: 'bg-ink text-bg hover:opacity-90 focus-visible:ring-ink',
  secondary: 'border border-control-line bg-transparent text-muted hover:bg-hover hover:text-ink focus-visible:ring-ink',
  ghost: 'text-ink hover:bg-hover focus-visible:ring-ink',
  danger: 'bg-alerta-ink text-alerta-on hover:opacity-90 focus-visible:ring-alerta-ink',
  bare: 'focus-visible:ring-ink',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'text-xs px-3 py-1.5',
  md: 'text-[13.5px] px-5 py-2.5',
  lg: 'text-base px-6 py-3',
}

/**
 * Base button primitive (REQ-DS-05 keyboard-first + focus ring).
 * `type="button"` by default — callers pass `type="submit"` explicitly
 * to opt into form submission (avoids the classic "unexpected submit"
 * bug when a button sits inside a `<form>`).
 */
export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      data-variant={variant}
      data-size={size}
      className={`inline-flex select-none items-center justify-center gap-2 rounded-md font-medium transition-[background-color,border-color,color,opacity,transform] duration-150 focus:outline-none focus-visible:ring-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 ${VARIANT_CLASS[variant]} ${variant === 'bare' ? '' : SIZE_CLASS[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

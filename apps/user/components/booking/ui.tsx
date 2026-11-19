/**
 * Tailwind building blocks for the booking sheet (user app has no `.btn-*`
 * layer yet — see apps/user/UI.md). Dark tone is the app's `brand-ink`.
 */

export const BTN_PRIMARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-ink px-5 text-sm font-semibold text-white ' +
  'transition-colors hover:bg-brand-ink-hover active:bg-brand-ink-hover ' +
  // A disabled primary is a light ink wash, not a faded dark button (which reads muddy on cream).
  'disabled:cursor-not-allowed disabled:bg-brand-ink/10 disabled:text-brand-ink/35 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'

export const BTN_SECONDARY =
  'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-brand-ink/15 bg-white px-5 text-sm font-semibold text-brand-ink ' +
  'transition-colors hover:border-brand-ink/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'

export const BTN_GHOST =
  'inline-flex items-center gap-1 text-sm font-medium text-brand-ink/70 transition-colors hover:text-brand-ink ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink rounded'

/** 16px text: anything smaller makes iOS Safari zoom the page on focus. */
export const INPUT =
  'h-12 w-full rounded-xl border bg-white px-3.5 text-base text-brand-ink placeholder:text-brand-ink/40 ' +
  'focus:outline-none focus:ring-2 focus:ring-brand-ink/25'

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

'use client'

/**
 * Accessible Tailwind switch — the deliberate replacement for MUI `Switch`
 * referenced in .claude/rules/ui.md. `role="switch"` + `aria-checked`;
 * keyboard-operable as a native button. Track turns near-black (the `accent`)
 * when on.
 */
export function Toggle({
  checked,
  onChange,
  size = 'md',
  ariaLabel,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  size?: 'sm' | 'md'
  ariaLabel?: string
  disabled?: boolean
}) {
  const dims =
    size === 'sm'
      ? { track: 'h-4 w-7', thumb: 'h-3 w-3', on: 'translate-x-3.5', off: 'translate-x-0.5' }
      : { track: 'h-5 w-9', thumb: 'h-4 w-4', on: 'translate-x-4', off: 'translate-x-0.5' }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${dims.track} ${
        checked ? 'bg-gray-900' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block transform rounded-full bg-white shadow-sm transition-transform ${dims.thumb} ${
          checked ? dims.on : dims.off
        }`}
      />
    </button>
  )
}

interface SignInDividerProps {
  label?: string
  theme?: 'light' | 'dark'
}

export function SignInDivider({ label = 'or sign in with email', theme = 'light' }: SignInDividerProps) {
  const isDark = theme === 'dark'
  const lineClass = isDark ? 'bg-gray-800' : 'bg-gray-200'
  const textClass = isDark ? 'text-gray-600' : 'text-gray-400'

  return (
    <div className="flex items-center gap-3">
      <div className={`flex-1 h-px ${lineClass}`} />
      <span className={`text-xs whitespace-nowrap ${textClass}`}>{label}</span>
      <div className={`flex-1 h-px ${lineClass}`} />
    </div>
  )
}

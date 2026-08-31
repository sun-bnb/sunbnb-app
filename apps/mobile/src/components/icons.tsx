/**
 * Stroke-icon set for the floor app — 24-grid, 1.8 stroke, round caps, drawn
 * to match the approved mockups' icon language. Always SVG, never emoji.
 */
import Svg, { Circle, Path, Rect } from 'react-native-svg'

type IconProps = { size?: number; color?: string; strokeWidth?: number }

export function CalendarIcon({ size = 20, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={2} />
      <Path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </Svg>
  )
}

export function BlockIcon({ size = 20, color = '#4b5563', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Circle cx={12} cy={12} r={8.5} />
      <Path d="M6.3 17.7 17.7 6.3" />
    </Svg>
  )
}

export function StarIcon({ size = 20, color = '#0284c7', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round">
      <Path d="M12 3.5l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" />
    </Svg>
  )
}

export function BanknoteIcon({ size = 20, color = '#ffffff', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Rect x={2.5} y={6.5} width={19} height={11} rx={2} />
      <Circle cx={12} cy={12} r={2.5} />
    </Svg>
  )
}

export function QrIcon({ size = 20, color = '#ffffff', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}>
      <Rect x={3} y={3} width={7} height={7} rx={1} />
      <Rect x={14} y={3} width={7} height={7} rx={1} />
      <Rect x={3} y={14} width={7} height={7} rx={1} />
      <Path d="M14 14h3v3h-3z" />
      <Path d="M20 14v3" />
      <Path d="M14 20h3" />
      <Path d="M19 19h2v2h-2z" />
    </Svg>
  )
}

export function ContactlessIcon({ size = 20, color = '#ffffff', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M6 8.5a9 9 0 0 1 0 7" />
      <Path d="M9.5 6.5a12 12 0 0 1 0 11" />
      <Path d="M13 4.5a15.5 15.5 0 0 1 0 15" />
      <Path d="M16.5 2.5a19 19 0 0 1 0 19" />
    </Svg>
  )
}

export function CloseIcon({ size = 16, color = '#6b7280', strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function PersonIcon({ size = 20, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Circle cx={12} cy={8} r={4} />
      <Path d="M4.5 20.5c1.5-3.6 4.2-5 7.5-5s6 1.4 7.5 5" />
    </Svg>
  )
}

export function CheckIcon({ size = 18, color = '#16a34a', strokeWidth = 2.2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  )
}

export function MoveIcon({ size = 18, color = '#4b5563', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 7l-4 5 4 5" />
      <Path d="M16 7l4 5-4 5" />
      <Path d="M4 12h16" />
    </Svg>
  )
}

export function CardIcon({ size = 20, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round">
      <Rect x={2.5} y={5.5} width={19} height={13} rx={2} />
      <Path d="M2.5 10h19" />
      <Path d="M6.5 14.5h4" />
    </Svg>
  )
}

// ── Tab bar ────────────────────────────────────────────────────────────────

/** Sun lounger: tilted backrest + flat seat on two legs. */
export function BedsIcon({ size = 22, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 14.5h18M3 14.5l1.5-6 4 2.5M9 14.5V11M5.5 14.5V19M18.5 14.5V19M8.5 11h11.5" />
    </Svg>
  )
}

/** Surfboard (equipment rental). */
export function RentalsIcon({ size = 22, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M19.5 4.5c-4.5 0-11 4-14.5 10.5-.9 1.7-1 3.3-.5 4.5.9.5 2.5.4 4.5-.5C15.5 15.5 19.5 9 19.5 4.5Z" />
      <Path d="M8 12.5l3.5 3.5" />
    </Svg>
  )
}

/** Two people (guests). */
export function GuestsIcon({ size = 22, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20c1.2-3.3 3.6-4.8 6.5-4.8s5.3 1.5 6.5 4.8" />
      <Path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17 15.4c2 .5 3.6 1.9 4.5 4.6" />
    </Svg>
  )
}

/** Bar chart (today: summary, day close, trends). */
export function TodayIcon({ size = 22, color = '#6b7280', strokeWidth = 1.8 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 20h16M7 16.5v-5M12 16.5V7M17 16.5v-8" />
    </Svg>
  )
}

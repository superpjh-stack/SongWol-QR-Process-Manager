/**
 * 인라인 SVG 아이콘 (소수만). 전부 currentColor · 24 viewBox · stroke 기반.
 * 상태 배지·배너·버튼에서 색과 함께 "형태" 로도 의미를 전달하기 위한 것이다.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number | string }

function base({ size = '1em', ...rest }: IconProps, children: React.ReactNode) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconCheck = (p: IconProps) => base(p, <path d="M5 12.5l4.5 4.5L19 7" />)
export const IconCheckDashed = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M5 12.5l4.5 4.5L19 7" />
      <path d="M4 20h16" strokeDasharray="3 3" />
    </>,
  )
export const IconClock = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  )
export const IconPlay = (p: IconProps) => base(p, <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />)
export const IconHalf = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </>,
  )
export const IconSkip = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M5 5l9 7-9 7z" />
      <path d="M18 5v14" />
    </>,
  )
export const IconPause = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M8 5v14" />
      <path d="M16 5v14" />
    </>,
  )
export const IconX = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>,
  )
export const IconDraft = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M4 20h4l10-10-4-4L4 16z" />
      <path d="M13 7l4 4" />
    </>,
  )
export const IconTag = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M3 12V4h8l10 10-8 8z" />
      <circle cx="7.5" cy="8.5" r="1.25" fill="currentColor" stroke="none" />
    </>,
  )
export const IconBox = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M3 8l9-4 9 4v9l-9 4-9-4z" />
      <path d="M3 8l9 4 9-4" />
      <path d="M12 12v9" />
    </>,
  )
export const IconTruck = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M2 7h11v9H2z" />
      <path d="M13 10h4l3 3v3h-7" />
      <circle cx="6" cy="18" r="1.75" />
      <circle cx="17" cy="18" r="1.75" />
    </>,
  )
export const IconLock = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>,
  )
export const IconWarning = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </>,
  )
export const IconError = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6" />
      <circle cx="12" cy="16.5" r="0.9" fill="currentColor" stroke="none" />
    </>,
  )
export const IconWifiOff = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M3 3l18 18" />
      <path d="M5 10a12 12 0 0 1 4-2.5" />
      <path d="M12 6c3.4 0 6.5 1.4 8.8 3.8" />
      <path d="M8.5 13.5a6 6 0 0 1 2-1.2" />
      <path d="M15.5 13.5a6 6 0 0 0-1.5-1" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
    </>,
  )
export const IconKey = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="8" cy="14" r="4" />
      <path d="M11 11l9-9" />
      <path d="M16 6l2 2" />
      <path d="M18 4l2 2" />
    </>,
  )
export const IconBackspace = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M8 5h13v14H8l-6-7z" />
      <path d="M12 9l5 5" />
      <path d="M17 9l-5 5" />
    </>,
  )
export const IconQr = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M17 20h4M14 20h1" />
    </>,
  )
export const IconInfo = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.5" r="0.9" fill="currentColor" stroke="none" />
    </>,
  )
export const IconChevronLeft = (p: IconProps) => base(p, <path d="M15 5l-7 7 7 7" />)
export const IconChevronRight = (p: IconProps) => base(p, <path d="M9 5l7 7-7 7" />)
export const IconSortAsc = (p: IconProps) => base(p, <path d="M6 15l6-6 6 6" />)
export const IconSortDesc = (p: IconProps) => base(p, <path d="M6 9l6 6 6-6" />)
export const IconSortNone = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M7 10l5-5 5 5" opacity={0.4} />
      <path d="M7 14l5 5 5-5" opacity={0.4} />
    </>,
  )
export const IconInbox = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M3 13l2.5-8h13L21 13v6H3z" />
      <path d="M3 13h5l1.5 3h5L16 13h5" />
    </>,
  )
export const IconImage = (p: IconProps) =>
  base(
    p,
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="M21 16l-5-5-8 8" />
    </>,
  )
export const IconUser = (p: IconProps) =>
  base(
    p,
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  )
export const IconMenu = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>,
  )
export const IconRefresh = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>,
  )
/** 저장됨(오프라인 미전송) — ScanResultCard variant="saved", design-tokens.md §5.5 */
export const IconSave = (p: IconProps) =>
  base(
    p,
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8 4v6h7V4" />
      <path d="M8 21v-7h8v7" />
    </>,
  )

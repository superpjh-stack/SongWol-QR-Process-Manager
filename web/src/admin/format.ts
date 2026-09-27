/** 표기 규칙 (screens-admin §0.5). 시각은 Asia/Seoul `YYYY-MM-DD HH:mm`, 수량은 천 단위 구분 */
const TZ = 'Asia/Seoul'

function parts(iso: string): Record<string, string> | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const out: Record<string, string> = {}
  for (const p of f.formatToParts(d)) out[p.type] = p.value
  if (out.hour === '24') out.hour = '00'
  return out
}

export function formatDateTime(iso: string | null | undefined, withSeconds = false): string {
  if (!iso) return '—'
  const p = parts(iso)
  if (!p) return iso
  const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
  return withSeconds ? `${base}:${p.second}` : base
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const p = parts(iso)
  return p ? `${p.year}-${p.month}-${p.day}` : iso
}

/** 상대시간 (예: 5분 전). 단말 마지막 접속 표시용 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso
  const diff = Math.max(0, now - t)
  const m = Math.floor(diff / 60_000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

export function formatQty(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 오늘 일자 YYMMDD (Asia/Seoul) — 코드 체계 미리보기용 */
export function todayYymmdd(now = new Date()): string {
  const p = parts(now.toISOString())
  if (!p) return ''
  return `${p.year!.slice(2)}${p.month}${p.day}`
}

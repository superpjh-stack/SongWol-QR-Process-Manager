/** 고정폭 코드 표시 + 복사 (screens-admin §2 #16). 하위 WO 접미사(-A) 강조 */
import { useState } from 'react'
import { cn } from '@/shared/ui'

export function CodeText({ code, copy = false, className }: { code: string | null | undefined; copy?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  if (!code) return <span className="text-ink-faint">—</span>
  const m = /^(WO-\d{6}-\d{4,5})(-[A-Z])$/.exec(code)
  const body = m ? (
    <>
      {m[1]}
      <span className="font-bold text-brand-600">{m[2]}</span>
    </>
  ) : (
    code
  )
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono tabular-nums', className)}>
      <span>{body}</span>
      {copy ? (
        <button
          type="button"
          className="rounded-ad px-1 text-ad-xs text-ink-muted hover:bg-surface-3"
          onClick={async () => {
            await navigator.clipboard.writeText(code)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
          aria-label="복사"
        >
          {copied ? '복사됨' : '복사'}
        </button>
      ) : null}
    </span>
  )
}

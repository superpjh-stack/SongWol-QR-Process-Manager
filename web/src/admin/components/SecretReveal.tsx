/** 1회 표시 값 + 복사 + 「다시 볼 수 없음」 경고 (screens-admin §2 #9, ADM-07 API key) */
import { useState } from 'react'
import { Button } from '@/shared/ui/admin'
import { cn } from '@/shared/ui'

export function SecretReveal({ label, value, className }: { label: string; value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={cn('rounded-ad border border-status-warn-line bg-status-warn-bg p-3', className)}>
      <div className="mb-1 text-ad-xs font-semibold text-status-warn-fg">{label}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-ad border border-line bg-surface px-2 py-1 font-mono text-ad-body select-all">{value}</code>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? '복사됨' : '복사'}
        </Button>
      </div>
      <p className="mt-2 text-ad-xs text-status-warn-fg">이 키는 다시 볼 수 없습니다. 단말에 지금 입력하세요.</p>
    </div>
  )
}

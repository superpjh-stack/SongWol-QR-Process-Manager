/** 단일 파일 드롭존 (screens-admin §2 #7). 확장자 제한, 선택 파일명 표시 */
import { useId, useRef, useState, type DragEvent } from 'react'
import { cn } from '@/shared/ui'
import { Button } from '@/shared/ui/admin'

export function FileDropzone({ accept, file, onChange, hint, disabled }: { accept: string; file: File | null; onChange: (f: File | null) => void; hint?: string; disabled?: boolean }) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (f: File | undefined) => onChange(f ?? null)
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    pick(e.dataTransfer.files[0])
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-ad border-2 border-dashed p-6 text-center',
        over ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface',
        disabled && 'opacity-60',
      )}
    >
      <input ref={inputRef} id={id} type="file" accept={accept} className="sr-only" disabled={disabled} onChange={(e) => pick(e.target.files?.[0])} />
      {file ? (
        <div className="font-medium">
          {file.name} <span className="text-ad-xs text-ink-muted">({(file.size / 1024).toFixed(0)} KB)</span>
        </div>
      ) : (
        <div className="text-ink-muted">파일을 여기에 끌어다 놓거나 선택하세요</div>
      )}
      {hint ? <div className="text-ad-xs text-ink-muted">{hint}</div> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()} disabled={disabled}>
          파일 선택
        </Button>
        {file ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(null)} disabled={disabled}>
            제거
          </Button>
        ) : null}
      </div>
    </div>
  )
}

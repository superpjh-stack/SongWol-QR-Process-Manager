/**
 * JWT 가 필요한 이미지 (`GET /designs/{id}/thumbnail|file` — 백엔드 8feefb9, 계약 누락).
 * <img src> 는 Authorization 헤더를 못 붙이므로 fetch → blob → objectURL 로 그린다 (screens-admin §0.3 downloadBlob 와 같은 이유).
 * 실패는 alt 문구 + title 로 드러낸다 (조용한 실패 금지).
 */
import { useEffect, useState } from 'react'
import { cn } from '@/shared/ui'
import { fetchBlob, toErrorView } from '@/shared/api'

export function AuthImage({ src, alt, className, width, height }: { src: string | null | undefined; alt: string; className?: string | undefined; width?: number | undefined; height?: number | undefined }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!src) return
    let objectUrl: string | null = null
    let cancelled = false
    setErr(null)
    setUrl(null)
    fetchBlob(src)
      .then((b) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(b)
        setUrl(objectUrl)
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(toErrorView(e).message)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])
  if (!src) return null
  if (err) {
    return (
      <span role="img" aria-label={alt} title={`이미지 로드 실패 — ${err}`} className={cn('inline-flex items-center justify-center rounded-ad border border-status-error-line bg-status-error-bg text-ad-xs text-status-error-fg', className)} style={{ width, height }}>
        !
      </span>
    )
  }
  if (!url) return <span aria-hidden="true" className={cn('inline-block animate-pulse rounded-ad bg-surface-3', className)} style={{ width, height }} />
  return <img src={url} alt={alt} width={width} height={height} className={className} />
}

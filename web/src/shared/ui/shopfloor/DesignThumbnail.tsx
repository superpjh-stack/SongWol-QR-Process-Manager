/**
 * 키오스크 도안 썸네일 (F37) — `GET /designs/{id}/thumbnail` 은 단말 키(`X-Station-Key`, api-contract D49)가
 * 있어야 하는데, 평범한 `<img src>` 는 커스텀 헤더를 못 붙여 매 스캔마다 401 이 났다(progress.md F37 이
 * "S2 전 결정" 필요라고 미리 지목했던 위험 — S2 QA②에서 실제 발생 확인). 관리자 웹 `AuthImage`
 * (`web/src/admin/components/AuthImage.tsx`, JWT + fetch→blob→objectURL) 와 같은 패턴을 그대로 쓰되,
 * 자격만 단말 키로 바꾼다 — 새 fetch 로직을 만들지 않고 `fetchBlob(path, extraHeaders)` 를 재사용한다.
 * 조용한 실패 금지 — 실패하면 자리표시자 문구로 드러낸다(AuthImage 관례와 동일).
 */
import { useEffect, useState } from 'react'
import { fetchBlob, stationHeaders } from '../../api'
import { cn } from '../cn'
import { IconImage } from '../icons'

export function DesignThumbnail({ src, className }: { src: string | null | undefined; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src) return
    let objectUrl: string | null = null
    let cancelled = false
    setFailed(false)
    setUrl(null)
    fetchBlob(src, stationHeaders())
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  if (!src || failed) {
    return (
      <div className={cn('flex flex-col items-center gap-1 text-sf-body', className)}>
        <IconImage size={40} />
        <span>{failed ? '도안을 불러올 수 없습니다' : '도안 없음'}</span>
      </div>
    )
  }
  if (!url) {
    return <div aria-hidden="true" className={cn('h-full w-full animate-pulse bg-surface-3', className)} />
  }
  return <img src={url} alt="도안" className={cn('h-full w-full object-contain', className)} />
}

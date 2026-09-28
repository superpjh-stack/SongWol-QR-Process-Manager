/**
 * `/board` 착지 — 단말 키 주입(`?key=`) → 저장 → 주소창 정리 → `BoardPage` (screens-shopfloor §3 BRD-01
 * "키 주입"). 로그인 없음 — `/setup`(KSK-00)과 달리 확인 화면을 두지 않는다(TV 는 조작자가 없다,
 * 관리자가 최초 1회 이 URL 을 열어주면 그걸로 끝).
 */
import { useEffect, useState } from 'react'
import { IconKey } from '@/shared/ui/icons'
import { loadBoardKey, parseBoardKey, saveBoardKey } from './boardParams'
import { BoardPage } from './BoardPage'

export function BoardApp() {
  const [key, setKey] = useState<string | null>(() => loadBoardKey())

  useEffect(() => {
    if (key) return
    const parsed = parseBoardKey(window.location.search)
    if (!parsed) return
    saveBoardKey(parsed)
    window.history.replaceState(null, '', '/board')
    setKey(parsed)
  }, [key])

  if (!key) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-surface-2 p-10 text-center">
        <IconKey size={96} className="text-ink-faint" aria-hidden="true" />
        <h1 className="text-tv-so font-bold">현황판 단말 키가 없습니다</h1>
        <p className="max-w-xl text-tv-body text-ink-muted">
          관리자 웹에서 이 현황판을 등록하고, <code className="font-mono">/board?key=…</code> 형식의 주소로 한 번 열어주세요. 이후에는 이 브라우저에 저장된 키로 자동 접속합니다.
        </p>
      </div>
    )
  }

  return <BoardPage boardKey={key} />
}

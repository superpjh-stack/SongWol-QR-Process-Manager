import { lazy, Suspense } from 'react'
import { createBrowserRouter, Link } from 'react-router-dom'
import { Placeholder } from './Placeholder'
import { adminRoute, loginRoute } from '@/admin/routes'
import { QrLandingPage } from '@/q/QrLandingPage'
import { SetupPage } from '@/setup/SetupPage'

// dev 전용 공용 컴포넌트 갤러리 (웨이브 B 디자인). prod 번들에는 들어가지 않는다.
const DevGallery = lazy(() => import('./DevGallery'))

// 화면 그룹 (spec §9). 각 라우트 트리는 다음 웨이브에서 해당 디렉터리로 옮긴다.
export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <main className="p-6 space-y-2 text-lg">
        <h1 className="text-2xl font-bold">송월타월 QR 공정관리</h1>
        <ul className="list-disc pl-6">
          <li><Link className="underline" to="/admin">/admin 관리자 웹</Link></li>
          <li><Link className="underline" to="/kiosk">/kiosk 공정 키오스크</Link></li>
          <li><Link className="underline" to="/pda">/pda 입고·발송</Link></li>
          <li><Link className="underline" to="/board">/board 현황판</Link></li>
          <li><Link className="underline" to="/q/SAMPLE">/q/:code QR 조회</Link></li>
          <li><Link className="underline" to="/setup">/setup 단말 등록</Link></li>
        </ul>
      </main>
    ),
  },
  loginRoute,
  adminRoute,
  { path: '/kiosk/*', element: <Placeholder name="공정 키오스크" spec="§9.2" /> },
  { path: '/pda/*', element: <Placeholder name="PDA / 입고·발송" spec="§9.3" /> },
  { path: '/board/*', element: <Placeholder name="현황판" spec="§9.5" /> },
  { path: '/q/:code', element: <QrLandingPage /> },
  { path: '/setup', element: <SetupPage /> },
  ...(import.meta.env.DEV
    ? [
        {
          path: '/dev/gallery/*',
          element: (
            <Suspense fallback={null}>
              <DevGallery />
            </Suspense>
          ),
        },
      ]
    : []),
])

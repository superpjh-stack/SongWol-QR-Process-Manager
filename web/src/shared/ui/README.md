# shared/ui — 공용 컴포넌트 (웨이브 B 디자인)

| 폴더 | 대상 | 밀도 |
|---|---|---|
| `shopfloor/` | 키오스크(§9.2)·PDA(§9.3)·현황판(§9.5) | 글씨 ≥18px · 버튼 ≥64px · 키패드 72px |
| `admin/` | 관리자 웹(§9.1) | 14px · 컨트롤 36px |
| 루트 | `StatusBadge`(양쪽 공용, `density` prop) · `status.ts`(spec §2.3 상태 → 색·아이콘·문구) · `icons.tsx` · `cn.ts` | |

토큰: `src/app/tokens.css` · 문서: `{DOCS_DIR}/specs/design-tokens.md` · 데모: `/dev/gallery` (dev 전용)

규약
1. 상태는 `<StatusBadge kind= status=>` 로만 표시한다. 색·문구를 화면에서 다시 정의하지 않는다.
2. 현장 화면 루트에 `density-shopfloor`, 관리자 루트(AppLayout 이 이미 붙임)에 `density-admin`.
3. 현장 버튼은 `BigButton`, 관리자는 `admin/Button`. `<button className="...">` 을 새로 만들지 않는다.
4. 오류·오프라인·승인 필요는 `WarnBanner`(현장) / `ErrorAlert`·`useToast().error`(관리자) 로 드러낸다. 삼키지 않는다.
5. 스캐너는 `useScannerInput`, 화면 꺼짐 방지는 `useWakeLock`, 자동 로그아웃은 `useIdleLogout(IDLE_LOGOUT_MS, …)`.

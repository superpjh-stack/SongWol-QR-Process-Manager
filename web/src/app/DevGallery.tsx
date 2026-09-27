/**
 * 공용 컴포넌트 갤러리 — dev 전용 (/dev/gallery). 라우터가 import.meta.env.DEV 일 때만 등록한다.
 * API 호출 없음. 모든 데이터는 예시값이다.
 */
import { useState } from 'react'
import { useIdleLogout, useScannerInput, useWakeLock, type ScanResult } from '@/shared/hooks'
import { STEP_STATUS_VALUES, WO_STATUS_VALUES, RECEIPT_STATUS_VALUES, StatusBadge, Icons } from '@/shared/ui'
import {
  AppLayout,
  Button,
  DataTable,
  DateInput,
  EmptyState,
  ErrorAlert,
  Input,
  Modal,
  NumberInput,
  PageHeader,
  Select,
  Spinner,
  ToastProvider,
  useToast,
  type Column,
} from '@/shared/ui/admin'
import {
  BigButton,
  IdleScreen,
  NumPad,
  PinDialog,
  QueueList,
  ScanResultCard,
  WarnBanner,
  WarnBannerStack,
  type QueueItem,
  type ScanResultWo,
} from '@/shared/ui/shopfloor'

function Section({ title, children, density }: { title: string; children: React.ReactNode; density: 'shopfloor' | 'admin' }) {
  return (
    <section className={`density-${density} mb-10 rounded-ad border border-line bg-surface p-5`}>
      <h2 className="mb-4 border-b border-line pb-2 font-mono text-base font-bold text-ink-muted">{title}</h2>
      {children}
    </section>
  )
}

const WO: ScanResultWo = {
  code: 'WO-260907-0012',
  customerName: '(주)한빛유통',
  itemName: '세면타월 40수',
  spec: '40×80',
  color: '아이보리',
  qty: 500,
  printMethod: '나염+자수',
  nextProcessName: '포장',
  remainingQty: 120,
  stepStatus: 'STARTED',
  stepLabelOverride: '인쇄 중 (자수 대기)',
  woStatus: 'IN_PROGRESS',
  dueDate: '2026-10-02',
}

const QUEUE: QueueItem[] = [
  { code: 'WO-260925-0003', customerName: '동해수산', itemName: '주방타월 30수', qty: 300, dueDate: '2026-09-26', stepStatus: 'WAITING' },
  { code: 'WO-260926-0011', customerName: '(주)한빛유통', itemName: '세면타월 40수', qty: 500, dueDate: '2026-09-30', stepStatus: 'WAITING' },
  { code: 'WO-260927-0002', customerName: '청주교회', itemName: '스포츠타월', qty: 1200, dueDate: '2026-10-01', isLate: true, stepStatus: 'PARTIAL' },
  { code: 'WO-260927-0008', customerName: '한국은행 대전', itemName: '호텔타월 50수', qty: 200, dueDate: '2026-10-05' },
  { code: 'WO-260928-0001', customerName: '동해수산', itemName: '주방타월 30수', qty: 150, dueDate: '2026-10-07' },
]

type Row = { code: string; customer: string; item: string; qty: number; due: string; status: 'ISSUED' | 'IN_PROGRESS' | 'PACKED' | 'ON_HOLD' }
const ROWS: Row[] = Array.from({ length: 23 }, (_, i) => ({
  code: `WO-2609${String(20 + (i % 8)).padStart(2, '0')}-${String(i + 1).padStart(4, '0')}`,
  customer: ['(주)한빛유통', '동해수산', '청주교회', '한국은행 대전'][i % 4]!,
  item: ['세면타월 40수', '주방타월 30수', '스포츠타월', '호텔타월 50수'][i % 4]!,
  qty: (i + 1) * 50,
  due: `2026-10-${String((i % 20) + 1).padStart(2, '0')}`,
  status: (['ISSUED', 'IN_PROGRESS', 'PACKED', 'ON_HOLD'] as const)[i % 4]!,
}))
const COLS: Column<Row>[] = [
  { key: 'code', header: 'WO', sortable: true, render: (r) => <span className="font-mono">{r.code}</span> },
  { key: 'customer', header: '거래처', sortable: true },
  { key: 'item', header: '품목' },
  { key: 'qty', header: '수량', sortable: true, align: 'right' },
  { key: 'due', header: '납기', sortable: true },
  { key: 'status', header: '상태', render: (r) => <StatusBadge kind="wo" status={r.status} /> },
]

function AdminDemo() {
  const toast = useToast()
  const [modal, setModal] = useState(false)
  const [tableState, setTableState] = useState<'data' | 'loading' | 'error' | 'empty'>('data')
  return (
    <>
      <Section title="admin/PageHeader + Button" density="admin">
        <PageHeader
          title="수주 목록"
          description="spec §9.1 — 제목·설명·액션 슬롯"
          breadcrumb="수주관리 › 수주 목록"
          actions={
            <>
              <Button>엑셀 다운로드</Button>
              <Button variant="primary" onClick={() => toast.success('저장했습니다')}>
                수주 등록
              </Button>
            </>
          }
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">primary</Button>
          <Button>secondary</Button>
          <Button variant="danger">danger</Button>
          <Button variant="ghost">ghost</Button>
          <Button size="sm">sm</Button>
          <Button loading>loading</Button>
          <Button disabled>disabled</Button>
        </div>
      </Section>

      <Section title="admin/DataTable — 정렬·클라이언트 페이징(10)·빈·로딩·오류" density="admin">
        <div className="mb-3 flex gap-2">
          {(['data', 'loading', 'error', 'empty'] as const).map((s) => (
            <Button key={s} size="sm" variant={tableState === s ? 'primary' : 'secondary'} onClick={() => setTableState(s)}>
              {s}
            </Button>
          ))}
        </div>
        <DataTable
          columns={COLS}
          rows={tableState === 'empty' ? [] : ROWS}
          rowKey={(r) => r.code}
          loading={tableState === 'loading'}
          error={tableState === 'error' ? 'GET /api/v1/wo → 500 Internal Server Error' : undefined}
          onRetry={() => setTableState('data')}
          pageSize={10}
          onRowClick={(r) => toast.info(`행 클릭: ${r.code}`)}
          emptyAction={<Button variant="primary">수주 등록</Button>}
        />
      </Section>

      <Section title="admin/FormField — Input · Select · DateInput · NumberInput (+인라인 오류)" density="admin">
        <div className="grid max-w-3xl grid-cols-2 gap-4">
          <Input label="거래처명" required placeholder="(주)한빛유통" hint="IMS 상호와 동일하게" />
          <Input label="거래처 코드" required defaultValue="C-00" error="코드는 C-NNNN 형식이어야 합니다" />
          <Select label="가공방식" required placeholder="선택" options={[{ value: 'PRINT', label: '나염' }, { value: 'TRANSFER', label: '전사' }, { value: 'DTF', label: 'DTF' }, { value: 'EMB', label: '자수' }]} />
          <DateInput label="납기" required defaultValue="2026-10-02" />
          <NumberInput label="수량" required unit="장" defaultValue={500} min={1} />
          <NumberInput label="허용오차" unit="%" defaultValue={3} hint="품목별, 기본 ±3% (B4-02)" />
          <Input label="비활성" disabled defaultValue="수정 불가" />
        </div>
      </Section>

      <Section title="admin/Modal · Toast · EmptyState · Spinner · ErrorAlert" density="admin">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setModal(true)}>
            모달 열기
          </Button>
          <Button onClick={() => toast.success('스캔 취소가 기록되었습니다')}>toast.success</Button>
          <Button onClick={() => toast.error('저장 실패: 네트워크 오류 (자동으로 닫히지 않음)')}>toast.error</Button>
          <Button onClick={() => toast.warning('허용오차 초과 — 사유를 입력하세요')}>toast.warning</Button>
          <Button onClick={() => toast.info('페이지를 새로 고쳤습니다')}>toast.info</Button>
          <Spinner label="불러오는 중…" />
        </div>
        <div className="mt-4 grid max-w-3xl gap-4">
          <ErrorAlert message="POST /api/v1/scan → 503 Service Unavailable" onRetry={() => toast.info('재시도')} />
          <ErrorAlert title="검증 실패" message="필수 항목이 비어 있습니다" />
          <div className="rounded-ad border border-line">
            <EmptyState title="등록된 라우팅이 없습니다" description="가공방식별 라우팅을 먼저 등록하세요 (A1)" action={<Button variant="primary">라우팅 등록</Button>} />
          </div>
        </div>
        <Modal
          open={modal}
          title="WO 보류"
          onClose={() => setModal(false)}
          footer={
            <>
              <Button onClick={() => setModal(false)}>취소</Button>
              <Button variant="danger" onClick={() => { setModal(false); toast.success('보류 처리했습니다') }}>
                보류
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <p>
              <span className="font-mono">WO-260907-0012</span> 를 보류합니다. 사유를 입력하세요.
            </p>
            <Input label="사유" required placeholder="예: 도안 재확인 요청" />
          </div>
        </Modal>
      </Section>
    </>
  )
}

function ShopfloorDemo() {
  const [qty, setQty] = useState<string | null>(null)
  const [pin, setPin] = useState(false)
  const [pinErr, setPinErr] = useState<string | null>(null)
  const [scans, setScans] = useState<ScanResult[]>([])
  const wake = useWakeLock()
  const [idleFired, setIdleFired] = useState(0)
  useScannerInput((r) => setScans((xs) => [r, ...xs].slice(0, 5)), { enabled: !pin })
  useIdleLogout(15_000, () => setIdleFired((n) => n + 1))

  return (
    <>
      <Section title="hooks — useScannerInput · useWakeLock · useIdleLogout(15초 데모)" density="admin">
        <p className="mb-2 text-ink-muted">
          스캐너가 없으면 아무 곳에 <b>빠르게 붙여넣기 후 Enter</b> 로 흉내낼 수 있다 (예: <code>https://sw.example/q/WO-260907-0012?c=7K3F</code>, <code>US-0007</code>, <code>8801234567890</code>). 한 글자씩 치면 스캔으로 잡히지 않는다.
        </p>
        <ul className="mb-3 font-mono text-ad-xs">
          {scans.length === 0 ? <li className="text-ink-faint">(아직 스캔 없음)</li> : null}
          {scans.map((s, i) => (
            <li key={i}>{JSON.stringify(s)}</li>
          ))}
        </ul>
        <p>
          Wake Lock: {wake.supported ? (wake.active ? '활성' : `비활성${wake.error ? ` (${wake.error})` : ''}`) : '미지원 브라우저 (no-op)'} · 무동작 15초 경과 횟수: {idleFired}
        </p>
      </Section>

      <Section title="shopfloor/StatusBadge — 색+아이콘+문구 (step · wo · receipt) 두 밀도" density="shopfloor">
        <div className="mb-3 flex flex-wrap gap-3">
          {STEP_STATUS_VALUES.map((s) => (
            <StatusBadge key={s} kind="step" status={s} density="shopfloor" />
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-3">
          {WO_STATUS_VALUES.map((s) => (
            <StatusBadge key={s} kind="wo" status={s} density="shopfloor" />
          ))}
        </div>
        <div className="mb-3 flex flex-wrap gap-3">
          {RECEIPT_STATUS_VALUES.map((s) => (
            <StatusBadge key={s} kind="receipt" status={s} density="shopfloor" />
          ))}
        </div>
        <div className="density-admin flex flex-wrap gap-2">
          {STEP_STATUS_VALUES.map((s) => (
            <StatusBadge key={s} kind="step" status={s} />
          ))}
          {WO_STATUS_VALUES.map((s) => (
            <StatusBadge key={s} kind="wo" status={s} />
          ))}
        </div>
      </Section>

      <Section title="shopfloor/BigButton — primary · secondary · danger / md(64) · lg(88)" density="shopfloor">
        <div className="flex flex-wrap gap-touch-gap">
          <BigButton icon={<Icons.IconCheck size={28} />}>완료</BigButton>
          <BigButton variant="secondary" icon={<Icons.IconPlay size={28} />}>시작</BigButton>
          <BigButton variant="danger" icon={<Icons.IconX size={28} />}>취소</BigButton>
          <BigButton loading>전송 중</BigButton>
          <BigButton disabled>비활성</BigButton>
        </div>
        <div className="mt-4 flex flex-wrap gap-touch-gap">
          <BigButton size="lg" icon={<Icons.IconCheck size={36} />}>완료 (lg)</BigButton>
          <BigButton size="lg" variant="secondary">설비 선택</BigButton>
        </div>
        <BigButton fullWidth className="mt-4">
          전체 너비
        </BigButton>
      </Section>

      <Section title="shopfloor/NumPad — 기본값=투입수량(첫 입력이 대체) · 확인 결과" density="shopfloor">
        <div className="flex flex-wrap gap-8">
          <NumPad key={qty ?? 'init'} label="양품 수량" unit="장" defaultValue="500" onConfirm={setQty} />
          <div className="text-sf-lg">확인된 값: <strong className="font-mono">{qty ?? '—'}</strong></div>
        </div>
      </Section>

      <Section title="shopfloor/ScanResultCard — WO 요약 + 다음 공정·잔량 + 액션 슬롯" density="shopfloor">
        <div className="grid gap-6 xl:grid-cols-2">
          <ScanResultCard wo={WO}>
            <BigButton size="lg" icon={<Icons.IconCheck size={36} />}>완료</BigButton>
            <BigButton size="lg" variant="secondary">설비: 자수기 2호</BigButton>
          </ScanResultCard>
          <ScanResultCard wo={{ ...WO, code: 'WO-260907-0012-A', designThumbUrl: undefined, stepStatus: 'WAITING', stepLabelOverride: undefined, nextProcessName: undefined, remainingQty: undefined, woStatus: 'ISSUED' }} />
        </div>
      </Section>

      <Section title="shopfloor/WarnBanner — warning · approval · offline(N건) · error" density="shopfloor">
        <WarnBannerStack className="static">
          <WarnBanner kind="warning" message="직전 공정(입고)이 완료되지 않았습니다" />
          <WarnBanner kind="approval" message="반장 승인 후 진행할 수 있습니다" action={{ label: 'PIN 입력', onClick: () => setPin(true) }} />
          <WarnBanner kind="offline" message="네트워크 끊김 — 스캔은 저장되고 복구 시 순서대로 전송됩니다" count={7} />
          <WarnBanner kind="error" message="유효하지 않은 코드입니다 (체크코드 불일치)" onDismiss={() => undefined} />
        </WarnBannerStack>
      </Section>

      <Section title="shopfloor/PinDialog — 4~6자리 · 오류 시 재입력" density="shopfloor">
        <div className="flex gap-touch-gap">
          <BigButton variant="secondary" icon={<Icons.IconKey size={28} />} onClick={() => { setPinErr(null); setPin(true) }}>
            PIN 다이얼로그 열기
          </BigButton>
        </div>
        <PinDialog
          open={pin}
          description="E1 스캔 누락 보정 — 직전 단계를 추정 완료(DONE_ESTIMATED)로 처리합니다"
          error={pinErr}
          onCancel={() => setPin(false)}
          onSubmit={(v) => {
            if (v === '1234') { setPin(false); setPinErr(null) } else setPinErr('PIN 이 올바르지 않습니다 (데모: 1234)')
          }}
        />
      </Section>

      <Section title="shopfloor/QueueList — 납기순 · 지연 강조 · 상위 8건 (today=2026-09-28)" density="shopfloor">
        <div className="max-w-3xl">
          <QueueList items={QUEUE} today="2026-09-28" onSelect={() => undefined} />
          <h3 className="mt-6 mb-2 text-ink-muted">빈 상태</h3>
          <QueueList items={[]} />
        </div>
      </Section>

      <Section title="shopfloor/IdleScreen — 대기 화면 (배너·대기열 슬롯 포함)" density="shopfloor">
        <div className="overflow-hidden rounded-sf border-2 border-line">
          <IdleScreen
            processName="P30 인쇄"
            stationId="K-P30-1"
            workerName="김현장"
            pendingCount={3}
            banner={
              <WarnBannerStack>
                <WarnBanner kind="offline" message="네트워크 끊김" count={3} />
              </WarnBannerStack>
            }
            queue={<QueueList items={QUEUE} today="2026-09-28" onSelect={() => undefined} />}
            actions={<BigButton variant="secondary" className="min-h-touch-min px-5 text-sf-body">로그아웃</BigButton>}
            className="min-h-0"
          />
        </div>
        <div className="mt-6 overflow-hidden rounded-sf border-2 border-line">
          <IdleScreen processName="P50 포장" stationId="K-P50-1" queue={<QueueList items={[]} />} className="min-h-0" />
        </div>
      </Section>
    </>
  )
}

function LayoutDemo() {
  return (
    <Section title="admin/AppLayout — 사이드바 + 콘텐츠 (축소 프레임)" density="admin">
      <div className="h-[420px] overflow-hidden rounded-ad border border-line">
        <AppLayout
          nav={[
            { items: [{ to: '/dev/gallery', label: '대시보드', end: true, icon: <Icons.IconInfo size={16} /> }] },
            { label: '수주', items: [{ to: '/dev/gallery/so', label: '수주 목록' }, { to: '/dev/gallery/wo', label: 'WO 목록' }] },
            { label: '기준정보', items: [{ to: '/dev/gallery/customer', label: '거래처' }, { to: '/dev/gallery/item', label: '품목' }] },
          ]}
          user={
            <div className="flex items-center justify-between text-ad-xs">
              <span>
                <b>홍관리</b> · MANAGER
              </span>
              <Button size="sm" variant="ghost" className="text-white/80">
                로그아웃
              </Button>
            </div>
          }
        >
          <PageHeader title="대시보드" actions={<Button variant="primary">새로 고침</Button>} />
          <EmptyState title="콘텐츠 영역" description="화면은 개발 웨이브가 만든다" />
        </AppLayout>
      </div>
    </Section>
  )
}

export default function DevGallery() {
  return (
    <ToastProvider>
      <div className="density-admin mx-auto max-w-7xl p-6">
        <h1 className="mb-1 text-2xl font-bold">공용 컴포넌트 갤러리</h1>
        <p className="mb-8 text-ink-muted">
          dev 전용. 토큰 <code>src/app/tokens.css</code> · 문서 <code>specs/design-tokens.md</code> · 컴포넌트 <code>src/shared/ui/*</code> · 훅 <code>src/shared/hooks/*</code>
        </p>
        <ShopfloorDemo />
        <AdminDemo />
        <LayoutDemo />
      </div>
    </ToastProvider>
  )
}

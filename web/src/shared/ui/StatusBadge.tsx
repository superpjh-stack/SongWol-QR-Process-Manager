/**
 * 상태 배지. 색 + 아이콘 + 문구를 항상 함께 보여준다 (색만으로 구분 금지, plan §5.2).
 * 현장(shopfloor)·관리자(admin) 두 밀도를 `density` 로 공유한다.
 */
import { cn } from './cn'
import {
  ACTIVE_STATUS,
  APPROVAL_STATUS,
  DELAY_RISK,
  INSPECTION_STATUS,
  LOT_STATUS,
  MIGRATION_SOURCE,
  MIGRATION_STATUS,
  RECEIPT_STATUS,
  ROLE_STATUS,
  SCAN_RESULT,
  SHIPMENT_STATUS,
  SO_STATUS,
  STEP_STATUS,
  TONE_CLASS,
  WO_STATUS,
  type ApprovalStatus,
  type Inspection,
  type LotStatus,
  type MigrationStatus,
  type ReceiptStatus,
  type Role,
  type ScanResult,
  type ShipmentStatus,
  type SoStatus,
  type StatusMeta,
  type StepStatus,
  type StockSource,
  type WoStatus,
} from './status'

export type Density = 'shopfloor' | 'admin'

export type StatusBadgeProps = (
  | { kind: 'step'; status: StepStatus }
  | { kind: 'wo'; status: WoStatus }
  | { kind: 'receipt'; status: ReceiptStatus }
  | { kind: 'active'; status: boolean }
  | { kind: 'migration'; status: MigrationStatus }
  | { kind: 'source'; status: StockSource }
  | { kind: 'role'; status: Role }
  | { kind: 'so'; status: SoStatus }
  | { kind: 'scanResult'; status: ScanResult }
  | { kind: 'approval'; status: ApprovalStatus }
  | { kind: 'lot'; status: LotStatus }
  | { kind: 'delay'; status: true }
  | { kind: 'inspection'; status: Inspection }
  | { kind: 'shipment'; status: ShipmentStatus }
) & {
  /** 기본 'admin' */
  density?: Density | undefined
  className?: string | undefined
  /** 문구를 바꿔야 할 때 (예: "인쇄 중 (자수 대기)" spec §4.4). 아이콘·색은 상태를 따른다 */
  labelOverride?: string | undefined
}

function metaOf(p: StatusBadgeProps): StatusMeta {
  switch (p.kind) {
    case 'step':
      return STEP_STATUS[p.status]
    case 'wo':
      return WO_STATUS[p.status]
    case 'receipt':
      return RECEIPT_STATUS[p.status]
    case 'active':
      return ACTIVE_STATUS[p.status ? 'true' : 'false']
    case 'migration':
      return MIGRATION_STATUS[p.status]
    case 'source':
      return MIGRATION_SOURCE[p.status]
    case 'role':
      return ROLE_STATUS[p.status]
    case 'so':
      return SO_STATUS[p.status]
    case 'scanResult':
      return SCAN_RESULT[p.status]
    case 'approval':
      return APPROVAL_STATUS[p.status]
    case 'lot':
      return LOT_STATUS[p.status]
    case 'delay':
      return DELAY_RISK
    case 'inspection':
      return INSPECTION_STATUS[p.status]
    case 'shipment':
      return SHIPMENT_STATUS[p.status]
  }
}

export function StatusBadge(props: StatusBadgeProps) {
  const { density = 'admin', className, labelOverride } = props
  const meta = metaOf(props)
  const label = labelOverride ?? meta.label
  const sf = density === 'shopfloor'
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border font-semibold',
        sf ? 'h-10 gap-2 px-4 text-sf-body' : 'h-6 gap-1 px-2 text-ad-xs',
        TONE_CLASS[meta.tone],
        className,
      )}
      data-status={String(props.status)}
      data-kind={props.kind}
    >
      <meta.Icon size={sf ? 22 : 14} />
      <span>{label}</span>
    </span>
  )
}

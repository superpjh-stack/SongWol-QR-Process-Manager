/**
 * enum → 한국어 표시명 (ts-types §2 「백엔드는 표시명을 내려주지 않는다」).
 * 출처: spec §3 역할명 · spec §9 화면명 · screens-admin.md 각 절. spec 에 문구가 없는 것은 ※ 기본값(PM 확정 대상).
 */
import type {
  AllowedAction,
  ApprovalStatus,
  EquipType,
  ImportEntity,
  LabelType,
  LotStatus,
  MigrationSource,
  MigrationStatus,
  PrintMethodCode,
  RequiredInput,
  Role,
  ScanAction,
  ScanResult,
  SoStatus,
  StationType,
  TargetType,
  VarianceReasonCode,
} from './types'

/** spec §3 */
export const RoleLabel: Record<Role, string> = {
  ADMIN: '시스템 관리자',
  MANAGER: '생산관리(반장)',
  SALES: '영업/수주',
  WORKER: '현장 작업자',
  VIEWER: '경영진',
}

/** spec §9.2·§9.3·§9.5 화면명 · db §12-7 (BOARD·ADMIN) */
export const StationTypeLabel: Record<StationType, string> = {
  KIOSK: '키오스크',
  PDA: 'PDA',
  TOUCHPC: '터치PC',
  BOARD: '현황판',
  ADMIN: '관리자',
}

/** spec A1-05 「나염기·전사기·DTF 프린터·자수기」 */
export const EquipTypeLabel: Record<EquipType, string> = {
  PRINT: '나염기',
  TRANSFER: '전사기',
  DTF: 'DTF 프린터',
  EMB: '자수기',
}

/** db-schema §10 시드 명 (화면 표시는 print_method.name 우선, 이 표는 셀렉트 보조) */
export const PrintMethodCodeLabel: Record<PrintMethodCode, string> = {
  SCREEN: '나염',
  TRANSFER: '전사(승화)',
  DTF: 'DTF',
  EMB: '자수',
  PRINT_EMB: '인쇄+자수',
  NONE: '무가공',
}

/** screens-admin ADM-11 ① */
export const ImportEntityLabel: Record<ImportEntity, string> = {
  customer: '거래처',
  item: '품목',
  stock: '기초재고',
}

/** screens-admin ADM-31 「IMS_XLS「IMS 엑셀」/ COUNT「실사」」 */
export const MigrationSourceLabel: Record<MigrationSource, string> = {
  IMS_XLS: 'IMS 엑셀',
  COUNT: '실사',
}

/** ※ 기본값 — spec 에 문구 없음 (db-schema migration_batch.status) */
export const MigrationStatusLabel: Record<MigrationStatus, string> = {
  PREVIEW: '미리보기',
  LOADED: '적재 완료',
  FAILED: '실패',
  ROLLED_BACK: '롤백',
}

/** admin #11 허용 값. ※ 표시명은 db-schema 비고 직역(기본값) */
export const RequiredInputLabel: Record<RequiredInput, string> = {
  qty: '수량',
  box_count: '박스 수',
  inspection: '검수',
  equipment: '설비',
  qty_good: '양품 수량',
  qty_bad: '불량 수량',
  qty_box: '박스 수량',
  tracking_no: '송장번호',
}

/** api-contract §13.5 ⑨ */
export const VarianceReasonLabel: Record<VarianceReasonCode, string> = {
  SHORT_INPUT: '투입 부족',
  MISCOUNT: '계수 착오',
  DEFECT_EXTRA: '불량 추가 발생',
  SPLIT_MOVED: '분할·이동',
  OTHER: '기타',
}

export const ActiveLabel = { true: '활성', false: '비활성' } as const

/** ※ 기본값 — sales_order.status (db-schema §3.1, spec §2.3 에 없음 F10) */
export const SoStatusLabel: Record<SoStatus, string> = {
  OPEN: '접수',
  IN_PROGRESS: '진행 중',
  PARTIAL_SHIPPED: '부분 발송',
  SHIPPED: '발송 완료',
  CLOSED: '종결',
  CANCELLED: '취소',
}

/** spec §6 라벨 4종 (screens-admin ADM-09) */
export const LabelTypeLabel: Record<LabelType, string> = {
  WORK_ORDER_PDF: '작업지시서 (A4)',
  WO_LABEL: 'WO 라벨 (4인치)',
  BOX_LABEL: '박스 라벨',
  WORKER_CARD: '작업자 카드',
}

/** screens-admin ADM-09 「PRODUCTION(인쇄 구역, QR 오류정정 Q) / PACKING」 */
export const PrinterPurposeLabel: Record<'PRODUCTION' | 'PACKING', string> = {
  PRODUCTION: '인쇄 구역 (오류정정 Q)',
  PACKING: '포장',
}

/** spec §4.3 액션. ※ 문구는 기본값 */
export const ScanActionLabel: Record<ScanAction, string> = {
  START: '착수',
  DONE: '완료',
  RECEIVE: '입고',
  PACK: '포장',
  SHIP: '발송',
  LOGIN: '로그인',
  CANCEL: '취소',
  REPRINT: '재출력',
  APPROVE: '승인',
  MAP: '바코드 매핑',
}

/** api-contract §3.3 */
export const ScanResultLabel: Record<ScanResult, string> = { OK: '정상', WARN: '주의', REJECT: '거부' }
export const ApprovalStatusLabel: Record<ApprovalStatus, string> = { PENDING: '승인 대기', APPROVED: '승인', DENIED: '거부' }
export const LotStatusLabel: Record<LotStatus, string> = { OK: '정상', QUARANTINE: '격리' }

/** spec §2.1 코드 접두사 */
export const TargetTypeLabel: Record<TargetType, string> = { SO: '수주', WO: '작업지시', LT: 'LOT', US: '작업자 카드', VB: '협력업체 바코드' }

/** api-contract §13.4 admin #31 (QRL-01). ※ 문구는 기본값 */
export const AllowedActionLabel: Record<AllowedAction, string> = {
  VIEW_DETAIL: '관리자 웹에서 열기',
  REPRINT: '라벨 재출력',
  HOLD: '보류',
  SPLIT: '분할',
  APPROVE_PENDING: '예외 승인',
  QUARANTINE: '격리',
  SHIP: '발송',
}

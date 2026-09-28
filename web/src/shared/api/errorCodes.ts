/**
 * 오류 코드 → 기본 문구. 원천: contracts/api-contract.md §14.2 오류 코드 전수 표 (CD-5).
 * 서버 message 가 있으면 그것을 우선하고, 없을 때 이 표를 쓴다. 새 코드는 계약 표에 먼저 추가한다.
 */
export const ERROR_CODE_MESSAGES: Readonly<Record<string, string>> = {
  // 400
  BAD_CODE_FORMAT: '유효하지 않은 코드입니다',
  BAD_CHECKCODE: '유효하지 않은 코드입니다',
  // 401
  UNAUTHENTICATED: '로그인이 필요합니다',
  TOKEN_EXPIRED: '로그인이 만료되었습니다',
  BAD_STATION_KEY: '단말 등록이 필요합니다',
  BAD_CREDENTIALS: 'ID 또는 비밀번호가 올바르지 않습니다',
  BAD_PIN: 'PIN 이 올바르지 않습니다',
  // 403
  FORBIDDEN: '접근 권한이 없습니다',
  USER_INACTIVE: '사용 중지된 계정입니다',
  STATION_INACTIVE: '사용 중지된 단말입니다',
  ROLE_NOT_ALLOWED: '이 역할은 현장 단말을 사용할 수 없습니다',
  APPROVER_ROLE: '승인 권한이 없습니다',
  // 404 — 규칙 {ENTITY}_NOT_FOUND
  CUSTOMER_NOT_FOUND: '거래처 을(를) 찾을 수 없습니다',
  ADDRESS_NOT_FOUND: '배송지 을(를) 찾을 수 없습니다',
  ITEM_NOT_FOUND: '품목 을(를) 찾을 수 없습니다',
  ITEM_GROUP_NOT_FOUND: '품목군 을(를) 찾을 수 없습니다',
  PROCESS_NOT_FOUND: '공정 을(를) 찾을 수 없습니다',
  PRINT_METHOD_NOT_FOUND: '가공방식 을(를) 찾을 수 없습니다',
  EQUIPMENT_NOT_FOUND: '설비 을(를) 찾을 수 없습니다',
  ROUTING_NOT_FOUND: '라우팅 을(를) 찾을 수 없습니다',
  STATION_NOT_FOUND: '단말 을(를) 찾을 수 없습니다',
  USER_NOT_FOUND: '사용자 을(를) 찾을 수 없습니다',
  USER_CARD_NOT_FOUND: '작업자 카드 을(를) 찾을 수 없습니다',
  PRINTER_NOT_FOUND: '프린터 을(를) 찾을 수 없습니다',
  BATCH_NOT_FOUND: '배치 을(를) 찾을 수 없습니다',
  CARRIER_NOT_FOUND: '택배사 을(를) 찾을 수 없습니다',
  LABEL_TEMPLATE_NOT_FOUND: '라벨 양식 을(를) 찾을 수 없습니다',
  SO_NOT_FOUND: '수주 을(를) 찾을 수 없습니다',
  WO_NOT_FOUND: '작업지시 을(를) 찾을 수 없습니다',
  LOT_NOT_FOUND: 'LOT 을(를) 찾을 수 없습니다',
  BOX_NOT_FOUND: '박스 을(를) 찾을 수 없습니다',
  SHIPMENT_NOT_FOUND: '출하 을(를) 찾을 수 없습니다',
  EVENT_NOT_FOUND: '이벤트 을(를) 찾을 수 없습니다',
  VENDOR_BARCODE_UNMAPPED: '매핑되지 않은 협력업체 바코드입니다',
  // 409
  DUPLICATE_CODE: '이미 사용 중인 코드입니다',
  STATE_CONFLICT: '현재 상태에서는 처리할 수 없습니다',
  DESIGN_NOT_CONFIRMED: '도안이 확정되지 않았습니다',
  WO_ALREADY_ISSUED: '이미 발행된 작업지시입니다',
  BOX_ALREADY_SHIPPED: '이미 발송된 박스입니다',
  SPLIT_LIMIT: '분할 한도를 넘었습니다',
  BOX_SO_MISMATCH: '같은 수주의 박스가 아닙니다',
  PROCESS_IN_USE: '라우팅에서 사용 중인 공정입니다',
  CARD_EXISTS: '이미 카드가 발급되어 있습니다',
  CARD_REQUIRED: '카드 발급이 필요합니다',
  PIN_NOT_SET: 'PIN 이 설정되지 않았습니다 — 관리자에게 요청하세요',
  IMPORT_HAS_ERRORS: '오류 행이 있어 적재할 수 없습니다',
  // 413
  FILE_TOO_LARGE: '파일이 너무 큽니다',
  // 422
  VALIDATION_ERROR: '입력값을 확인하세요',
  BAD_SORT: '정렬할 수 없는 항목입니다',
  BAD_REQUIRED_INPUT: '허용되지 않는 입력 항목입니다',
  BAD_CARRIER: '등록되지 않은 택배사입니다',
  WEAK_PASSWORD: '비밀번호 규칙을 확인하세요',
  READ_ONLY_FIELD: '변경할 수 없는 항목입니다',
  PREFIX_FIXED: '접두사는 변경할 수 없습니다',
  BAD_FILE_TYPE: '지원하지 않는 파일 형식입니다',
  BAD_TEMPLATE: '템플릿 양식이 아닙니다',
  TOO_MANY_ROWS: '행 수가 너무 많습니다',
  ENTITY_NOT_SUPPORTED: '지원하지 않는 대상입니다',
  EVENT_UUID_REQUIRED: '이벤트 ID 가 필요합니다',
  // 423 · 429
  LOCKED: '잠시 후 다시 시도하세요',
  PIN_LOCKED: 'PIN 이 잠겼습니다 — 잠시 후 다시 시도',
  LOGIN_LOCKED: '로그인이 잠겼습니다 — 잠시 후 다시 시도',
  // 500 (전역 예외 핸들러, 계약 §3.1 형식 — S1 QA DEF-005)
  INTERNAL_ERROR: '서버 오류 — 잠시 후 다시 시도하세요',
  // 503
  DB_UNAVAILABLE: '서비스 일시 중단',
  PRINTER_UNREACHABLE: '프린터에 연결할 수 없습니다',
  // 프론트 전용
  NETWORK_ERROR: '네트워크 연결을 확인하세요',
}

/** 429 잠금 문구: `{n}분 후 다시 시도` (Retry-After 초 → 분, 올림) */
export function lockedMessage(code: 'PIN_LOCKED' | 'LOGIN_LOCKED', retryAfterSec: number | null): string {
  const who = code === 'PIN_LOCKED' ? 'PIN 이' : '로그인이'
  if (retryAfterSec === null) return `${who} 잠겼습니다 — 잠시 후 다시 시도`
  return `${who} 잠겼습니다 — ${Math.max(1, Math.ceil(retryAfterSec / 60))}분 후 다시 시도`
}

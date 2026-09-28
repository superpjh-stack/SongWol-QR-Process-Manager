"""스캔 상태 전이 엔진 — 순수 함수 (spec §4.3 1~8단계, api-contract §5.2 · §6.2 · §13.5).

**이 모듈은 DB 를 만지지 않는다.** ``domain/scan/service.py`` 가 필요한 행을 미리 읽어
``ScanContext`` 로 조립해 넘기고, ``decide()`` 가 돌려주는 ``Decision`` 을 그대로 트랜잭션
안에서 적용한다 (engineering-metaprompt 절대 규칙: 결정 로직은 DB 없이 테이블 기반으로
테스트 가능해야 한다).

파이프라인 (spec §4.3, api-contract §5.2 표):

0. 멱등 검사 — ``service.py`` (scan_event_key). 이 모듈은 관여하지 않는다.
1. 코드 형식·체크코드 검증 (``_validate_code``) — VB 미매핑은 action=MAP 예외.
   §16.2: ``input_via=MANUAL`` 이면 체크코드 생략 허용, 그 외 생략은 422.
2. WO 조회·상태 확인 (``_validate_wo``) — ISSUED/IN_PROGRESS 가 아니면 REJECT.
   범위 밖 액션(RECEIVE·PACK·SHIP·MAP·CANCEL·REPRINT)은 1 을 통과하면 바로
   ``ACTION_NOT_YET_SUPPORTED`` 로 반려한다 — WO/라우팅 로직은 아직 없다(S3/S4 예정).
2'. 60 초 중복 (§13.5 ⑮) — START·DONE(비 PARTIAL)만 대상.
3. 라우팅에 없는 공정 → E3 보류(WARN + requires_approval).
4. 직전 단계 미완료 → E1 보류(WARN + requires_approval).
5. 액션 디스패치 — START/DONE 만 구현. DONE 은 수량 대사(E2, §6.2) 포함.
   지연 도착(§4.3 하단)은 반영 결과에 경고를 덧붙인다.

승인(§5.5) 은 ``resolve_e1_approval`` · ``dispatch_done``(사유 포함 재적용) · 라우팅 삽입은
``compute_insert_seq``/``insert_missing_step`` 이 맡는다. E6 취소 리플레이(§5.6) 의 최소
메커니즘은 ``replay_steps`` 다 — 파일럿 키오스크에는 진입점이 없다(S4 UI).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Literal

ScanResultLiteral = Literal["OK", "WARN", "REJECT"]
DecisionKind = Literal["APPLY", "REJECT", "PENDING", "NOOP", "INVALID_REQUEST"]
PendingReason = Literal["ROUTE_MISSING", "PREV_INCOMPLETE", "QTY_VARIANCE"]

# spec §2.3 wo_route_step.status
STEP_PREV_OK = frozenset({"DONE", "DONE_ESTIMATED", "SKIPPED"})
STEP_PREV_BLOCKING = frozenset({"WAITING", "STARTED"})
# spec §4.3 2: WO 조회 — 이 상태가 아니면 거부
WO_SCANNABLE = frozenset({"ISSUED", "IN_PROGRESS"})
# 지시 범위: S3/S4 예정, 업무 로직 미구현 (조용한 실패 금지 — 명확한 거부만 돌려준다)
OUT_OF_SCOPE_ACTIONS = frozenset({"RECEIVE", "PACK", "SHIP", "MAP", "CANCEL", "REPRINT"})
IN_SCOPE_ACTIONS = frozenset({"START", "DONE"})
# §13.5 ⑮: 60 초 중복 규칙 적용 대상 (DONE 은 단계가 PARTIAL 이 아닐 때만, decide() 안에서 판단)
DEDUP_ACTIONS = frozenset({"START", "DONE"})

ACTION_NOT_YET_SUPPORTED_MSG = "이 액션은 아직 지원하지 않습니다 (S3/S4 예정)"
LOGIN_REJECT_MSG = "로그인은 POST /auth/worker 를 사용하세요"


# ======================================================================
# 입력 (서비스 계층이 DB 에서 읽어 조립)
# ======================================================================
@dataclass(frozen=True, slots=True)
class StepSnapshot:
    """wo_route_step 1행의 엔진용 스냅샷."""

    seq: int
    process_code: str
    process_name: str
    status: str
    qty_in: int | None
    qty_good: int | None
    qty_bad: int | None
    tolerance_pct: Decimal


@dataclass(frozen=True, slots=True)
class ScanContext:
    action: str
    station_process_code: str | None
    target_type: str  # SO|WO|LT|US|VB (core.checkcode.classify 결과)
    check_present: bool
    check_valid: bool  # check_present 일 때만 의미
    input_via: str  # HID|CAMERA|MANUAL|URL
    vb_mapped_wo: bool  # target_type == VB 일 때만 의미: 매핑된 WO 로 해석됐는가
    wo_found: bool  # WO 컨텍스트가 해석됐는가 (직접 WO 코드 또는 VB 매핑)
    wo_status: str | None
    steps: tuple[StepSnapshot, ...] = ()  # seq 오름차순, wo_found 일 때만 의미
    equipment_code: str | None = None
    equipment_valid: bool = False  # 서비스가 존재·활성·공정 일치까지 확인한 결과
    process_requires_equipment: bool = False
    qty_good: int | None = None
    qty_bad: int | None = None
    variance_reason: str | None = None
    variance_reason_code: str | None = None
    recent_same_scan: bool = False  # 60 초 이내 동일 (wo,process,action) 반영 이벤트 존재
    late_arrival: bool = False  # scanned_at 이 WO 의 마지막 반영 이벤트보다 이전
    design_outdated: bool = False  # START 전용: P30 도안 버전 검증
    current_design_version: int | None = None


# ======================================================================
# 출력
# ======================================================================
@dataclass(frozen=True, slots=True)
class StepUpdate:
    """엔진이 지시하는 wo_route_step 변경 — 서비스가 그대로 적용한다."""

    seq: int
    status: str
    qty_good: int | None = None
    qty_bad: int | None = None
    variance_reason: str | None = None
    mark_done_at: bool = False
    mark_started_at: bool = False
    create_step_work: bool = False
    is_estimated: bool = False


@dataclass(frozen=True, slots=True)
class Decision:
    kind: DecisionKind
    result: ScanResultLiteral
    code: str | None  # REJECT 의 기계 코드 (§13.9). 그 외는 None
    message: str
    requires_approval: bool = False
    pending_reason: PendingReason | None = None
    warnings: tuple[str, ...] = ()
    step_updates: tuple[StepUpdate, ...] = ()  # kind=APPLY 일 때만 의미
    reflect: bool = True  # False = scan_event 만 기록, 상태 미반영


def _reject(code: str, message: str) -> Decision:
    return Decision(kind="REJECT", result="REJECT", code=code, message=message, reflect=False)


def _invalid(code: str, message: str) -> Decision:
    return Decision(
        kind="INVALID_REQUEST", result="REJECT", code=code, message=message, reflect=False
    )


def _pending(reason: PendingReason, message: str) -> Decision:
    return Decision(
        kind="PENDING",
        result="WARN",
        code=None,
        message=message,
        requires_approval=True,
        pending_reason=reason,
        reflect=False,
    )


# ======================================================================
# 단계 조회 헬퍼
# ======================================================================
def find_step(steps: Sequence[StepSnapshot], process_code: str) -> StepSnapshot | None:
    return next((s for s in steps if s.process_code == process_code), None)


def prev_step(steps: Sequence[StepSnapshot], seq: int) -> StepSnapshot | None:
    candidates = [s for s in steps if s.seq < seq]
    return max(candidates, key=lambda s: s.seq) if candidates else None


def next_step(steps: Sequence[StepSnapshot], seq: int) -> StepSnapshot | None:
    candidates = [s for s in steps if s.seq > seq]
    return min(candidates, key=lambda s: s.seq) if candidates else None


# ======================================================================
# 1. 코드 형식 · 체크코드 (spec §4.3-1, api-contract §5.2-1, §16.2)
# ======================================================================
def _validate_code(ctx: ScanContext) -> Decision | None:
    if ctx.target_type == "VB":
        if ctx.action != "MAP" and not ctx.vb_mapped_wo:
            return _reject("VENDOR_BARCODE_UNMAPPED", "매핑되지 않은 업체 바코드입니다")
        return None
    if ctx.check_present:
        if not ctx.check_valid:
            return _reject("BAD_CHECKCODE", "유효하지 않은 코드입니다")
        return None
    # check 없음
    if ctx.input_via == "MANUAL":
        return None  # §16.2 ②: 존재 여부는 다음 단계(WO 조회)가 확인
    return _invalid(
        "VALIDATION_ERROR", "check 가 필요합니다 (input_via=MANUAL 이 아니면 생략할 수 없습니다)"
    )


# ======================================================================
# 2. WO 조회 · 상태 (spec §4.3-2)
# ======================================================================
def _validate_wo(ctx: ScanContext) -> Decision | None:
    if ctx.target_type not in ("WO", "VB"):
        return _reject("BAD_CODE_FORMAT", "유효하지 않은 코드입니다 (작업지시 코드가 아닙니다)")
    if not ctx.wo_found:
        return _reject("WO_NOT_FOUND", "작업지시를 찾을 수 없습니다")
    if ctx.wo_status not in WO_SCANNABLE:
        return _reject("STATE_CONFLICT", f"작업지시 상태 {ctx.wo_status} — 처리할 수 없습니다")
    return None


# ======================================================================
# 5. 액션 디스패치 보조
# ======================================================================
def _check_equipment(ctx: ScanContext) -> Decision | None:
    if not ctx.process_requires_equipment:
        return None
    if not ctx.equipment_code:
        return _invalid("VALIDATION_ERROR", "equipment_code 가 필요합니다")
    if not ctx.equipment_valid:
        return _reject("EQUIPMENT_NOT_FOUND", "설비를 찾을 수 없습니다")
    return None


def _check_qty_fields(ctx: ScanContext) -> Decision | None:
    if ctx.qty_good is None or ctx.qty_bad is None:
        return _invalid("VALIDATION_ERROR", "qty_good, qty_bad 가 필요합니다")
    return None


def dispatch_start(ctx: ScanContext, cur: StepSnapshot) -> Decision:
    eq = _check_equipment(ctx)
    if eq is not None:
        return eq
    updates = (
        StepUpdate(seq=cur.seq, status="STARTED", mark_started_at=True, create_step_work=True),
    )
    if ctx.design_outdated:
        v = ctx.current_design_version
        msg = f"도안 변경됨 v{v}" if v is not None else "도안 변경됨"
        return Decision(
            kind="APPLY",
            result="WARN",
            code=None,
            message=msg,
            warnings=(msg,),
            step_updates=updates,
        )
    return Decision(
        kind="APPLY", result="OK", code=None, message="작업을 시작했습니다", step_updates=updates
    )


def dispatch_done(ctx: ScanContext, cur: StepSnapshot) -> Decision:
    """P30 완료 스캔 (spec §4.3-5 DONE, §6.2 E2). PRINT_EMB 다중 설비도 파일럿은 1회 DONE 으로
    단계를 종료한다 (spec §4.4) — 별도 분기 없음, remaining_equip_types 는 서비스가 항상 []
    로 채운다.
    """
    eq = _check_equipment(ctx)
    if eq is not None:
        return eq
    qf = _check_qty_fields(ctx)
    if qf is not None:
        return qf
    assert ctx.qty_good is not None and ctx.qty_bad is not None
    prior_good = cur.qty_good or 0
    prior_bad = cur.qty_bad or 0
    total_good = prior_good + ctx.qty_good
    total_bad = prior_bad + ctx.qty_bad
    total = total_good + total_bad
    qty_in = cur.qty_in or 0
    diff = Decimal(abs(total - qty_in))
    allowed = Decimal(qty_in) * cur.tolerance_pct / Decimal(100)

    if diff <= allowed:
        updates = (
            StepUpdate(
                seq=cur.seq,
                status="DONE",
                qty_good=total_good,
                qty_bad=total_bad,
                mark_done_at=True,
            ),
        )
        return Decision(
            kind="APPLY",
            result="OK",
            code=None,
            message=f"완료 처리했습니다 (양품 {total_good} / 불량 {total_bad})",
            step_updates=updates,
        )

    reason = ctx.variance_reason or ctx.variance_reason_code
    if not reason:
        return _pending(
            "QTY_VARIANCE",
            "수량 편차가 허용오차를 초과했습니다 — 사유 입력 또는 반장 승인이 필요합니다",
        )

    if total < qty_in:
        remain = qty_in - total
        updates = (
            StepUpdate(
                seq=cur.seq,
                status="PARTIAL",
                qty_good=total_good,
                qty_bad=total_bad,
                variance_reason=ctx.variance_reason,
            ),
        )
        return Decision(
            kind="APPLY",
            result="WARN",
            code=None,
            message=f"부분 완료 처리했습니다 (잔여 {remain})",
            warnings=("수량 편차: 미달 — 사유 기록됨",),
            step_updates=updates,
        )
    updates = (
        StepUpdate(
            seq=cur.seq,
            status="DONE",
            qty_good=total_good,
            qty_bad=total_bad,
            variance_reason=ctx.variance_reason,
            mark_done_at=True,
        ),
    )
    return Decision(
        kind="APPLY",
        result="WARN",
        code=None,
        message=f"완료(초과, 사유 기록됨) — 양품 {total_good} / 불량 {total_bad}",
        warnings=("수량 편차: 초과 — 사유 기록됨",),
        step_updates=updates,
    )


_DISPATCH = {"START": dispatch_start, "DONE": dispatch_done}


# ======================================================================
# 메인 파이프라인
# ======================================================================
def decide(ctx: ScanContext) -> Decision:
    """spec §4.3 1~8 단계를 결과로 매핑한다 (api-contract §5.2). DB 접근 없음."""
    if ctx.action == "LOGIN":
        return _reject("USE_AUTH_WORKER", LOGIN_REJECT_MSG)

    # 범위 밖 액션은 코드·체크코드 검증조차 하지 않고 바로 반려한다: 예컨대 RECEIVE 가 VB 코드를
    # 스캔했을 때 매핑 여부를 (구현되지 않은 로직으로) 판단해 VENDOR_BARCODE_UNMAPPED 를 잘못
    # 내보내는 것을 막는다 — 서비스도 이 액션들에 대해서는 VB 매핑 조회 자체를 생략한다.
    if ctx.action in OUT_OF_SCOPE_ACTIONS:
        return _reject("ACTION_NOT_YET_SUPPORTED", ACTION_NOT_YET_SUPPORTED_MSG)

    code_decision = _validate_code(ctx)
    if code_decision is not None:
        return code_decision

    if ctx.action not in IN_SCOPE_ACTIONS:
        # 방어적 분기: ScanAction 은 Literal 이라 스키마 단계에서 걸러지므로 실제로는 도달 불가.
        return _reject("ACTION_NOT_YET_SUPPORTED", ACTION_NOT_YET_SUPPORTED_MSG)

    wo_decision = _validate_wo(ctx)
    if wo_decision is not None:
        return wo_decision

    cur = find_step(ctx.steps, ctx.station_process_code or "")
    if cur is None:
        return _pending("ROUTE_MISSING", "이 작업은 이 공정을 거치지 않습니다")

    if ctx.action in DEDUP_ACTIONS and ctx.recent_same_scan and cur.status != "PARTIAL":
        return Decision(kind="NOOP", result="WARN", code=None, message="이미 처리됨", reflect=False)

    prev = prev_step(ctx.steps, cur.seq)
    if prev is not None and prev.status in STEP_PREV_BLOCKING:
        return _pending("PREV_INCOMPLETE", f"직전 공정({prev.process_name}) 미완료")

    decision = _DISPATCH[ctx.action](ctx, cur)

    if ctx.late_arrival and decision.kind == "APPLY":
        warnings = (*decision.warnings, "지연 도착 — 순서 확인")
        result: ScanResultLiteral = "WARN" if decision.result == "OK" else decision.result
        decision = replace(decision, result=result, warnings=warnings)

    return decision


# ======================================================================
# 승인(§5.5) 보조 — E1 · 라우팅 삽입(E3). E2 승인은 dispatch_done() 재사용.
# ======================================================================
def resolve_e1_approval(
    steps: Sequence[StepSnapshot], up_to_seq: int
) -> tuple[tuple[StepUpdate, ...], int | None]:
    """직전 미완료 단계를 전부 ``DONE_ESTIMATED`` 로. qty_in 은 순서대로 승계한다 (§5.2-4 승인
    효과).

    반환: (step_updates, up_to_seq 단계에 승계할 qty_in). 승계값이 없으면 None
    (호출자는 기존 qty_in 을 유지한다).
    """
    updates: list[StepUpdate] = []
    carry: int | None = None
    for s in sorted(steps, key=lambda x: x.seq):
        if s.seq >= up_to_seq:
            break
        if s.status in STEP_PREV_BLOCKING:
            qty = s.qty_in if s.qty_in is not None else carry
            updates.append(
                StepUpdate(
                    seq=s.seq,
                    status="DONE_ESTIMATED",
                    qty_good=qty,
                    qty_bad=0,
                    mark_done_at=True,
                    is_estimated=True,
                )
            )
            carry = qty
        else:
            carry = s.qty_good if s.qty_good is not None else s.qty_in
    return tuple(updates), carry


def compute_insert_seq(
    existing: Sequence[StepSnapshot], new_process_code: str, global_seq_of: Mapping[str, int]
) -> int:
    """새 공정이 라우팅 어디에 들어가야 하는지 (Process.seq 전역 순서 기준, §11-5)."""
    new_gseq = global_seq_of.get(new_process_code, 0)
    count_before = sum(1 for s in existing if global_seq_of.get(s.process_code, 0) < new_gseq)
    return count_before + 1


def insert_missing_step(
    steps: Sequence[StepSnapshot],
    *,
    new_process_code: str,
    new_process_name: str,
    tolerance_pct: Decimal,
    qty_in: int | None,
    global_seq_of: Mapping[str, int],
) -> tuple[StepSnapshot, ...]:
    """E3 승인 효과: 새 단계를 올바른 위치에 끼워 넣고 이후 단계의 seq 를 민다."""
    seq_for_new = compute_insert_seq(steps, new_process_code, global_seq_of)
    shifted = tuple((s if s.seq < seq_for_new else replace(s, seq=s.seq + 1)) for s in steps)
    new_step = StepSnapshot(
        seq=seq_for_new,
        process_code=new_process_code,
        process_name=new_process_name,
        status="WAITING",
        qty_in=qty_in,
        qty_good=None,
        qty_bad=None,
        tolerance_pct=tolerance_pct,
    )
    return tuple(sorted((*shifted, new_step), key=lambda s: s.seq))


# ======================================================================
# E6 취소 리플레이 — 최소 메커니즘 (§5.6). 파일럿은 kiosk 진입점 없음(S4 UI).
# ======================================================================
@dataclass(frozen=True, slots=True)
class AppliedEvent:
    """리플레이 입력 — scan_event 1건의 최소 정보."""

    process_code: str
    action: str
    qty_good: int | None
    qty_bad: int | None
    result: str


def replay_steps(
    initial_steps: Sequence[StepSnapshot], events: Sequence[AppliedEvent]
) -> tuple[StepSnapshot, ...]:
    """반영된(REJECT 아닌) 이벤트를 순서대로 다시 적용해 단계 상태를 재계산한다.

    파일럿(완료 스캔만)의 최소 버전: DONE 만 재생한다. START/기타 액션은 상태를 바꾸지 않는다
    (파일럿은 애초에 사용하지 않는다). 서비스가 취소 대상 이벤트를 제외한 나머지를 이 함수에
    넘긴다.
    """
    by_seq: dict[int, StepSnapshot] = {s.seq: s for s in initial_steps}
    seq_of_process = {s.process_code: s.seq for s in initial_steps}
    for ev in events:
        if ev.result == "REJECT":
            continue
        seq = seq_of_process.get(ev.process_code)
        if seq is None:
            continue
        s = by_seq[seq]
        if ev.action == "DONE" and ev.qty_good is not None and ev.qty_bad is not None:
            total_good = (s.qty_good or 0) + ev.qty_good
            total_bad = (s.qty_bad or 0) + ev.qty_bad
            qty_in = s.qty_in or 0
            diff = Decimal(abs(total_good + total_bad - qty_in))
            allowed = Decimal(qty_in) * s.tolerance_pct / Decimal(100)
            status = "DONE" if diff <= allowed else "PARTIAL"
            by_seq[seq] = replace(s, qty_good=total_good, qty_bad=total_bad, status=status)
    return tuple(sorted(by_seq.values(), key=lambda x: x.seq))

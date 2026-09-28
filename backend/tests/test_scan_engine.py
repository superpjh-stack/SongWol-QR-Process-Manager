"""``domain/scan/engine.py`` 테이블 기반 단위 테스트 (DB 없음, plan.md §6 게이트).

40+ 케이스로 순수 결정 로직의 분기를 전부 커버한다: 정상 DONE, E1(직전 미완료, 승인
전/후), E2(허용오차 초과/미달, 사유 있음/없음), 60초 중복(포함/제외 액션), 이벤트 재생
(replay_steps), 지연 도착, WO 각 종결/거부 상태, 라우팅 미등록(E3), PRINT_EMB 다중설비
단일완료, 체크코드 누락/불일치, input_via=MANUAL 우회, LOGIN 반려, 범위 밖 액션 반려.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.scan import engine


# ======================================================================
# 헬퍼
# ======================================================================
def step(
    seq: int,
    process_code: str,
    status: str,
    *,
    qty_in: int | None = None,
    qty_good: int | None = None,
    qty_bad: int | None = None,
    tolerance_pct: Decimal = Decimal("3.0"),
    process_name: str | None = None,
) -> engine.StepSnapshot:
    return engine.StepSnapshot(
        seq=seq,
        process_code=process_code,
        process_name=process_name or process_code,
        status=status,
        qty_in=qty_in,
        qty_good=qty_good,
        qty_bad=qty_bad,
        tolerance_pct=tolerance_pct,
    )


def default_steps() -> tuple[engine.StepSnapshot, ...]:
    return (
        step(
            1,
            "P20",
            "DONE",
            qty_in=500,
            qty_good=500,
            qty_bad=0,
            tolerance_pct=Decimal("0"),
            process_name="입고",
        ),
        step(2, "P30", "WAITING", qty_in=500, tolerance_pct=Decimal("3.0"), process_name="인쇄"),
        step(3, "P50", "WAITING", process_name="포장"),
        step(4, "P60", "WAITING", process_name="발송"),
    )


def ctx(**over: object) -> engine.ScanContext:
    defaults: dict[str, object] = dict(
        action="DONE",
        station_process_code="P30",
        target_type="WO",
        check_present=True,
        check_valid=True,
        input_via="HID",
        vb_mapped_wo=False,
        wo_found=True,
        wo_status="IN_PROGRESS",
        steps=default_steps(),
        equipment_code="PRT-01",
        equipment_valid=True,
        process_requires_equipment=True,
        qty_good=485,
        qty_bad=5,
        variance_reason=None,
        variance_reason_code=None,
        recent_same_scan=False,
        late_arrival=False,
        design_outdated=False,
        current_design_version=None,
    )
    defaults.update(over)
    return engine.ScanContext(**defaults)  # type: ignore[arg-type]


def steps_with(*replacements: engine.StepSnapshot) -> tuple[engine.StepSnapshot, ...]:
    """default_steps() 에서 seq 가 같은 항목을 교체."""
    by_seq = {s.seq: s for s in default_steps()}
    for r in replacements:
        by_seq[r.seq] = r
    return tuple(by_seq[k] for k in sorted(by_seq))


# ======================================================================
# 1. LOGIN 반려 · 범위 밖 액션 (§13.2 ⑤, 지시 범위 경계)
# ======================================================================
def test_login_action_rejected() -> None:
    d = engine.decide(ctx(action="LOGIN"))
    assert d.kind == "REJECT"
    assert d.result == "REJECT"
    assert d.code == "USE_AUTH_WORKER"
    assert d.reflect is False


@pytest.mark.parametrize("action", sorted(engine.OUT_OF_SCOPE_ACTIONS))
def test_out_of_scope_actions_rejected(action: str) -> None:
    d = engine.decide(ctx(action=action, wo_found=False, steps=()))
    assert d.kind == "REJECT"
    assert d.code == "ACTION_NOT_YET_SUPPORTED"
    assert d.reflect is False


def test_out_of_scope_action_skips_vb_unmapped_check() -> None:
    """RECEIVE 가 미매핑 VB 를 스캔해도 ACTION_NOT_YET_SUPPORTED 여야 한다 (VENDOR_BARCODE_UNMAPPED
    아님) — 구현 안 된 매핑 조회 결과로 오판하지 않는다."""
    d = engine.decide(
        ctx(action="RECEIVE", target_type="VB", vb_mapped_wo=False, wo_found=False, steps=())
    )
    assert d.code == "ACTION_NOT_YET_SUPPORTED"


def test_approve_action_via_scan_is_rejected_defensively() -> None:
    """action=APPROVE 는 /scan 이 아니라 /scan/{uuid}/approve 전용 — 방어적 분기."""
    d = engine.decide(ctx(action="APPROVE"))
    assert d.kind == "REJECT"
    assert d.code == "ACTION_NOT_YET_SUPPORTED"


# ======================================================================
# 2. 코드 형식 · 체크코드 (§16.2)
# ======================================================================
def test_bad_checkcode_rejected() -> None:
    d = engine.decide(ctx(check_present=True, check_valid=False))
    assert d.kind == "REJECT"
    assert d.code == "BAD_CHECKCODE"


def test_missing_checkcode_hid_is_invalid_request() -> None:
    d = engine.decide(ctx(check_present=False, input_via="HID"))
    assert d.kind == "INVALID_REQUEST"
    assert d.code == "VALIDATION_ERROR"


def test_missing_checkcode_manual_bypasses_and_proceeds() -> None:
    d = engine.decide(ctx(check_present=False, input_via="MANUAL"))
    assert d.kind == "APPLY"
    assert d.result == "OK"


def test_vb_unmapped_rejected_for_in_scope_action() -> None:
    d = engine.decide(ctx(target_type="VB", vb_mapped_wo=False, wo_found=False, steps=()))
    assert d.kind == "REJECT"
    assert d.code == "VENDOR_BARCODE_UNMAPPED"


def test_vb_mapped_proceeds_like_wo() -> None:
    d = engine.decide(ctx(target_type="VB", vb_mapped_wo=True))
    assert d.kind == "APPLY"


def test_validate_code_map_action_bypasses_vb_unmapped_directly() -> None:
    """decide() 는 MAP 을 코드 검증 전에 반려하므로, 이 예외 분기는 _validate_code 를 직접
    불러 검증한다 (미래에 MAP 구현이 이 헬퍼를 재사용할 것을 대비한 방어 분기, 화이트박스 테스트).
    """
    c = ctx(action="MAP", target_type="VB", vb_mapped_wo=False)
    assert engine._validate_code(c) is None  # noqa: SLF001


# ======================================================================
# 3. WO 조회 · 상태 (spec §4.3-2) — 각 종결/거부 상태
# ======================================================================
def test_wo_not_found_rejected() -> None:
    d = engine.decide(ctx(wo_found=False, steps=()))
    assert d.kind == "REJECT"
    assert d.code == "WO_NOT_FOUND"


@pytest.mark.parametrize("status", ["DRAFT", "ON_HOLD", "CANCELLED", "CLOSED", "PACKED", "SHIPPED"])
def test_wo_status_not_scannable_rejected(status: str) -> None:
    d = engine.decide(ctx(wo_status=status))
    assert d.kind == "REJECT"
    assert d.code == "STATE_CONFLICT"
    assert status in d.message


@pytest.mark.parametrize("status", ["ISSUED", "IN_PROGRESS"])
def test_wo_status_scannable_proceeds(status: str) -> None:
    d = engine.decide(ctx(wo_status=status))
    assert d.kind == "APPLY"


@pytest.mark.parametrize("target_type", ["SO", "LT", "US"])
def test_non_wo_target_type_rejected_for_in_scope_action(target_type: str) -> None:
    d = engine.decide(ctx(target_type=target_type, check_present=False, input_via="HID"))
    # check 가 없고 MANUAL 도 아니면 VALIDATION_ERROR 가 먼저 뜨므로 check 를 채워 통과시킨다
    d = engine.decide(ctx(target_type=target_type))
    assert d.kind == "REJECT"
    assert d.code == "BAD_CODE_FORMAT"


# ======================================================================
# 4. 라우팅에 없는 공정 (E3)
# ======================================================================
def test_route_missing_pending_approval() -> None:
    d = engine.decide(ctx(station_process_code="P40"))
    assert d.kind == "PENDING"
    assert d.result == "WARN"
    assert d.requires_approval is True
    assert d.pending_reason == "ROUTE_MISSING"


# ======================================================================
# 5. 60 초 중복 (§13.5 ⑮)
# ======================================================================
@pytest.mark.parametrize("action", ["START", "DONE"])
def test_dedup_hit_returns_noop(action: str) -> None:
    d = engine.decide(ctx(action=action, recent_same_scan=True))
    assert d.kind == "NOOP"
    assert d.result == "WARN"
    assert d.reflect is False


def test_dedup_excluded_when_step_already_partial() -> None:
    """PARTIAL 단계의 DONE 누적은 60 초 규칙 제외 (§13.5 ⑮)."""
    partial_step = step(
        2, "P30", "PARTIAL", qty_in=500, qty_good=400, qty_bad=0, process_name="인쇄"
    )
    d = engine.decide(
        ctx(steps=steps_with(partial_step), recent_same_scan=True, qty_good=90, qty_bad=10)
    )
    assert d.kind == "APPLY"  # dedup 이 아니라 정상 누적 처리로 진행


def test_dedup_not_applicable_when_no_recent_scan() -> None:
    d = engine.decide(ctx(recent_same_scan=False))
    assert d.kind == "APPLY"


# ======================================================================
# 6. 직전 단계 미완료 (E1)
# ======================================================================
@pytest.mark.parametrize("prev_status", ["WAITING", "STARTED"])
def test_prev_step_incomplete_pending(prev_status: str) -> None:
    prev = step(1, "P20", prev_status, qty_in=500, process_name="입고")
    d = engine.decide(ctx(steps=steps_with(prev)))
    assert d.kind == "PENDING"
    assert d.pending_reason == "PREV_INCOMPLETE"
    assert "입고" in d.message


@pytest.mark.parametrize("prev_status", ["DONE", "DONE_ESTIMATED", "SKIPPED"])
def test_prev_step_complete_proceeds(prev_status: str) -> None:
    prev = step(1, "P20", prev_status, qty_in=500, qty_good=500, qty_bad=0, process_name="입고")
    d = engine.decide(ctx(steps=steps_with(prev)))
    assert d.kind == "APPLY"


def test_first_step_has_no_previous() -> None:
    """seq=1 단계를 스캔하면 직전 단계가 없어 E1 이 발생하지 않는다."""
    steps = (
        step(1, "P20", "WAITING", qty_in=500, tolerance_pct=Decimal("0"), process_name="입고"),
    )
    d = engine.decide(
        ctx(
            station_process_code="P20",
            steps=steps,
            process_requires_equipment=False,
            equipment_code=None,
            equipment_valid=False,
            qty_good=500,
            qty_bad=0,
        )
    )
    assert d.kind == "APPLY"


# ======================================================================
# 7. 설비 검증 (_check_equipment)
# ======================================================================
def test_equipment_not_required_skips_check() -> None:
    d = engine.decide(
        ctx(process_requires_equipment=False, equipment_code=None, equipment_valid=False)
    )
    assert d.kind == "APPLY"


def test_equipment_required_but_missing_is_invalid_request() -> None:
    d = engine.decide(ctx(process_requires_equipment=True, equipment_code=None))
    assert d.kind == "INVALID_REQUEST"
    assert d.code == "VALIDATION_ERROR"


def test_equipment_required_but_invalid_rejected() -> None:
    d = engine.decide(
        ctx(process_requires_equipment=True, equipment_code="EQ-X", equipment_valid=False)
    )
    assert d.kind == "REJECT"
    assert d.code == "EQUIPMENT_NOT_FOUND"


def test_equipment_valid_proceeds() -> None:
    d = engine.decide(
        ctx(process_requires_equipment=True, equipment_code="PRT-01", equipment_valid=True)
    )
    assert d.kind == "APPLY"


# ======================================================================
# 8. qty 필드 검증 (DONE 전용)
# ======================================================================
@pytest.mark.parametrize("qty_good,qty_bad", [(None, 5), (485, None), (None, None)])
def test_done_missing_qty_fields_invalid(qty_good: int | None, qty_bad: int | None) -> None:
    d = engine.decide(ctx(qty_good=qty_good, qty_bad=qty_bad))
    assert d.kind == "INVALID_REQUEST"
    assert d.code == "VALIDATION_ERROR"


# ======================================================================
# 9. START 디스패치
# ======================================================================
def test_start_missing_equipment_invalid_request() -> None:
    d = engine.decide(ctx(action="START", qty_good=None, qty_bad=None, equipment_code=None))
    assert d.kind == "INVALID_REQUEST"
    assert d.code == "VALIDATION_ERROR"


def test_start_normal() -> None:
    started = step(2, "P30", "WAITING", qty_in=500, process_name="인쇄")
    d = engine.decide(ctx(action="START", steps=steps_with(started), qty_good=None, qty_bad=None))
    assert d.kind == "APPLY"
    assert d.result == "OK"
    assert d.step_updates[0].status == "STARTED"
    assert d.step_updates[0].mark_started_at is True


def test_start_design_outdated_warns_but_applies() -> None:
    d = engine.decide(
        ctx(
            action="START",
            qty_good=None,
            qty_bad=None,
            design_outdated=True,
            current_design_version=3,
        )
    )
    assert d.kind == "APPLY"
    assert d.result == "WARN"
    assert "v3" in d.message
    assert d.warnings


def test_start_design_outdated_without_version_number() -> None:
    d = engine.decide(
        ctx(
            action="START",
            qty_good=None,
            qty_bad=None,
            design_outdated=True,
            current_design_version=None,
        )
    )
    assert d.result == "WARN"
    assert "도안 변경됨" == d.message


# ======================================================================
# 10. DONE 디스패치 · 수량 대사 (E2, §6.2)
# ======================================================================
def test_done_within_tolerance_ok() -> None:
    d = engine.decide(ctx(qty_good=485, qty_bad=5))  # diff=10 <= 15 허용
    assert d.kind == "APPLY"
    assert d.result == "OK"
    assert d.step_updates[0].status == "DONE"
    assert d.step_updates[0].qty_good == 485
    assert d.step_updates[0].qty_bad == 5


def test_done_exact_tolerance_boundary_ok() -> None:
    # qty_in=500, tol=3% → 허용 15. 485+0=485, diff=15 (경계값, 포함)
    d = engine.decide(ctx(qty_good=485, qty_bad=0))
    assert d.kind == "APPLY"
    assert d.result == "OK"


def test_done_over_tolerance_without_reason_pending() -> None:
    d = engine.decide(ctx(qty_good=520, qty_bad=0))  # diff=20 > 15
    assert d.kind == "PENDING"
    assert d.pending_reason == "QTY_VARIANCE"
    assert d.requires_approval is True


def test_done_under_tolerance_with_reason_partial() -> None:
    d = engine.decide(ctx(qty_good=400, qty_bad=0, variance_reason="투입 부족"))
    assert d.kind == "APPLY"
    assert d.result == "WARN"
    assert d.step_updates[0].status == "PARTIAL"
    assert d.step_updates[0].variance_reason == "투입 부족"


def test_done_over_tolerance_with_reason_done() -> None:
    d = engine.decide(ctx(qty_good=530, qty_bad=0, variance_reason="계수 착오"))
    assert d.kind == "APPLY"
    assert d.result == "WARN"
    assert d.step_updates[0].status == "DONE"
    assert d.step_updates[0].mark_done_at is True


def test_done_over_tolerance_with_reason_code_only() -> None:
    """variance_reason 자유입력 없이 variance_reason_code 프리셋만 있어도 사유로 인정한다."""
    d = engine.decide(ctx(qty_good=520, qty_bad=0, variance_reason_code="MISCOUNT"))
    assert d.kind == "APPLY"
    assert d.result == "WARN"


def test_done_accumulates_prior_partial_quantities() -> None:
    partial_step = step(
        2, "P30", "PARTIAL", qty_in=500, qty_good=400, qty_bad=0, process_name="인쇄"
    )
    d = engine.decide(ctx(steps=steps_with(partial_step), qty_good=90, qty_bad=10))
    # 누적 400+90=490 양품, 0+10=10 불량, 합 500 == qty_in → 허용오차 이내 DONE
    assert d.kind == "APPLY"
    assert d.result == "OK"
    assert d.step_updates[0].qty_good == 490
    assert d.step_updates[0].qty_bad == 10
    assert d.step_updates[0].status == "DONE"


def test_print_emb_multi_equipment_single_completion() -> None:
    """spec §4.4: 인쇄+자수(PRINT_EMB) 도 파일럿은 완료 스캔 1회로 단계를 종료한다.

    엔진은 print_method 를 직접 알지 못하지만(서비스가 remaining_equip_types=[] 를 채운다),
    설비 하나만으로 완료 처리되는 동작 자체가 다르지 않음을 확인한다.
    """
    d = engine.decide(ctx(equipment_code="EMB-01", qty_good=485, qty_bad=5))
    assert d.kind == "APPLY"
    assert d.result == "OK"
    assert d.step_updates[0].status == "DONE"


# ======================================================================
# 11. 지연 도착 (§4.3 하단)
# ======================================================================
def test_late_arrival_upgrades_ok_to_warn() -> None:
    d = engine.decide(ctx(late_arrival=True, qty_good=485, qty_bad=5))
    assert d.kind == "APPLY"
    assert d.result == "WARN"
    assert "지연 도착 — 순서 확인" in d.warnings


def test_late_arrival_keeps_warn_when_already_warn() -> None:
    d = engine.decide(ctx(late_arrival=True, qty_good=530, qty_bad=0, variance_reason="계수 착오"))
    assert d.result == "WARN"
    assert "지연 도착 — 순서 확인" in d.warnings


def test_late_arrival_does_not_affect_non_apply_decisions() -> None:
    d = engine.decide(ctx(late_arrival=True, qty_good=520, qty_bad=0))  # E2 보류
    assert d.kind == "PENDING"
    assert "지연 도착 — 순서 확인" not in d.warnings


def test_no_late_arrival_leaves_ok_untouched() -> None:
    d = engine.decide(ctx(late_arrival=False, qty_good=485, qty_bad=5))
    assert d.result == "OK"
    assert d.warnings == ()


# ======================================================================
# 12. E1 승인 효과 (resolve_e1_approval)
# ======================================================================
def test_resolve_e1_approval_single_blocking_step() -> None:
    steps = (step(1, "P20", "WAITING", qty_in=500), step(2, "P30", "WAITING", qty_in=None))
    updates, carry = engine.resolve_e1_approval(steps, up_to_seq=2)
    assert len(updates) == 1
    assert updates[0].seq == 1
    assert updates[0].status == "DONE_ESTIMATED"
    assert updates[0].qty_good == 500
    assert updates[0].is_estimated is True
    assert carry == 500


def test_resolve_e1_approval_chain_of_two_blocking_steps() -> None:
    steps = (
        step(1, "P20", "WAITING", qty_in=500),
        step(2, "P30", "STARTED", qty_in=None),
        step(3, "P50", "WAITING", qty_in=None),
    )
    updates, carry = engine.resolve_e1_approval(steps, up_to_seq=3)
    assert [u.seq for u in updates] == [1, 2]
    assert updates[0].qty_good == 500
    assert updates[1].qty_good == 500  # carry 승계
    assert carry == 500


def test_resolve_e1_approval_carries_from_completed_step() -> None:
    """직전 미완료 단계 앞에 이미 DONE 인 단계가 있으면 그 qty_good 을 승계한다."""
    steps = (
        step(1, "P20", "DONE", qty_in=500, qty_good=480),
        step(2, "P30", "WAITING", qty_in=None),
        step(3, "P50", "WAITING", qty_in=None),
    )
    updates, carry = engine.resolve_e1_approval(steps, up_to_seq=3)
    assert len(updates) == 1
    assert updates[0].seq == 2
    assert updates[0].qty_good == 480
    assert carry == 480


def test_resolve_e1_approval_no_blocking_steps() -> None:
    steps = (step(1, "P20", "DONE", qty_in=500, qty_good=500),)
    updates, carry = engine.resolve_e1_approval(steps, up_to_seq=2)
    assert updates == ()
    assert carry == 500


# ======================================================================
# 13. 라우팅 삽입 (E3 승인, compute_insert_seq / insert_missing_step)
# ======================================================================
GLOBAL_SEQ = {"P10": 1, "P20": 2, "P30": 3, "P50": 4, "P60": 5}


def test_compute_insert_seq_at_beginning() -> None:
    existing = (step(1, "P30", "WAITING"), step(2, "P50", "WAITING"))
    assert engine.compute_insert_seq(existing, "P20", GLOBAL_SEQ) == 1


def test_compute_insert_seq_in_middle() -> None:
    existing = (step(1, "P20", "DONE"), step(2, "P50", "WAITING"))
    assert engine.compute_insert_seq(existing, "P30", GLOBAL_SEQ) == 2


def test_compute_insert_seq_at_end() -> None:
    existing = (step(1, "P20", "DONE"), step(2, "P30", "DONE"))
    assert engine.compute_insert_seq(existing, "P60", GLOBAL_SEQ) == 3


def test_insert_missing_step_shifts_later_steps() -> None:
    existing = (step(1, "P20", "DONE", qty_in=500, qty_good=500), step(2, "P50", "WAITING"))
    result = engine.insert_missing_step(
        existing,
        new_process_code="P30",
        new_process_name="인쇄",
        tolerance_pct=Decimal("3.0"),
        qty_in=500,
        global_seq_of=GLOBAL_SEQ,
    )
    by_code = {s.process_code: s for s in result}
    assert by_code["P30"].seq == 2
    assert by_code["P50"].seq == 3
    assert by_code["P20"].seq == 1
    assert len(result) == 3


# ======================================================================
# 14. E6 취소 리플레이 최소 메커니즘 (replay_steps)
# ======================================================================
def test_replay_steps_skips_rejected_events() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500),)
    events = (
        engine.AppliedEvent(
            process_code="P30", action="DONE", qty_good=100, qty_bad=0, result="REJECT"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].status == "WAITING"
    assert result[0].qty_good is None


def test_replay_steps_skips_unknown_process() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500),)
    events = (
        engine.AppliedEvent(
            process_code="P99", action="DONE", qty_good=100, qty_bad=0, result="OK"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].qty_good is None


def test_replay_steps_applies_done_within_tolerance() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500, tolerance_pct=Decimal("3.0")),)
    events = (
        engine.AppliedEvent(
            process_code="P30", action="DONE", qty_good=490, qty_bad=5, result="OK"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].status == "DONE"
    assert result[0].qty_good == 490


def test_replay_steps_applies_done_over_tolerance_as_partial() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500, tolerance_pct=Decimal("3.0")),)
    events = (
        engine.AppliedEvent(
            process_code="P30", action="DONE", qty_good=300, qty_bad=0, result="OK"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].status == "PARTIAL"


def test_replay_steps_accumulates_multiple_done_events() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500, tolerance_pct=Decimal("3.0")),)
    events = (
        engine.AppliedEvent(
            process_code="P30", action="DONE", qty_good=300, qty_bad=0, result="OK"
        ),
        engine.AppliedEvent(
            process_code="P30", action="DONE", qty_good=190, qty_bad=5, result="WARN"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].qty_good == 490
    assert result[0].qty_bad == 5
    assert result[0].status == "DONE"


def test_replay_steps_ignores_non_done_actions() -> None:
    steps = (step(1, "P30", "WAITING", qty_in=500),)
    events = (
        engine.AppliedEvent(
            process_code="P30", action="START", qty_good=None, qty_bad=None, result="OK"
        ),
    )
    result = engine.replay_steps(steps, events)
    assert result[0].status == "WAITING"


# ======================================================================
# 15. 단계 조회 헬퍼 (find_step / prev_step / next_step)
# ======================================================================
def test_find_step_found_and_not_found() -> None:
    steps = default_steps()
    assert engine.find_step(steps, "P30") is not None
    assert engine.find_step(steps, "P40") is None


def test_prev_step_found_and_not_found() -> None:
    steps = default_steps()
    assert engine.prev_step(steps, 2).process_code == "P20"
    assert engine.prev_step(steps, 1) is None


def test_next_step_found_and_not_found() -> None:
    steps = default_steps()
    assert engine.next_step(steps, 2).process_code == "P50"
    assert engine.next_step(steps, 4) is None

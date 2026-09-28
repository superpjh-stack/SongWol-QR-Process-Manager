"""스캔 서비스 — DB 접근 계층 (api-contract §5 · §6.1 · §13.5).

``domain/scan/engine.py`` 의 순수 ``decide()`` 를 감싸는 오케스트레이션:
필요한 행을 미리 읽어 ``ScanContext`` 로 조립 → ``decide()`` 호출 → 반환된 ``Decision`` 을
같은 트랜잭션 안에서 적용(단계 갱신·``step_work``·``recalc_wo``/``recalc_so``) → ``scan_event``
기록 → ``scan_event_key`` 로 멱등 보장 → ``ScanResponse`` 조립.

레이아웃은 ``domain/order`` 와 같은 분리를 따른다: 이 파일이 서비스, ``engine.py`` 가 순수
결정 로직, ``router.py`` 가 엔드포인트.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import order as O
from app.api.v1.schemas import scan as S
from app.core.checkcode import classify, verify_check
from app.core.errors import ApiError, state_conflict, validation
from app.db.models.master import AppUser, Customer, Equipment, Item, PrintMethod, Process, Station
from app.db.models.material import VendorBarcodeMap
from app.db.models.ops import AuditLog
from app.db.models.order import Design, SalesOrder, StepWork, WorkOrder, WoRouteStep
from app.db.models.scan import ScanEvent, ScanEventKey
from app.domain.auth.service import verify_pin
from app.domain.master.admin_service import user_summary
from app.domain.order import recalc
from app.domain.order.views import load_wo_views, process_names, wo_summary
from app.domain.scan import engine

DEDUP_WINDOW_SECONDS = 60
SKIP_WO_ACTIONS = frozenset({"LOGIN", "MAP"}) | engine.OUT_OF_SCOPE_ACTIONS


# ======================================================================
# 조회 헬퍼
# ======================================================================
async def _resolve_worker(session: AsyncSession, worker_card: str) -> AppUser:
    card = worker_card.strip().upper()
    user = (
        await session.execute(select(AppUser).where(AppUser.card_code == card))
    ).scalar_one_or_none()
    if user is None:
        raise ApiError(404, "USER_CARD_NOT_FOUND", f"카드 {card} 에 해당하는 사용자가 없습니다")
    if not user.active:
        raise ApiError(403, "USER_INACTIVE", "비활성 사용자입니다")
    return user


async def _find_wo_by_code(session: AsyncSession, code: str) -> WorkOrder | None:
    norm = code.strip().upper()
    return (
        await session.execute(select(WorkOrder).where(WorkOrder.code == norm))
    ).scalar_one_or_none()


async def _find_vb_map(session: AsyncSession, code: str) -> VendorBarcodeMap | None:
    return (
        (
            await session.execute(
                select(VendorBarcodeMap)
                .where(VendorBarcodeMap.vendor_barcode == code, VendorBarcodeMap.active.is_(True))
                .order_by(VendorBarcodeMap.mapped_at.desc())
            )
        )
        .scalars()
        .first()
    )


async def _find_equipment(session: AsyncSession, code: str) -> Equipment | None:
    norm = code.strip().upper()
    return (
        await session.execute(select(Equipment).where(Equipment.code == norm))
    ).scalar_one_or_none()


async def _load_steps(session: AsyncSession, wo_id: int) -> list[WoRouteStep]:
    rows = (
        await session.execute(
            select(WoRouteStep).where(WoRouteStep.wo_id == wo_id).order_by(WoRouteStep.seq)
        )
    ).scalars()
    return list(rows.all())


async def _current_design_version(session: AsyncSession, so_line_id: int) -> int | None:
    d = (
        await session.execute(
            select(Design).where(Design.so_line_id == so_line_id, Design.is_current.is_(True))
        )
    ).scalar_one_or_none()
    return d.version if d is not None else None


async def _recent_same_scan(
    session: AsyncSession, wo_id: int, process_code: str, action: str, now: datetime
) -> bool:
    window_start = now - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    stmt = (
        select(ScanEvent.event_uuid)
        .where(
            ScanEvent.wo_id == wo_id,
            ScanEvent.process_code == process_code,
            ScanEvent.action == action,
            ScanEvent.result.in_(("OK", "WARN")),
            ScanEvent.received_at >= window_start,
            ScanEvent.received_at <= now,
        )
        .limit(1)
    )
    return (await session.execute(stmt)).first() is not None


async def _late_arrival(session: AsyncSession, wo_id: int, scanned_at: datetime) -> bool:
    stmt = select(func.max(ScanEvent.scanned_at)).where(
        ScanEvent.wo_id == wo_id, ScanEvent.result.in_(("OK", "WARN"))
    )
    last = (await session.execute(stmt)).scalar_one_or_none()
    return last is not None and scanned_at < last


def _step_snapshots(
    steps: list[WoRouteStep], names: dict[str, str]
) -> tuple[engine.StepSnapshot, ...]:
    return tuple(
        engine.StepSnapshot(
            seq=s.seq,
            process_code=s.process_code,
            process_name=names.get(s.process_code, s.process_code),
            status=s.status,
            qty_in=s.qty_in,
            qty_good=s.qty_good,
            qty_bad=s.qty_bad,
            tolerance_pct=s.tolerance_pct,
        )
        for s in sorted(steps, key=lambda x: x.seq)
    )


async def _scan_wo_summary(session: AsyncSession, wo_id: int) -> S.ScanWoSummary | None:
    wo = await session.get(WorkOrder, wo_id)
    if wo is None:
        return None
    so = await session.get(SalesOrder, wo.so_id)
    item = await session.get(Item, wo.item_id)
    if so is None or item is None:
        return None
    customer = await session.get(Customer, so.customer_id)
    if customer is None:
        return None
    return S.ScanWoSummary(
        code=wo.code,
        so_code=so.code,
        customer_name=customer.name,
        item_name=item.name,
        spec=item.spec,
        color=item.color,
        print_method=wo.print_method,
        qty_ordered=wo.qty_ordered,
        qty_received=wo.qty_received,
        qty_good=wo.qty_good,
        qty_packed=wo.qty_packed,
        qty_shipped=wo.qty_shipped,
        receipt_status=wo.receipt_status,
        qty_tolerance_pct=float(item.qty_tolerance_pct),
        status=wo.status,
        current_step_seq=wo.current_step_seq,
        design_thumbnail_url=None,
        due_date=so.due_date,
    )


# ======================================================================
# 결정 적용
# ======================================================================
async def _upsert_step_work(
    session: AsyncSession,
    step: WoRouteStep,
    *,
    status: str,
    equipment_id: int | None,
    worker_id: int | None,
    now: datetime,
) -> None:
    """P30 설비별 작업 1행 (파일럿, spec §3.6/§4.4). START 는 생성, DONE/PARTIAL 은 갱신한다."""
    rows = (
        (
            await session.execute(
                select(StepWork).where(StepWork.route_step_id == step.id).order_by(StepWork.seq)
            )
        )
        .scalars()
        .all()
    )
    row = rows[-1] if rows else None
    if row is None:
        row = StepWork(
            route_step_id=step.id,
            seq=len(rows) + 1,
            equipment_id=equipment_id or step.equipment_id,
            worker_id=worker_id or step.worker_id,
        )
        session.add(row)
    if equipment_id is not None:
        row.equipment_id = equipment_id
    if worker_id is not None:
        row.worker_id = worker_id
    if status == "STARTED":
        row.started_at = now
    if status in ("DONE", "DONE_ESTIMATED", "PARTIAL"):
        row.done_at = now
        row.qty_good = step.qty_good
        row.qty_bad = step.qty_bad


def _propagate_qty_in(steps: list[WoRouteStep]) -> None:
    """shopfloor ⑧: 완료된 단계의 양품 수량을 다음 단계 qty_in 으로 (비어 있을 때만)."""
    ordered = sorted(steps, key=lambda s: s.seq)
    for s in ordered:
        if s.qty_good is not None and s.status in ("DONE", "DONE_ESTIMATED", "PARTIAL"):
            nxt = next((x for x in ordered if x.seq > s.seq), None)
            if nxt is not None and nxt.qty_in is None:
                nxt.qty_in = s.qty_good


async def _apply_updates(
    session: AsyncSession,
    steps_by_seq: dict[int, WoRouteStep],
    updates: tuple[engine.StepUpdate, ...],
    *,
    worker_id: int | None,
    equipment_id: int | None,
    approver_id: int | None,
    now: datetime,
) -> None:
    for u in updates:
        step = steps_by_seq[u.seq]
        step.status = u.status
        if u.qty_good is not None:
            step.qty_good = u.qty_good
        if u.qty_bad is not None:
            step.qty_bad = u.qty_bad
        if u.variance_reason is not None:
            step.variance_reason = u.variance_reason
        if u.mark_started_at:
            step.started_at = now
        if u.mark_done_at:
            step.done_at = now
        if equipment_id is not None:
            step.equipment_id = equipment_id
        if worker_id is not None:
            step.worker_id = worker_id
        if u.is_estimated:
            step.is_estimated = True
            step.approved_by = approver_id
        if equipment_id is not None:
            await _upsert_step_work(
                session,
                step,
                status=u.status,
                equipment_id=equipment_id,
                worker_id=worker_id,
                now=now,
            )
    await session.flush()
    _propagate_qty_in(list(steps_by_seq.values()))


def _event_payload(body: S.ScanRequest, decision: engine.Decision) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if body.extra is not None:
        payload.update(body.extra.model_dump(mode="json", exclude_none=True))
    payload["input_via"] = body.input_via
    if body.client_seq is not None:
        payload["client_seq"] = body.client_seq
    if decision.pending_reason is not None:
        payload["pending_reason"] = decision.pending_reason
    return payload


async def _build_response(
    session: AsyncSession,
    *,
    wo: WorkOrder | None,
    steps: list[WoRouteStep],
    decision: engine.Decision,
    event_uuid: uuid.UUID | None,
    duplicate: bool,
    worker: AppUser | None,
    station_process_code: str | None,
) -> S.ScanResponse:
    wo_sum = await _scan_wo_summary(session, wo.id) if wo is not None else None

    cur_orm = (
        next((s for s in steps if s.process_code == station_process_code), None)
        if wo is not None
        else None
    )
    step_out: S.ScanStep | None = None
    remaining_qty: int | None = None
    next_process: str | None = None
    if wo is not None:
        ordered = sorted(steps, key=lambda s: s.seq)
        nxt = next((s for s in ordered if s.status == "WAITING"), None)
        next_process = nxt.process_code if nxt else None
    if cur_orm is not None:
        step_out = S.ScanStep(
            process_code=cur_orm.process_code,
            status=cur_orm.status,
            qty_in=cur_orm.qty_in,
            qty_good=cur_orm.qty_good,
            qty_bad=cur_orm.qty_bad,
            tolerance_pct=float(cur_orm.tolerance_pct),
            remaining_equip_types=[],
        )
        if decision.kind == "APPLY" and cur_orm.status in ("DONE", "PARTIAL"):
            remaining_qty = max(
                (cur_orm.qty_in or 0) - ((cur_orm.qty_good or 0) + (cur_orm.qty_bad or 0)), 0
            )

    return S.ScanResponse(
        result=decision.result,
        message=decision.message,
        wo=wo_sum,
        next_process=next_process,
        remaining_qty=remaining_qty,
        requires_approval=decision.requires_approval,
        approval_token=str(event_uuid) if decision.requires_approval and event_uuid else None,
        warnings=list(decision.warnings),
        step=step_out,
        event_uuid=event_uuid,
        duplicate=duplicate,
        code=decision.code,
        worker=user_summary(worker) if worker is not None else None,
    )


def _reject_response(event_uuid: uuid.UUID | None, code: str, message: str) -> S.ScanResponse:
    return S.ScanResponse(
        result="REJECT",
        message=message,
        wo=None,
        next_process=None,
        remaining_qty=None,
        requires_approval=False,
        approval_token=None,
        warnings=[],
        step=None,
        event_uuid=event_uuid,
        duplicate=False,
        code=code,
    )


# ======================================================================
# POST /scan
# ======================================================================
async def handle_scan(
    session: AsyncSession, station: Station, body: S.ScanRequest
) -> S.ScanResponse:
    existing_key = await session.get(ScanEventKey, body.event_uuid)
    if existing_key is not None:
        data = dict(existing_key.response)
        data["duplicate"] = True
        return S.ScanResponse.model_validate(data)

    if body.station_id.strip().upper() != station.id.strip().upper():
        raise ApiError(403, "BAD_STATION_KEY", "station_id 가 단말 키와 일치하지 않습니다")
    if body.action != "LOGIN" and not body.worker_card:
        raise validation(["body", "worker_card"], "worker_card 가 필요합니다")

    worker: AppUser | None = None
    if body.worker_card:
        worker = await _resolve_worker(session, body.worker_card)

    now = datetime.now(UTC)
    target_type = classify(body.code)
    check_present = body.check is not None
    check_valid = check_present and target_type != "VB" and verify_check(body.code, body.check)

    wo: WorkOrder | None = None
    vb_mapped = False
    if body.action not in SKIP_WO_ACTIONS:
        if target_type == "WO":
            wo = await _find_wo_by_code(session, body.code)
        elif target_type == "VB":
            vb_map = await _find_vb_map(session, body.code)
            if vb_map is not None:
                vb_mapped = True
                wo = await session.get(WorkOrder, vb_map.wo_id)

    so: SalesOrder | None = None
    steps: list[WoRouteStep] = []
    names: dict[str, str] = {}
    if wo is not None:
        so = await session.get(SalesOrder, wo.so_id)
        steps = await _load_steps(session, wo.id)
        names = await process_names(session)

    equipment: Equipment | None = None
    equipment_valid = False
    if body.equipment_code:
        equipment = await _find_equipment(session, body.equipment_code)
        equipment_valid = bool(
            equipment is not None
            and equipment.active
            and equipment.process_code == station.process_code
        )

    process = await session.get(Process, station.process_code) if station.process_code else None
    process_requires_equipment = bool(process and process.requires_equipment)

    recent_same_scan = False
    late_arrival = False
    if wo is not None and station.process_code is not None:
        recent_same_scan = await _recent_same_scan(
            session, wo.id, station.process_code, body.action, now
        )
        late_arrival = await _late_arrival(session, wo.id, body.scanned_at)

    design_outdated = False
    current_design_version: int | None = None
    if wo is not None and body.action == "START" and station.process_code == "P30":
        current_design_version = await _current_design_version(session, wo.so_line_id)
        if current_design_version is not None and current_design_version != wo.design_version:
            design_outdated = True

    extra = body.extra or S.ScanExtra()
    ctx = engine.ScanContext(
        action=body.action,
        station_process_code=station.process_code,
        target_type=target_type,
        check_present=check_present,
        check_valid=check_valid,
        input_via=body.input_via,
        vb_mapped_wo=vb_mapped,
        wo_found=wo is not None,
        wo_status=wo.status if wo is not None else None,
        steps=_step_snapshots(steps, names),
        equipment_code=body.equipment_code,
        equipment_valid=equipment_valid,
        process_requires_equipment=process_requires_equipment,
        qty_good=body.qty_good,
        qty_bad=body.qty_bad,
        variance_reason=extra.variance_reason,
        variance_reason_code=extra.variance_reason_code,
        recent_same_scan=recent_same_scan,
        late_arrival=late_arrival,
        design_outdated=design_outdated,
        current_design_version=current_design_version,
    )
    decision = engine.decide(ctx)

    if decision.kind == "INVALID_REQUEST":
        raise ApiError(
            422,
            decision.code or "VALIDATION_ERROR",
            decision.message,
            [{"loc": ["body"], "msg": decision.message, "type": "value_error"}],
        )

    steps_by_seq = {s.seq: s for s in steps}
    equip_id = equipment.id if (equipment_valid and equipment is not None) else None
    if decision.kind == "APPLY":
        await _apply_updates(
            session,
            steps_by_seq,
            decision.step_updates,
            worker_id=worker.id if worker else None,
            equipment_id=equip_id,
            approver_id=None,
            now=now,
        )
        assert wo is not None and so is not None
        recalc.recalc_wo(wo, steps)
        await recalc.recalc_so(session, so)

    ev = ScanEvent(
        event_uuid=body.event_uuid,
        scanned_at=body.scanned_at,
        received_at=now,
        station_id=station.id,
        process_code=station.process_code,
        worker_id=worker.id if worker else None,
        target_type=target_type,
        target_code=body.code.strip().upper() if target_type != "VB" else body.code.strip(),
        action=body.action,
        qty_good=body.qty_good,
        qty_bad=body.qty_bad,
        qty_box=body.qty_box,
        equipment_id=equip_id,
        payload=_event_payload(body, decision),
        result=decision.result,
        result_msg=decision.message,
        approval_status="PENDING" if decision.kind == "PENDING" else None,
        wo_id=wo.id if wo is not None else None,
    )
    session.add(ev)
    await session.flush()

    resp = await _build_response(
        session,
        wo=wo,
        steps=steps,
        decision=decision,
        event_uuid=body.event_uuid,
        duplicate=False,
        worker=worker,
        station_process_code=station.process_code,
    )

    session.add(
        ScanEventKey(
            event_uuid=body.event_uuid,
            received_at=now,
            event_id=ev.id,
            result=decision.result,
            response=resp.model_dump(mode="json"),
        )
    )
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raced = await session.get(ScanEventKey, body.event_uuid)
        if raced is None:
            raise
        data = dict(raced.response)
        data["duplicate"] = True
        return S.ScanResponse.model_validate(data)
    return resp


# ======================================================================
# POST /scan/batch (§5.3, §13.5 ⑦)
# ======================================================================
async def handle_batch(
    session: AsyncSession, station: Station, raw_events: list[dict[str, Any]]
) -> S.ScanBatchResponse:
    parsed: list[tuple[int, uuid.UUID | None, S.ScanRequest | None, str | None]] = []
    for idx, raw in enumerate(raw_events):
        try:
            ev = S.ScanRequest.model_validate(raw)
            parsed.append((idx, ev.event_uuid, ev, None))
        except ValidationError as e:
            eu: uuid.UUID | None = None
            raw_uuid = raw.get("event_uuid") if isinstance(raw, dict) else None
            if isinstance(raw_uuid, str):
                try:
                    eu = uuid.UUID(raw_uuid)
                except ValueError:
                    eu = None
            parsed.append((idx, eu, None, str(e)))

    def _sort_key(item: tuple[int, uuid.UUID | None, S.ScanRequest | None, str | None]) -> Any:
        idx, _eu, ev, _err = item
        if ev is not None and ev.client_seq is not None:
            return (0, ev.client_seq, idx)
        scanned = ev.scanned_at if ev is not None else datetime.max.replace(tzinfo=UTC)
        return (1, scanned, idx)

    parsed.sort(key=_sort_key)

    results: list[S.ScanBatchResultItem] = []
    for _idx, eu, req, err in parsed:
        if req is None:
            resp = _reject_response(eu, "VALIDATION_ERROR", f"형식 오류: {err}")
            results.append(S.ScanBatchResultItem(event_uuid=eu, response=resp))
            continue
        try:
            resp = await handle_scan(session, station, req)
        except ApiError as e:
            resp = _reject_response(req.event_uuid, e.code, f"형식 오류: {e.message}")
        results.append(S.ScanBatchResultItem(event_uuid=eu, response=resp))
    return S.ScanBatchResponse(results=results)


# ======================================================================
# POST /scan/{event_uuid}/approve (§5.5)
# ======================================================================
async def _resolve_approver(
    session: AsyncSession, principal: Principal, body: S.ApproveRequest
) -> AppUser:
    if principal.user is not None:
        if principal.user.role not in ("MANAGER", "ADMIN"):
            raise ApiError(403, "APPROVER_ROLE", "승인 권한이 없습니다")
        return principal.user
    if not body.approver_card or not body.pin:
        raise validation(["body", "approver_card"], "approver_card 와 pin 이 필요합니다")
    card = body.approver_card.strip().upper()
    approver = (
        await session.execute(select(AppUser).where(AppUser.card_code == card))
    ).scalar_one_or_none()
    if approver is None:
        raise ApiError(404, "USER_CARD_NOT_FOUND", f"카드 {card} 에 해당하는 사용자가 없습니다")
    if approver.role not in ("MANAGER", "ADMIN"):
        raise ApiError(403, "APPROVER_ROLE", "승인 권한이 없습니다")
    await verify_pin(session, approver, body.pin)
    return approver


async def _rebuild_ctx_from_event(
    session: AsyncSession,
    ev: ScanEvent,
    snaps: tuple[engine.StepSnapshot, ...],
    wo: WorkOrder,
    equipment: Equipment | None,
    *,
    variance_reason: str | None = None,
    variance_reason_code: str | None = None,
) -> engine.ScanContext:
    process = await session.get(Process, ev.process_code) if ev.process_code else None
    requires_eq = bool(process and process.requires_equipment)
    payload = ev.payload or {}
    return engine.ScanContext(
        action=ev.action,
        station_process_code=ev.process_code,
        target_type="WO",
        check_present=True,
        check_valid=True,
        input_via=payload.get("input_via", "HID"),
        vb_mapped_wo=True,
        wo_found=True,
        wo_status=wo.status,
        steps=snaps,
        equipment_code=equipment.code if equipment else None,
        equipment_valid=equipment is not None,
        process_requires_equipment=requires_eq,
        qty_good=ev.qty_good,
        qty_bad=ev.qty_bad,
        variance_reason=variance_reason
        if variance_reason is not None
        else payload.get("variance_reason"),
        variance_reason_code=variance_reason_code
        if variance_reason_code is not None
        else payload.get("variance_reason_code"),
        recent_same_scan=False,
        late_arrival=False,
    )


async def _persist_inserted_step(
    session: AsyncSession,
    wo: WorkOrder,
    existing_orm: list[WoRouteStep],
    new_snaps: tuple[engine.StepSnapshot, ...],
) -> None:
    by_process = {s.process_code: s for s in existing_orm}
    changed = [
        (snap, by_process[snap.process_code])
        for snap in new_snaps
        if snap.process_code in by_process and by_process[snap.process_code].seq != snap.seq
    ]
    # 내림차순으로 옮겨야 UK(wo_id, seq) 충돌이 나지 않는다. SQLAlchemy 는 flush 안에서
    # UPDATE 문 발행 순서를 attribute 를 설정한 파이썬 루프 순서로 보장하지 않으므로
    # (보통 세션에 먼저 로드된 순서 = seq 오름차순을 따른다), 건마다 즉시 flush 해
    # 실제 SQL 도 내림차순으로 나가도록 강제한다 (QA① — 안 그러면 두 단계 이상 밀어야
    # 하는 E3 삽입에서 매번 409 DUPLICATE_CODE 로 실패했다).
    for snap, orm in sorted(changed, key=lambda pair: pair[0].seq, reverse=True):
        orm.seq = snap.seq
        await session.flush()
    new_snap = next(s for s in new_snaps if s.process_code not in by_process)
    session.add(
        WoRouteStep(
            wo_id=wo.id,
            seq=new_snap.seq,
            process_code=new_snap.process_code,
            std_lead_hours=Decimal("0"),
            tolerance_pct=new_snap.tolerance_pct,
            status="WAITING",
            qty_in=new_snap.qty_in,
        )
    )
    await session.flush()


async def approve(
    session: AsyncSession, principal: Principal, event_uuid: uuid.UUID, body: S.ApproveRequest
) -> S.ScanResponse:
    key = await session.get(ScanEventKey, event_uuid)
    if key is None:
        raise ApiError(404, "EVENT_NOT_FOUND", "이벤트를 찾을 수 없습니다")
    ev = await session.get(ScanEvent, (key.event_id, key.received_at))
    if ev is None or ev.approval_status != "PENDING":
        raise state_conflict("PENDING 상태가 아닌 이벤트입니다")

    approver = await _resolve_approver(session, principal, body)

    if body.decision == "DENY":
        ev.approval_status = "DENIED"
        session.add(
            AuditLog(
                table_name="scan_event",
                row_key=str(event_uuid),
                action="APPROVE",
                before=None,
                after={"decision": "DENY", "note": body.note},
                user_id=approver.id,
            )
        )
        await session.commit()
        return S.ScanResponse(
            result="REJECT",
            message="승인 거부",
            wo=None,
            next_process=None,
            remaining_qty=None,
            requires_approval=False,
            approval_token=None,
            warnings=[],
            step=None,
            event_uuid=event_uuid,
            duplicate=False,
            code=None,
        )

    if ev.wo_id is None:
        raise state_conflict("승인할 작업지시 컨텍스트가 없습니다")
    wo = await session.get(WorkOrder, ev.wo_id)
    if wo is None:
        raise state_conflict("승인할 작업지시를 찾을 수 없습니다")
    so = await session.get(SalesOrder, wo.so_id)
    steps = await _load_steps(session, wo.id)
    names = await process_names(session)
    pending_reason = (ev.payload or {}).get("pending_reason")
    worker = await session.get(AppUser, ev.worker_id) if ev.worker_id else None
    equipment = await session.get(Equipment, ev.equipment_id) if ev.equipment_id else None
    now = datetime.now(UTC)

    decision: engine.Decision
    if pending_reason == "PREV_INCOMPLETE":
        snaps = _step_snapshots(steps, names)
        cur = engine.find_step(snaps, ev.process_code or "")
        if cur is None:
            raise state_conflict("승인 대상 공정이 라우팅에 없습니다")
        e1_updates, carry = engine.resolve_e1_approval(snaps, cur.seq)
        steps_by_seq = {s.seq: s for s in steps}
        await _apply_updates(
            session,
            steps_by_seq,
            e1_updates,
            worker_id=worker.id if worker else None,
            equipment_id=None,
            approver_id=approver.id,
            now=now,
        )
        if carry is not None and steps_by_seq[cur.seq].qty_in is None:
            steps_by_seq[cur.seq].qty_in = carry
        await session.flush()
        snaps2 = _step_snapshots(steps, names)
        ctx2 = await _rebuild_ctx_from_event(session, ev, snaps2, wo, equipment)
        decision = engine.decide(ctx2)
    elif pending_reason == "QTY_VARIANCE":
        snaps = _step_snapshots(steps, names)
        cur = engine.find_step(snaps, ev.process_code or "")
        if cur is None:
            raise state_conflict("승인 대상 공정이 라우팅에 없습니다")
        note_reason = body.note or body.note_code
        ctx2 = await _rebuild_ctx_from_event(
            session,
            ev,
            snaps,
            wo,
            equipment,
            variance_reason=note_reason,
            variance_reason_code=body.note_code,
        )
        decision = engine.dispatch_done(ctx2, cur)
    elif pending_reason == "ROUTE_MISSING":
        if ev.process_code is None:
            raise state_conflict("승인 대상 공정 정보가 없습니다")
        process = await session.get(Process, ev.process_code)
        if process is None:
            raise state_conflict("공정 정보를 찾을 수 없습니다")
        all_processes = (await session.execute(select(Process))).scalars().all()
        gseq = {p.code: p.seq for p in all_processes}
        item = await session.get(Item, wo.item_id)
        if item is None:
            raise state_conflict("품목 정보를 찾을 수 없습니다")
        snaps = _step_snapshots(steps, names)
        new_snaps = engine.insert_missing_step(
            snaps,
            new_process_code=ev.process_code,
            new_process_name=names.get(ev.process_code, ev.process_code),
            tolerance_pct=item.qty_tolerance_pct,
            qty_in=None,
            global_seq_of=gseq,
        )
        await _persist_inserted_step(session, wo, steps, new_snaps)
        steps = await _load_steps(session, wo.id)
        snaps3 = _step_snapshots(steps, names)
        cur = engine.find_step(snaps3, ev.process_code)
        assert cur is not None
        prev = engine.prev_step(snaps3, cur.seq)
        if prev is not None and prev.status in engine.STEP_PREV_BLOCKING:
            decision = engine.Decision(
                kind="PENDING",
                result="WARN",
                code=None,
                message=f"직전 공정({prev.process_name}) 미완료",
                requires_approval=True,
                pending_reason="PREV_INCOMPLETE",
            )
        else:
            ctx2 = await _rebuild_ctx_from_event(session, ev, snaps3, wo, equipment)
            decision = engine.decide(ctx2)
    else:
        raise state_conflict("이 이벤트는 승인 대상이 아닙니다")

    if decision.kind == "INVALID_REQUEST":
        raise ApiError(422, decision.code or "VALIDATION_ERROR", decision.message)

    steps_by_seq2 = {s.seq: s for s in steps}
    if decision.kind == "APPLY":
        equip_id = equipment.id if equipment is not None else None
        await _apply_updates(
            session,
            steps_by_seq2,
            decision.step_updates,
            worker_id=worker.id if worker else None,
            equipment_id=equip_id,
            approver_id=approver.id,
            now=now,
        )
        assert so is not None
        recalc.recalc_wo(wo, steps)
        await recalc.recalc_so(session, so)

    ev.approval_status = "PENDING" if decision.kind == "PENDING" else "APPROVED"
    if decision.kind == "PENDING":
        ev.payload = {
            **(ev.payload or {}),
            "pending_reason": decision.pending_reason,
            "reapproval_of": str(event_uuid),
        }

    approve_ev = ScanEvent(
        event_uuid=uuid.uuid4(),
        scanned_at=now,
        received_at=now,
        station_id=ev.station_id,
        process_code=ev.process_code,
        worker_id=approver.id,
        target_type=ev.target_type,
        target_code=ev.target_code,
        action="APPROVE",
        payload={"decision": body.decision, "note": body.note, "approves_uuid": str(event_uuid)},
        result="OK",
        result_msg="승인 처리",
        wo_id=wo.id,
    )
    session.add(approve_ev)
    session.add(
        AuditLog(
            table_name="scan_event",
            row_key=str(event_uuid),
            action="APPROVE",
            before=None,
            after={"decision": body.decision, "note": body.note},
            user_id=approver.id,
        )
    )
    await session.flush()

    resp = await _build_response(
        session,
        wo=wo,
        steps=steps,
        decision=decision,
        event_uuid=event_uuid,
        duplicate=False,
        worker=worker,
        station_process_code=ev.process_code,
    )
    await session.commit()
    return resp


# ======================================================================
# GET /scan/pending
# ======================================================================
async def list_pending(session: AsyncSession, *, station_id: str | None) -> list[S.PendingScan]:
    stmt = select(ScanEvent).where(ScanEvent.approval_status == "PENDING")
    if station_id:
        stmt = stmt.where(ScanEvent.station_id == station_id)
    stmt = stmt.order_by(ScanEvent.received_at.desc())
    rows = (await session.execute(stmt)).scalars().all()
    out: list[S.PendingScan] = []
    for r in rows:
        worker = await session.get(AppUser, r.worker_id) if r.worker_id else None
        wo_sum = await _scan_wo_summary(session, r.wo_id) if r.wo_id else None
        out.append(
            S.PendingScan(
                event_uuid=r.event_uuid,
                scanned_at=r.scanned_at,
                station_id=r.station_id,
                worker=user_summary(worker) if worker else None,
                wo=wo_sum,
                action=r.action,
                process_code=r.process_code,
                message=r.result_msg or "",
                approval_token=str(r.event_uuid),
            )
        )
    return out


# ======================================================================
# GET /stations/{id}/queue (§7.6, §13.7 ㉗)
# ======================================================================
async def station_queue(session: AsyncSession, station: Station, *, limit: int) -> O.QueueResponse:
    if station.process_code is None:
        return O.QueueResponse(process_code="", process_name="", items=[], pending_approvals=0)
    process = await session.get(Process, station.process_code)
    stmt = (
        select(WorkOrder, WoRouteStep, SalesOrder)
        .join(WoRouteStep, WoRouteStep.wo_id == WorkOrder.id)
        .join(SalesOrder, SalesOrder.id == WorkOrder.so_id)
        .where(
            WoRouteStep.process_code == station.process_code,
            WoRouteStep.status == "WAITING",
            WoRouteStep.seq == WorkOrder.current_step_seq,
            WorkOrder.status.in_(("ISSUED", "IN_PROGRESS")),
        )
        .order_by(SalesOrder.due_date.asc())
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    wos = [wo for wo, _, _ in rows]
    views_ = await load_wo_views(session, wos)
    view_by_id = {v.wo.id: v for v in views_}
    now = datetime.now(UTC)
    items: list[O.QueueItem] = []
    for wo, step, so in rows:
        v = view_by_id[wo.id]
        ordered = sorted(v.steps, key=lambda s: s.seq)
        prev = next((s for s in reversed(ordered) if s.seq < step.seq), None)
        started = step.started_at or (prev.done_at if prev else None) or wo.issued_at or now
        waiting_h = (now - started).total_seconds() / 3600
        items.append(
            O.QueueItem(
                wo=wo_summary(v),
                step_status=step.status,
                qty_in=step.qty_in or 0,
                waiting_hours=round(waiting_h, 2),
                due_date=so.due_date,
                delay_risk=v.delay_risk,
            )
        )
    pending_count = (
        await session.execute(
            select(func.count())
            .select_from(ScanEvent)
            .where(ScanEvent.station_id == station.id, ScanEvent.approval_status == "PENDING")
        )
    ).scalar_one()
    return O.QueueResponse(
        process_code=station.process_code,
        process_name=process.name if process else station.process_code,
        items=items,
        pending_approvals=int(pending_count),
    )


# ======================================================================
# GET /stations/{id}/equipment (B2-04)
# ======================================================================
async def station_equipment(
    session: AsyncSession, station: Station, *, print_method: str | None
) -> list[Equipment]:
    stmt = select(Equipment).where(
        Equipment.process_code == station.process_code, Equipment.active.is_(True)
    )
    rows = list((await session.execute(stmt)).scalars().all())
    if print_method:
        pm = await session.get(PrintMethod, print_method.strip().upper())
        if pm is not None and pm.equip_types:
            allowed = set(pm.equip_types)
            rows = [e for e in rows if e.equip_type in allowed]
    return rows

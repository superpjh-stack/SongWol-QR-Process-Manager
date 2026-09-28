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
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import label as LabelS
from app.api.v1.schemas import material as MatS
from app.api.v1.schemas import order as O
from app.api.v1.schemas import scan as S
from app.api.v1.schemas import shipping as ShipS
from app.api.v1.schemas.common import IdRef
from app.core.checkcode import classify, verify_check
from app.core.errors import ApiError, not_found, state_conflict, validation
from app.core.sequence import next_code
from app.db.models.master import AppUser, Customer, Equipment, Item, PrintMethod, Process, Station
from app.db.models.material import InboundLot, MaterialReceipt, Stock, StockTxn, VendorBarcodeMap
from app.db.models.ops import AuditLog
from app.db.models.order import Design, SalesOrder, StepWork, WorkOrder, WoRouteStep
from app.db.models.scan import ScanEvent, ScanEventKey
from app.db.models.shipping import PackBox, Shipment, ShipmentBox
from app.domain.auth.service import resolve_manager_approver
from app.domain.label import service as label_service
from app.domain.master.admin_service import user_summary
from app.domain.order import recalc
from app.domain.order.views import load_wo_views, process_names, wo_summary
from app.domain.scan import engine

DEDUP_WINDOW_SECONDS = 60
# CANCEL·REPRINT 는 아직 WO 컨텍스트를 만들지 않는다(S4). MAP 은 스캔한 코드 자체가 매핑 대상
# 업체 바코드라 vendor_barcode_map 조회로 WO 를 미리 해석하면 안 된다(그게 MAP 의 목적이다).
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


async def resolve_worker_for_write(
    session: AsyncSession, principal: Principal, worker_card: str | None
) -> AppUser:
    """REST 쓰기 경로 공통(§7.4/§7.5): ``worker_card`` 있으면 카드로, 없으면 JWT 사용자로 작성자를
    정한다. ``material``·``shipping`` 서비스가 공유한다(중복 금지)."""
    if worker_card:
        return await _resolve_worker(session, worker_card)
    if principal.user is not None:
        return principal.user
    raise validation(["body", "worker_card"], "worker_card 가 필요합니다")


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


async def get_wo_by_code_or_404(session: AsyncSession, code: str) -> WorkOrder:
    """REST 경로(``/receipts`` · ``/boxes`` · ``/vendor-barcodes/map``)가 쓰는 공개 헬퍼."""
    wo = await _find_wo_by_code(session, code)
    if wo is None:
        raise not_found("WO_NOT_FOUND", "작업지시", code)
    return wo


async def _find_box_by_code(session: AsyncSession, code: str) -> PackBox | None:
    norm = code.strip().upper()
    return (await session.execute(select(PackBox).where(PackBox.code == norm))).scalar_one_or_none()


async def get_box_by_code_or_404(session: AsyncSession, code: str) -> PackBox:
    box = await _find_box_by_code(session, code)
    if box is None:
        raise not_found("BOX_NOT_FOUND", "박스", code)
    return box


async def _next_box_no(session: AsyncSession, wo_id: int) -> int:
    n = (
        await session.execute(select(func.count()).where(PackBox.wo_id == wo_id))
    ).scalar_one()
    return int(n) + 1


async def add_stock_txn(
    session: AsyncSession,
    item_id: int,
    qty_delta: int,
    *,
    txn_type: str,
    ref_type: str | None,
    ref_id: int | None,
    created_by: int | None,
    reason: str | None = None,
    source: str = "NEW",
) -> StockTxn:
    """공통 재고 반영 (db-schema §5.4/§5.5). RECEIVE(+)·SHIP(-)·ADJUST(±)·REWORK 가 공유한다."""
    stock = await session.get(Stock, item_id)
    if stock is None:
        stock = Stock(item_id=item_id, qty_on_hand=0)
        session.add(stock)
        await session.flush()
    stock.qty_on_hand = stock.qty_on_hand + qty_delta
    txn = StockTxn(
        item_id=item_id,
        txn_type=txn_type,
        qty=qty_delta,
        ref_type=ref_type,
        ref_id=ref_id,
        reason=reason,
        source=source,
        created_by=created_by,
    )
    session.add(txn)
    await session.flush()
    return txn


async def resolve_ship_boxes(
    session: AsyncSession,
    *,
    code: str,
    target_type: str,
    box_codes: list[str] | None,
) -> list[PackBox]:
    """SHIP 후보 박스 조회 (§5.2 5-SHIP, §13.6). 코드 중 하나라도 못 찾으면 **빈 목록**을 돌려줘
    ``dispatch_ship`` 이 ``BOX_NOT_FOUND`` 로 명확히 반려하게 한다(부분 무시 금지).

    - ``target_type == "LT"``: 스캔한 박스 + ``box_codes`` 로 추가한 박스(§13.6 ①)
    - ``target_type == "WO"``: ``box_codes`` 가 있으면 그 박스들만, 없으면 그 WO 의 미발송
      박스 전부(§11-15)
    """
    boxes: dict[int, PackBox] = {}
    if target_type == "LT":
        primary = await _find_box_by_code(session, code)
        if primary is None:
            return []
        boxes[primary.id] = primary
        for c in box_codes or ():
            b = await _find_box_by_code(session, c)
            if b is None:
                return []
            boxes[b.id] = b
        return list(boxes.values())
    if target_type == "WO":
        wo = await _find_wo_by_code(session, code)
        if wo is None:
            return []
        if box_codes:
            for c in box_codes:
                b = await _find_box_by_code(session, c)
                if b is None:
                    return []
                boxes[b.id] = b
            return list(boxes.values())
        rows = (
            (
                await session.execute(
                    select(PackBox).where(
                        PackBox.wo_id == wo.id, PackBox.shipment_id.is_(None)
                    )
                )
            )
            .scalars()
            .all()
        )
        return list(rows)
    return []


async def _ship_box_infos(
    session: AsyncSession, boxes: list[PackBox]
) -> tuple[engine.ShipBoxInfo, ...]:
    """§13.6: 후보 박스마다 SO 를 찾아 엔진 스냅샷으로 바꾼다 (엔진은 DB 를 만지지 않는다)."""
    so_by_wo: dict[int, int] = {}
    infos: list[engine.ShipBoxInfo] = []
    for b in boxes:
        so_id = so_by_wo.get(b.wo_id)
        if so_id is None:
            w = await session.get(WorkOrder, b.wo_id)
            assert w is not None
            so_id = w.so_id
            so_by_wo[b.wo_id] = so_id
        infos.append(
            engine.ShipBoxInfo(
                code=b.code,
                wo_id=b.wo_id,
                so_id=so_id,
                qty=b.qty,
                already_shipped=b.shipment_id is not None,
            )
        )
    return tuple(infos)


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


async def _recent_same_receive(
    session: AsyncSession, wo_id: int, qty: int, qty_box: int | None, now: datetime
) -> bool:
    """§13.5 ⑮: RECEIVE 는 같은 WO 에 같은 qty·box_count 일 때만 60 초 중복으로 본다."""
    window_start = now - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    stmt = select(ScanEvent.event_uuid).where(
        ScanEvent.wo_id == wo_id,
        ScanEvent.action == "RECEIVE",
        ScanEvent.result.in_(("OK", "WARN")),
        ScanEvent.qty_good == qty,
        ScanEvent.qty_box.is_(qty_box) if qty_box is None else ScanEvent.qty_box == qty_box,
        ScanEvent.received_at >= window_start,
        ScanEvent.received_at <= now,
    )
    return (await session.execute(stmt)).first() is not None


async def _recent_same_ship(
    session: AsyncSession, tracking_no: str, box_codes: frozenset[str], now: datetime
) -> bool:
    """§13.5 ⑮: SHIP 은 같은 tracking_no 에 같은 박스 집합일 때만 60 초 중복으로 본다."""
    window_start = now - timedelta(seconds=DEDUP_WINDOW_SECONDS)
    stmt = (
        select(ScanEvent.payload)
        .where(
            ScanEvent.action == "SHIP",
            ScanEvent.result.in_(("OK", "WARN")),
            ScanEvent.received_at >= window_start,
            ScanEvent.received_at <= now,
        )
        .order_by(ScanEvent.received_at.desc())
    )
    for (payload,) in (await session.execute(stmt)).all():
        if not isinstance(payload, dict):
            continue
        if payload.get("tracking_no") != tracking_no:
            continue
        codes = payload.get("_ship_box_codes")
        if isinstance(codes, list) and frozenset(codes) == box_codes:
            return True
    return False


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
    receipt: MatS.Receipt | None = None,
    box: ShipS.PackBox | None = None,
    label_job: LabelS.LabelJob | None = None,
    shipment: ShipS.ShipmentDetail | None = None,
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
    if shipment is not None:
        # shopfloor ㉑: SHIP 응답의 remaining_qty 는 단계 잔량이 아니라 SO 잔량이다.
        remaining_qty = shipment.so_remaining_qty

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
        receipt=receipt,
        box=box,
        label_job=label_job,
        shipment=shipment,
    )


# ======================================================================
# RECEIVE (A3-01/A3-03, api-contract §5.2 5-RECEIVE · §6.3) — 스캔·REST(`/receipts`) 공유
# ======================================================================
async def decide_receive(
    session: AsyncSession,
    *,
    wo: WorkOrder,
    qty: int,
    inspection: str,
    variance_reason: str | None,
    recent_same_scan: bool,
    late_arrival: bool = False,
    target_type: str = "WO",
    check_present: bool = True,
    check_valid: bool = True,
    input_via: str = "HID",
    vb_mapped_wo: bool = False,
) -> tuple[engine.Decision, list[WoRouteStep]]:
    """REST(`POST /receipts`) 는 station_process_code 없이 P20 고정으로 부른다(§7.4 "스캔
    RECEIVE 와 같은 서비스"). 스캔 경로(handle_scan)도 이 함수를 그대로 쓴다."""
    steps = await _load_steps(session, wo.id)
    names = await process_names(session)
    ctx = engine.ScanContext(
        action="RECEIVE",
        station_process_code="P20",
        target_type=target_type,
        check_present=check_present,
        check_valid=check_valid,
        input_via=input_via,
        vb_mapped_wo=vb_mapped_wo,
        wo_found=True,
        wo_status=wo.status,
        steps=_step_snapshots(steps, names),
        qty_good=qty,
        inspection=inspection,
        variance_reason=variance_reason,
        recent_same_scan=recent_same_scan,
        late_arrival=late_arrival,
    )
    return engine.decide(ctx), steps


async def apply_receive(
    session: AsyncSession,
    *,
    decision: engine.Decision,
    wo: WorkOrder,
    steps: list[WoRouteStep],
    item: Item,
    qty: int,
    box_count: int | None,
    inspection: str,
    vendor: str | None,
    vendor_barcode: str | None,
    received_at: datetime,
    worker: AppUser | None,
    station: Station | None,
    event_uuid: uuid.UUID | None,
) -> tuple[InboundLot, MaterialReceipt]:
    """``decision.kind == "APPLY"`` 일 때만 부른다. lot·receipt·stock_txn 생성 + P20 단계 갱신 +
    WO.qty_received/receipt_status 갱신 + recalc. 커밋은 호출자 몫(§13.7 원칙과 동일하게 두
    엔트리포인트가 각자의 트랜잭션 경계를 결정한다)."""
    lot = InboundLot(
        code=await next_code(session, "LT", received_at),
        item_id=item.id,
        vendor=vendor,
        received_at=received_at,
        qty=qty,
        status="QUARANTINE" if inspection == "FAIL" else "OK",
    )
    session.add(lot)
    await session.flush()
    receipt = MaterialReceipt(
        wo_id=wo.id,
        item_id=item.id,
        lot_id=lot.id,
        qty=qty,
        box_count=box_count,
        inspection=inspection,
        received_at=received_at,
        worker_id=worker.id if worker else None,
        station_id=station.id if station else None,
        vendor_barcode=vendor_barcode,
        event_uuid=event_uuid,
    )
    session.add(receipt)
    await session.flush()
    if inspection != "FAIL":
        await add_stock_txn(
            session,
            item.id,
            qty,
            txn_type="RECEIVE",
            ref_type="material_receipt",
            ref_id=receipt.id,
            created_by=worker.id if worker else None,
        )
    steps_by_seq = {s.seq: s for s in steps}
    await _apply_updates(
        session,
        steps_by_seq,
        decision.step_updates,
        worker_id=worker.id if worker else None,
        equipment_id=None,
        approver_id=None,
        now=received_at,
    )
    p20 = steps_by_seq[decision.step_updates[0].seq]
    wo.qty_received = p20.qty_good or 0
    if decision.receipt_status is not None:
        wo.receipt_status = decision.receipt_status
    # shopfloor ⑧: "RECEIVE 커밋마다" 다음 단계 qty_in = qty_received — _apply_updates 의
    # _propagate_qty_in 은 "비어 있을 때만" 채우므로(단계가 보통 한 번만 완료되는 다른 액션엔
    # 맞다) RECEIVE 의 부분입고 누적(여러 커밋)에는 맞지 않는다. 여기서 항상 덮어쓴다.
    nxt = next((s for s in sorted(steps, key=lambda x: x.seq) if s.seq > p20.seq), None)
    if nxt is not None:
        nxt.qty_in = wo.qty_received
    so = await session.get(SalesOrder, wo.so_id)
    recalc.recalc_wo(wo, steps)
    if so is not None:
        await recalc.recalc_so(session, so)
    return lot, receipt


def receipt_out(
    receipt: MaterialReceipt,
    lot: InboundLot,
    item: Item,
    worker: AppUser,
    wo: WorkOrder | None,
) -> MatS.Receipt:
    item_ref = IdRef(id=item.id, code=item.code, name=item.name)
    remaining = (wo.qty_ordered - wo.qty_received) if wo is not None else None
    return MatS.Receipt(
        id=receipt.id,
        wo_code=wo.code if wo is not None else None,
        item=item_ref,
        lot_code=lot.code,
        qty=receipt.qty,
        box_count=receipt.box_count,
        inspection=receipt.inspection,
        received_at=receipt.received_at,
        worker=user_summary(worker),
        lot=MatS.InboundLot(
            id=lot.id,
            code=lot.code,
            item=item_ref,
            vendor=lot.vendor,
            received_at=lot.received_at,
            qty=lot.qty,
            status=lot.status,
            quarantine_memo=lot.quarantine_memo,
        ),
        wo_receipt_status=wo.receipt_status if wo is not None else None,
        remaining_qty=remaining,
        vendor_barcode=receipt.vendor_barcode,
    )


# ======================================================================
# PACK (A4-01, api-contract §5.2 5-PACK) — 스캔·REST(`/boxes`) 공유
# ======================================================================
async def decide_pack(
    session: AsyncSession,
    *,
    wo: WorkOrder,
    qty_box: int,
    recent_same_scan: bool = False,
    late_arrival: bool = False,
) -> tuple[engine.Decision, list[WoRouteStep]]:
    steps = await _load_steps(session, wo.id)
    names = await process_names(session)
    ctx = engine.ScanContext(
        action="PACK",
        station_process_code="P50",
        target_type="WO",
        check_present=True,
        check_valid=True,
        input_via="HID",
        vb_mapped_wo=False,
        wo_found=True,
        wo_status=wo.status,
        steps=_step_snapshots(steps, names),
        qty_box=qty_box,
        recent_same_scan=recent_same_scan,
        late_arrival=late_arrival,
    )
    return engine.decide(ctx), steps


async def apply_pack(
    session: AsyncSession,
    *,
    decision: engine.Decision,
    wo: WorkOrder,
    steps: list[WoRouteStep],
    qty_box: int,
    printer_id: str | None,
    worker: AppUser | None,
    station: Station | None,
    event_uuid: uuid.UUID | None,
    client_seq: int | None,
) -> tuple[PackBox, LabelS.LabelJob]:
    """박스 생성은 항상 커밋된다(§13.7 ⑭) — ``label_service.print_label`` 이 내부에서 커밋하므로
    이 함수는 커밋 경계를 호출자와 공유하지 않는다(REST·스캔 모두 이 함수 호출 시점에 박스가
    이미 저장된다)."""
    steps_by_seq = {s.seq: s for s in steps}
    now = datetime.now(UTC)
    await _apply_updates(
        session,
        steps_by_seq,
        decision.step_updates,
        worker_id=worker.id if worker else None,
        equipment_id=None,
        approver_id=None,
        now=now,
    )
    p50 = steps_by_seq[decision.step_updates[0].seq]
    wo.qty_packed = p50.qty_good or 0
    so = await session.get(SalesOrder, wo.so_id)
    recalc.recalc_wo(wo, steps)
    if so is not None:
        await recalc.recalc_so(session, so)
    box_no = await _next_box_no(session, wo.id)
    box = PackBox(
        code=await next_code(session, "LT", now),
        wo_id=wo.id,
        box_no=box_no,
        qty=qty_box,
        packed_at=now,
        worker_id=worker.id if worker else None,
        station_id=station.id if station else None,
        event_uuid=event_uuid,
    )
    session.add(box)
    await session.flush()
    extra_ctx = {"offline_seq": client_seq} if client_seq is not None else None
    label_job = await label_service.print_label(
        session,
        LabelS.LabelPrintRequest(
            target=box.code, label_type="BOX_LABEL", printer=printer_id, copies=1
        ),
        Principal(station=station),
        extra_ctx=extra_ctx,
    )
    await session.commit()
    await session.refresh(box)
    return box, label_job


def pack_box_out(box: PackBox, wo: WorkOrder, label_job: LabelS.LabelJob | None) -> ShipS.PackBox:
    return ShipS.PackBox(
        id=box.id,
        code=box.code,
        wo_code=wo.code,
        box_no=box.box_no,
        qty=box.qty,
        packed_at=box.packed_at,
        shipment_id=box.shipment_id,
        label_job=label_job,
        wo_qty_packed=wo.qty_packed,
        wo_status=wo.status,
    )


# ======================================================================
# SHIP (A4-02~04, api-contract §5.2 5-SHIP · §13.6 다박스) — 스캔·REST(`/shipments`) 공유
# ======================================================================
async def decide_ship(
    session: AsyncSession,
    *,
    boxes: list[PackBox],
    tracking_no: str | None,
    recent_same_scan: bool = False,
    late_arrival: bool = False,
    target_type: str = "LT",
    check_present: bool = True,
    check_valid: bool = True,
    input_via: str = "HID",
) -> engine.Decision:
    ship_boxes = await _ship_box_infos(session, boxes)
    ctx = engine.ScanContext(
        action="SHIP",
        station_process_code="P60",
        target_type=target_type,
        check_present=check_present,
        check_valid=check_valid,
        input_via=input_via,
        vb_mapped_wo=False,
        wo_found=False,
        wo_status=None,
        steps=(),
        ship_tracking_no=tracking_no,
        ship_boxes=ship_boxes,
        recent_same_scan=recent_same_scan,
        late_arrival=late_arrival,
    )
    return engine.decide(ctx)


async def apply_ship(
    session: AsyncSession,
    *,
    decision: engine.Decision,
    boxes: list[PackBox],
    tracking_no: str,
    carrier: str | None,
    worker: AppUser | None,
    station: Station | None,
    event_uuid: uuid.UUID | None,
    confirm: bool = True,
) -> Shipment:
    """§6.4: 같은 SO·같은 tracking_no 의 READY shipment 가 있으면 합류, 없으면 생성. 박스마다
    WO 가 다를 수 있어(§13.6, 같은 SO 여러 WO) WO 별로 P60 단계를 따로 갱신한다."""
    assert boxes
    now = datetime.now(UTC)
    first_wo = await session.get(WorkOrder, boxes[0].wo_id)
    assert first_wo is not None
    so = await session.get(SalesOrder, first_wo.so_id)
    assert so is not None

    shipment = (
        await session.execute(
            select(Shipment).where(
                Shipment.so_id == so.id,
                Shipment.tracking_no == tracking_no,
                Shipment.status == "READY",
            )
        )
    ).scalar_one_or_none()
    if shipment is None:
        shipment = Shipment(
            so_id=so.id,
            carrier=carrier,
            tracking_no=tracking_no,
            status="READY",
            worker_id=worker.id if worker else None,
            station_id=station.id if station else None,
            event_uuid=event_uuid,
        )
        session.add(shipment)
        await session.flush()
    elif carrier and not shipment.carrier:
        shipment.carrier = carrier

    for b in boxes:
        b.shipment_id = shipment.id
        session.add(ShipmentBox(shipment_id=shipment.id, box_id=b.id))
    shipment.qty_total = shipment.qty_total + sum(b.qty for b in boxes)
    await session.flush()

    if confirm:
        shipment.status = "SHIPPED"
        shipment.shipped_at = now
        if worker is not None:
            shipment.worker_id = worker.id
        if station is not None:
            shipment.station_id = station.id
        # confirm=False 로 여러 번에 걸쳐 모은 뒤 마지막에 confirm=True 로 부를 수 있다
        # (§6.4 합류) — WO qty_shipped·P60·재고 반영은 "이번 호출의 boxes" 가 아니라
        # "이 shipment 에 실제로 붙은 박스 전부"를 대상으로 정확히 한 번씩 해야 한다.
        all_boxes = (
            (await session.execute(select(PackBox).where(PackBox.shipment_id == shipment.id)))
            .scalars()
            .all()
        )
        by_wo: dict[int, list[PackBox]] = {}
        for b in all_boxes:
            by_wo.setdefault(b.wo_id, []).append(b)
        for wo_id, wo_boxes in by_wo.items():
            wo = await session.get(WorkOrder, wo_id)
            assert wo is not None
            steps = await _load_steps(session, wo.id)
            names = await process_names(session)
            snaps = _step_snapshots(steps, names)
            p60 = engine.find_step(snaps, "P60")
            qty_add = sum(b.qty for b in wo_boxes)
            if p60 is not None:
                status, total = engine.accumulate_to_target(p60.qty_good or 0, qty_add, p60.qty_in)
                steps_by_seq = {s.seq: s for s in steps}
                await _apply_updates(
                    session,
                    steps_by_seq,
                    (
                        engine.StepUpdate(
                            seq=p60.seq,
                            status=status,
                            qty_good=total,
                            qty_bad=0,
                            mark_done_at=(status == "DONE"),
                        ),
                    ),
                    worker_id=worker.id if worker else None,
                    equipment_id=None,
                    approver_id=None,
                    now=now,
                )
            wo.qty_shipped = wo.qty_shipped + qty_add
            recalc.recalc_wo(wo, steps)
            await add_stock_txn(
                session,
                wo.item_id,
                -qty_add,
                txn_type="SHIP",
                ref_type="shipment",
                ref_id=shipment.id,
                created_by=worker.id if worker else None,
            )
        await recalc.recalc_so(session, so)
        if so.status == "SHIPPED" and so.shipped_at is None:
            so.shipped_at = now
    await session.flush()
    return shipment


async def shipment_out(session: AsyncSession, shipment: Shipment) -> ShipS.ShipmentDetail:
    so = await session.get(SalesOrder, shipment.so_id)
    assert so is not None
    customer = await session.get(Customer, so.customer_id)
    assert customer is not None
    box_rows = (
        (await session.execute(select(PackBox).where(PackBox.shipment_id == shipment.id)))
        .scalars()
        .all()
    )
    wo_codes = await load_by_id_codes(session, {b.wo_id for b in box_rows})
    worker = await session.get(AppUser, shipment.worker_id) if shipment.worker_id else None
    wo_rows = (
        (
            await session.execute(
                select(WorkOrder).where(WorkOrder.so_id == so.id, WorkOrder.status != "CANCELLED")
            )
        )
        .scalars()
        .all()
    )
    remaining = sum(w.qty_ordered - w.qty_shipped for w in wo_rows)
    return ShipS.ShipmentDetail(
        id=shipment.id,
        so_code=so.code,
        customer_name=customer.name,
        carrier=shipment.carrier,
        tracking_no=shipment.tracking_no,
        status=shipment.status,
        shipped_at=shipment.shipped_at,
        qty_total=shipment.qty_total,
        box_count=len(box_rows),
        boxes=[
            ShipS.PackBoxSummary(
                id=b.id,
                code=b.code,
                wo_code=wo_codes[b.wo_id],
                box_no=b.box_no,
                qty=b.qty,
                packed_at=b.packed_at,
                shipment_id=b.shipment_id,
            )
            for b in box_rows
        ],
        worker=user_summary(worker) if worker is not None else None,
        so_remaining_qty=int(remaining),
    )


async def load_by_id_codes(session: AsyncSession, wo_ids: set[int]) -> dict[int, str]:
    if not wo_ids:
        return {}
    rows = (
        await session.execute(select(WorkOrder.id, WorkOrder.code).where(WorkOrder.id.in_(wo_ids)))
    ).all()
    return dict(rows)


# ======================================================================
# MAP (A3-02, api-contract §5.2 5-MAP) — 스캔·REST(`/vendor-barcodes/map`) 공유
# ======================================================================
async def decide_map(*, wo: WorkOrder | None, wo_code: str | None) -> engine.Decision:
    ctx = engine.ScanContext(
        action="MAP",
        station_process_code=None,
        target_type="VB",
        check_present=False,
        check_valid=False,
        input_via="HID",
        vb_mapped_wo=False,
        wo_found=False,
        wo_status=None,
        steps=(),
        map_wo_code=wo_code,
        map_wo_found=wo is not None,
    )
    return engine.decide(ctx)


async def apply_map(
    session: AsyncSession,
    *,
    vendor_barcode: str,
    wo: WorkOrder,
    worker: AppUser,
    event_uuid: uuid.UUID | None,
) -> VendorBarcodeMap:
    """§5.3: "2건 이상 active 는 만들지 않는다" — 같은 바코드의 다른 active 매핑을 비활성화한
    뒤 (재)매핑한다. ``event_uuid`` 는 지금은 저장하지 않는다(vendor_barcode_map 에 그 컬럼이
    없다 — scan_event 로 추적된다)."""
    del event_uuid
    others = (
        await session.execute(
            select(VendorBarcodeMap).where(
                VendorBarcodeMap.vendor_barcode == vendor_barcode,
                VendorBarcodeMap.active.is_(True),
                VendorBarcodeMap.wo_id != wo.id,
            )
        )
    ).scalars().all()
    for o in others:
        o.active = False
    existing = (
        await session.execute(
            select(VendorBarcodeMap).where(
                VendorBarcodeMap.vendor_barcode == vendor_barcode,
                VendorBarcodeMap.wo_id == wo.id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        existing.active = True
        existing.mapped_at = datetime.now(UTC)
        existing.mapped_by = worker.id
        await session.flush()
        return existing
    mapping = VendorBarcodeMap(
        vendor_barcode=vendor_barcode,
        wo_id=wo.id,
        item_id=wo.item_id,
        mapped_by=worker.id,
        active=True,
    )
    session.add(mapping)
    await session.flush()
    return mapping


def vendor_barcode_map_out(
    mapping: VendorBarcodeMap, wo: WorkOrder, item: Item, mapped_by: AppUser
) -> MatS.VendorBarcodeMap:
    return MatS.VendorBarcodeMap(
        id=mapping.id,
        vendor_barcode=mapping.vendor_barcode,
        wo_code=wo.code,
        item=IdRef(id=item.id, code=item.code, name=item.name),
        mapped_at=mapping.mapped_at,
        mapped_by=user_summary(mapped_by),
        active=mapping.active,
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

    extra = body.extra or S.ScanExtra()

    # SHIP(§13.6)·MAP(§5.2 5-MAP) 은 단일 WO 파이프라인 밖이라 여기서 따로 해석한다.
    ship_boxes_orm: list[PackBox] = []
    if body.action == "SHIP":
        ship_boxes_orm = await resolve_ship_boxes(
            session, code=body.code, target_type=target_type, box_codes=extra.box_codes
        )
    map_target_wo: WorkOrder | None = None
    if body.action == "MAP" and extra.wo_code:
        map_target_wo = await _find_wo_by_code(session, extra.wo_code)

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
    if body.action == "RECEIVE" and wo is not None:
        recent_same_scan = await _recent_same_receive(
            session, wo.id, body.qty_good or 0, body.qty_box, now
        )
        late_arrival = await _late_arrival(session, wo.id, body.scanned_at)
    elif body.action == "SHIP":
        if extra.tracking_no:
            recent_same_scan = await _recent_same_ship(
                session, extra.tracking_no, frozenset(b.code for b in ship_boxes_orm), now
            )
        if ship_boxes_orm:
            late_arrival = await _late_arrival(session, ship_boxes_orm[0].wo_id, body.scanned_at)
    elif wo is not None and station.process_code is not None:
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
        qty_box=body.qty_box,
        inspection=extra.inspection,
        variance_reason=extra.variance_reason,
        variance_reason_code=extra.variance_reason_code,
        recent_same_scan=recent_same_scan,
        late_arrival=late_arrival,
        design_outdated=design_outdated,
        current_design_version=current_design_version,
        map_wo_code=extra.wo_code,
        map_wo_found=map_target_wo is not None,
        ship_tracking_no=extra.tracking_no,
        ship_boxes=await _ship_box_infos(session, ship_boxes_orm),
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
    receipt_resp: MatS.Receipt | None = None
    box_resp: ShipS.PackBox | None = None
    label_job_resp: LabelS.LabelJob | None = None
    shipment_resp: ShipS.ShipmentDetail | None = None
    if decision.kind == "APPLY":
        if body.action in ("START", "DONE"):
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
        elif body.action == "RECEIVE":
            assert wo is not None and extra.inspection is not None
            item = await session.get(Item, wo.item_id)
            assert item is not None
            lot, receipt = await apply_receive(
                session,
                decision=decision,
                wo=wo,
                steps=steps,
                item=item,
                qty=body.qty_good or 0,
                box_count=body.qty_box,
                inspection=extra.inspection,
                vendor=extra.vendor,
                vendor_barcode=body.code if target_type == "VB" else None,
                received_at=body.scanned_at,
                worker=worker,
                station=station,
                event_uuid=body.event_uuid,
            )
            if worker is not None:
                receipt_resp = receipt_out(receipt, lot, item, worker, wo)
        elif body.action == "PACK":
            assert wo is not None
            box, label_job_resp = await apply_pack(
                session,
                decision=decision,
                wo=wo,
                steps=steps,
                qty_box=body.qty_box or 0,
                printer_id=extra.printer_id,
                worker=worker,
                station=station,
                event_uuid=body.event_uuid,
                client_seq=body.client_seq,
            )
            box_resp = pack_box_out(box, wo, label_job_resp)
            if not label_job_resp.zpl_sent:
                # §13.7: 박스는 항상 커밋되지만, 라벨 출력 실패는 WARN 으로 눈에 보이게 한다
                # (조용한 실패 금지). PRINTER_UNREACHABLE(⑭) 과 NO_PRINTER(프린터 선택 순서
                # 문단)는 문구가 다르다.
                msg = (
                    "라벨 출력 실패 — [재출력] 을 누르세요"
                    if label_job_resp.error == "PRINTER_UNREACHABLE"
                    else "프린터 미지정 — 단말 설정을 확인하세요"
                )
                decision = replace(decision, result="WARN", warnings=(*decision.warnings, msg))
        elif body.action == "SHIP":
            assert extra.tracking_no is not None
            shipment_row = await apply_ship(
                session,
                decision=decision,
                boxes=ship_boxes_orm,
                tracking_no=extra.tracking_no,
                carrier=extra.carrier,
                worker=worker,
                station=station,
                event_uuid=body.event_uuid,
            )
            shipment_resp = await shipment_out(session, shipment_row)
        elif body.action == "MAP":
            assert map_target_wo is not None and worker is not None
            await apply_map(
                session,
                vendor_barcode=body.code,
                wo=map_target_wo,
                worker=worker,
                event_uuid=body.event_uuid,
            )

    payload = _event_payload(body, decision)
    if body.action == "SHIP":
        payload["_ship_box_codes"] = sorted(b.code for b in ship_boxes_orm)

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
        payload=payload,
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
        receipt=receipt_resp,
        box=box_resp,
        label_job=label_job_resp,
        shipment=shipment_resp,
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
    return await resolve_manager_approver(session, body.approver_card, body.pin)


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

"""라벨 도메인 서비스 (B1-01 QR 발행 · B1-02 ZPL 출력 · A1-09 프린터·양식).

- ``record_issue()``: label_issue 기록, 차수(issue_no) 자동 증가
  (UK target_type·code·label_type·issue_no)
- ``issue_labels_for_wo(session, wo)``: WO 발행 시 SO 표지(WORK_ORDER_PDF, SO 당 1회)·WO 작업지시서
  (WORK_ORDER_PDF)·WO 라벨(WO_LABEL) 1차 기록. **개발A 의 ``app/domain/order/ports.py`` 훅을 이
  함수로 바인딩한다.** 커밋하지 않는다 — 호출자 트랜잭션에 실린다
- ``print_label()``: 대상 해석(WO/LT/US) → 프린터 선택(§13.7 ②) → ZPL 렌더 → TCP 전송.
  프린터 실패는 200 + ``zpl_sent=false, error=PRINTER_UNREACHABLE`` (⑭). 프린터 미지정은
  ``error=NO_PRINTER`` 이고 label_issue 를 기록하지 않는다(발행된 것이 없다)
- 프린터 CRUD · 라벨 양식 GET/PUT/preview (§7.2, admin #18, §11-7)
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Principal
from app.api.v1.schemas import label as S
from app.api.v1.schemas.common import normalize_code
from app.api.v1.schemas.master import UserSummary
from app.api.v1.schemas.order import LabelJob
from app.core.checkcode import classify
from app.core.errors import ApiError, duplicate_code, not_found, validation
from app.db.models.master import (
    AppUser,
    Customer,
    Item,
    LabelTemplate,
    Printer,
    PrintMethod,
    Process,
    Station,
)
from app.db.models.order import (
    Design,
    LabelIssue,
    SalesOrder,
    SalesOrderLine,
    WorkOrder,
    WoRouteStep,
)
from app.db.models.shipping import PackBox
from app.domain.label import zpl as zpl_mod
from app.domain.label.placeholders import (
    LABEL_TYPES,
    SAMPLE_CONTEXT,
    TEST_LABEL_TYPE,
    placeholders_for,
)
from app.domain.label.qr import qr_url, zpl_qr_params
from app.domain.label.templates import DEFAULT_TEMPLATES, load_default_template

TARGET_TYPE_FOR_LABEL: dict[str, str] = {
    "WO_LABEL": "WO",
    "BOX_LABEL": "LT",
    "WORKER_CARD": "US",
    "WORK_ORDER_PDF": "SO",
}
ERR_NO_PRINTER = "NO_PRINTER"
ERR_PRINTER_UNREACHABLE = "PRINTER_UNREACHABLE"


# ======================================================================
# label_issue (B1-01 · B1-03 차수)
# ======================================================================
async def last_issue_no(
    session: AsyncSession, target_type: str, target_code: str, label_type: str
) -> int:
    stmt = select(func.coalesce(func.max(LabelIssue.issue_no), 0)).where(
        LabelIssue.target_type == target_type,
        LabelIssue.target_code == target_code,
        LabelIssue.label_type == label_type,
    )
    return int((await session.execute(stmt)).scalar_one())


async def record_issue(
    session: AsyncSession,
    target_type: str,
    target_code: str,
    label_type: str,
    issued_by: int | None = None,
    station_id: str | None = None,
    *,
    printer_id: str | None = None,
    copies: int = 1,
) -> LabelIssue:
    """발행 이력 1행 추가 (issue_no = 마지막 차수 + 1). flush 까지만 — 커밋은 호출자."""
    issue = LabelIssue(
        target_type=target_type,
        target_code=target_code,
        label_type=label_type,
        issue_no=await last_issue_no(session, target_type, target_code, label_type) + 1,
        printer_id=printer_id,
        copies=copies,
        issued_by=issued_by,
        station_id=station_id,
    )
    session.add(issue)
    await session.flush()
    return issue


async def issue_labels_for_wo(
    session: AsyncSession, wo: WorkOrder, issued_by: int | None = None
) -> list[LabelIssue]:
    """WO 발행(ISSUED) 시 QR 발행 이력 (B1-01).

    - SO 표지(WORK_ORDER_PDF): 그 SO 에 아직 없을 때만 1차 기록 (같은 SO 의 2번째 WO 발행은 표지를
      다시 발행하지 않는다)
    - WO 작업지시서 쪽(WORK_ORDER_PDF) · WO 라벨(WO_LABEL): 다음 차수 (보통 1차)
    개발A: ``app/domain/order/ports.py`` 의 같은 이름 훅을 이 함수로 바인딩할 것.
    """
    so = await session.get(SalesOrder, wo.so_id)
    if so is None:
        raise not_found("SO_NOT_FOUND", "수주", wo.so_id)
    out: list[LabelIssue] = []
    if await last_issue_no(session, "SO", so.code, "WORK_ORDER_PDF") == 0:
        out.append(await record_issue(session, "SO", so.code, "WORK_ORDER_PDF", issued_by))
    out.append(await record_issue(session, "WO", wo.code, "WORK_ORDER_PDF", issued_by))
    out.append(await record_issue(session, "WO", wo.code, "WO_LABEL", issued_by))
    return out


async def label_issuer(session: AsyncSession, wo: WorkOrder) -> None:
    """개발A ``app/domain/order/ports.LabelIssuer`` 시그니처 ``(session, wo) -> None`` 어댑터.

    ``ports.set_label_issuer(label_issuer)`` 로 꽂는다 (``router.bind_order_ports()`` 가 시도).
    """
    await issue_labels_for_wo(session, wo)


async def list_issues(session: AsyncSession, target_code: str) -> list[S.LabelIssue]:
    target_code = normalize_code(target_code)
    stmt = (
        select(LabelIssue, AppUser)
        .outerjoin(AppUser, AppUser.id == LabelIssue.issued_by)
        .where(LabelIssue.target_code == target_code)
        .order_by(LabelIssue.issued_at.desc(), LabelIssue.id.desc())
    )
    rows = (await session.execute(stmt)).all()
    return [issue_out(i, u) for i, u in rows]


def issue_out(i: LabelIssue, u: AppUser | None) -> S.LabelIssue:
    return S.LabelIssue(
        id=i.id,
        target_type=i.target_type,
        target_code=i.target_code,
        label_type=i.label_type,
        issue_no=i.issue_no,
        printer_id=i.printer_id,
        copies=i.copies,
        sent_at=None,
        pdf_url=None,
        zpl_sent=False,
        error=None,
        issued_at=i.issued_at,
        issued_by=UserSummary.model_validate(u) if u is not None else None,
        station_id=i.station_id,
    )


# ======================================================================
# 대상 데이터 로딩 (플레이스홀더 컨텍스트)
# ======================================================================
def _dec(v: Decimal | None) -> str:
    return "" if v is None else f"{v:.1f}"


async def load_wo(session: AsyncSession, code: str) -> WorkOrder:
    wo = (
        await session.execute(select(WorkOrder).where(WorkOrder.code == code))
    ).scalar_one_or_none()
    if wo is None:
        raise not_found("WO_NOT_FOUND", "작업지시", code)
    return wo


async def load_so(session: AsyncSession, code: str) -> SalesOrder:
    so = (
        await session.execute(select(SalesOrder).where(SalesOrder.code == code))
    ).scalar_one_or_none()
    if so is None:
        raise not_found("SO_NOT_FOUND", "수주", code)
    return so


async def load_box(session: AsyncSession, code: str) -> PackBox:
    box = (await session.execute(select(PackBox).where(PackBox.code == code))).scalar_one_or_none()
    if box is None:
        raise not_found("BOX_NOT_FOUND", "박스", code)
    return box


async def load_user_by_card(session: AsyncSession, code: str) -> AppUser:
    u = (
        await session.execute(select(AppUser).where(AppUser.card_code == code))
    ).scalar_one_or_none()
    if u is None:
        raise not_found("USER_CARD_NOT_FOUND", "작업자 카드", code)
    return u


async def wo_steps(session: AsyncSession, wo_id: int) -> list[dict[str, Any]]:
    stmt = (
        select(WoRouteStep, Process.name)
        .join(Process, Process.code == WoRouteStep.process_code)
        .where(WoRouteStep.wo_id == wo_id)
        .order_by(WoRouteStep.seq)
    )
    return [
        {
            "seq": s.seq,
            "process_code": s.process_code,
            "process_name": name,
            "std_lead_hours": _dec(s.std_lead_hours),
            "status": s.status,
        }
        for s, name in (await session.execute(stmt)).all()
    ]


async def wo_context(session: AsyncSession, wo: WorkOrder) -> dict[str, Any]:
    """WO_LABEL · 작업지시서 WO 쪽의 플레이스홀더 (admin #18)."""
    so = await session.get(SalesOrder, wo.so_id)
    assert so is not None
    customer = await session.get(Customer, so.customer_id)
    item = await session.get(Item, wo.item_id)
    pm = await session.get(PrintMethod, wo.print_method)
    line = await session.get(SalesOrderLine, wo.so_line_id)
    thumb: str | None = None
    if line is not None and line.design_id is not None:
        design = await session.get(Design, line.design_id)
        thumb = design.thumbnail_path if design is not None else None
    steps = await wo_steps(session, wo.id)
    return {
        "code": wo.code,
        "qr_url": qr_url(wo.code),
        "so_code": so.code,
        "customer_name": customer.name if customer else "",
        "item_name": item.name if item else "",
        "spec": item.spec if item else None,
        "color": item.color if item else None,
        "print_method_name": pm.name if pm else wo.print_method,
        "qty_ordered": wo.qty_ordered,
        "due_date": so.due_date.isoformat(),
        "design_thumbnail_path": thumb,
        "steps": steps,
    }


async def box_context(session: AsyncSession, box: PackBox) -> dict[str, Any]:
    wo = await session.get(WorkOrder, box.wo_id)
    assert wo is not None
    base = await wo_context(session, wo)
    total = (
        await session.execute(select(func.count()).where(PackBox.wo_id == box.wo_id))
    ).scalar_one()
    return {
        "code": box.code,
        "qr_url": qr_url(box.code),
        "box_no": box.box_no,
        "box_total": int(total),  # 인쇄 시점 누계 (§9)
        "qty": box.qty,
        "wo_code": wo.code,
        "customer_name": base["customer_name"],
        "item_name": base["item_name"],
        "spec": base["spec"],
        "color": base["color"],
        "offline_seq": None,  # PACK 스캔 경로(S3)가 payload.offline_seq 를 넘긴다
    }


def card_context(u: AppUser) -> dict[str, Any]:
    assert u.card_code is not None
    return {"code": u.card_code, "qr_url": qr_url(u.card_code), "name": u.name, "role": u.role}


async def target_context(
    session: AsyncSession, label_type: str, target: str
) -> tuple[str, dict[str, Any]]:
    """(target_type, ctx). label_type 과 대상 코드 종류가 맞지 않으면 422."""
    target = normalize_code(target)
    kind = classify(target)
    expected = TARGET_TYPE_FOR_LABEL[label_type]
    if kind != expected:
        raise validation(
            ["body", "target"], f"{label_type} 의 대상은 {expected} 코드여야 합니다: {target}"
        )
    if kind == "WO":
        return kind, await wo_context(session, await load_wo(session, target))
    if kind == "LT":
        return kind, await box_context(session, await load_box(session, target))
    if kind == "US":
        return kind, card_context(await load_user_by_card(session, target))
    raise validation(["body", "target"], f"{label_type} 은 /labels/print 로 출력할 수 없습니다")


def sample_context(label_type: str) -> dict[str, Any]:
    """target 없는 미리보기·PUT 검증용 예시 컨텍스트 (모든 플레이스홀더를 채운다)."""
    if label_type == "WORK_ORDER_PDF":
        from app.domain.label.pdf import sample_document_context

        return sample_document_context()
    ctx = dict(SAMPLE_CONTEXT[label_type])
    ctx["qr_url"] = qr_url(str(ctx["code"]))
    ctx["issue_no"] = 1
    return ctx


# ======================================================================
# 프린터 (ADM-09 탭 1)
# ======================================================================
def printer_out(p: Printer) -> S.Printer:
    return S.Printer.model_validate(p)


async def list_printers(session: AsyncSession, active: bool | None = None) -> list[Printer]:
    stmt = select(Printer).order_by(Printer.id)
    if active is not None:
        stmt = stmt.where(Printer.active.is_(active))
    return list((await session.execute(stmt)).scalars().all())


async def get_printer(session: AsyncSession, printer_id: str) -> Printer:
    printer_id = normalize_code(printer_id)
    p = await session.get(Printer, printer_id)
    if p is None:
        raise not_found("PRINTER_NOT_FOUND", "프린터", printer_id)
    return p


async def create_printer(session: AsyncSession, body: S.PrinterCreate) -> Printer:
    if await session.get(Printer, body.id) is not None:
        raise duplicate_code("프린터", body.id)
    p = Printer(**body.model_dump())
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


async def update_printer(session: AsyncSession, printer_id: str, body: S.PrinterUpdate) -> Printer:
    p = await get_printer(session, printer_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is None and k != "location":
            continue  # 필수 컬럼은 null 로 못 지운다
        setattr(p, k, v)
    await session.commit()
    await session.refresh(p)
    return p


async def set_printer_active(session: AsyncSession, printer_id: str, active: bool) -> Printer:
    p = await get_printer(session, printer_id)
    p.active = active
    await session.commit()
    await session.refresh(p)
    return p


async def select_printer(
    session: AsyncSession, explicit_id: str | None, station: Station | None
) -> Printer | None:
    """§13.7 ②: 명시 printer → station.printer_id → 활성 PACKING 이 정확히 1대 → None."""
    if explicit_id:
        return await get_printer(
            session, explicit_id
        )  # 없으면 404 (명시했으니 조용히 넘기지 않는다)
    if station is not None and station.printer_id:
        p = await session.get(Printer, station.printer_id)
        if p is not None and p.active:
            return p
    packing = [p for p in await list_printers(session, active=True) if p.purpose == "PACKING"]
    return packing[0] if len(packing) == 1 else None


async def send_to_printer(printer: Printer, zpl: str) -> tuple[bool, datetime | None, str | None]:
    """(zpl_sent, sent_at, error). 실패는 예외가 아니라 값으로 돌려준다 (503 없음, §13.7)."""
    try:
        await zpl_mod.send_zpl(printer.host, printer.port, zpl)
    except zpl_mod.PrinterUnreachable:
        return False, None, ERR_PRINTER_UNREACHABLE
    return True, datetime.now(UTC), None


async def test_printer(session: AsyncSession, printer_id: str) -> S.PrinterTestResult:
    p = await get_printer(session, printer_id)
    body = await zpl_mod.template_body(session, TEST_LABEL_TYPE)
    rendered = zpl_mod.render(
        body,
        printer_id=p.id,
        printer_name=p.name,
        host=p.host,
        port=p.port,
        qr_url=qr_url("TEST"),
    )
    sent, sent_at, error = await send_to_printer(p, rendered)
    return S.PrinterTestResult(
        printer_id=p.id,
        host=p.host,
        port=p.port,
        zpl_sent=sent,
        sent_at=sent_at,
        error=error,
        zpl=rendered,
    )


# ======================================================================
# 출력 (POST /labels/print)
# ======================================================================
async def print_label(
    session: AsyncSession, body: S.LabelPrintRequest, principal: Principal
) -> LabelJob:
    target_type, ctx = await target_context(session, body.label_type, body.target)
    printer = await select_printer(session, body.printer, principal.station)
    label_type = body.label_type
    if printer is None:
        # 발행된 것이 없다 — 차수는 올리지 않고 현재 차수만 알려 준다
        return LabelJob(
            issue_no=await last_issue_no(session, target_type, ctx["code"], label_type),
            label_type=label_type,
            printer_id=None,
            copies=body.copies,
            sent_at=None,
            pdf_url=None,
            zpl_sent=False,
            error=ERR_NO_PRINTER,
        )
    issue = await record_issue(
        session,
        target_type,
        ctx["code"],
        label_type,
        principal.user_id,
        principal.station.id if principal.station else None,
        printer_id=printer.id,
        copies=body.copies,
    )
    template = await zpl_mod.template_body(session, label_type)
    try:
        rendered = zpl_mod.render(
            template, **ctx, issue_no=issue.issue_no, **zpl_qr_params(printer.purpose)
        )
    except zpl_mod.BadTemplate as e:
        raise ApiError(422, "BAD_TEMPLATE", f"{label_type} 양식 오류: {e}") from e
    await session.commit()  # 발행 이력은 전송 결과와 무관하게 남긴다 (실패도 차수 소비)
    sent, sent_at, error = await send_to_printer(
        printer, zpl_mod.with_copies(rendered, body.copies)
    )
    return LabelJob(
        issue_no=issue.issue_no,
        label_type=label_type,
        printer_id=printer.id,
        copies=body.copies,
        sent_at=sent_at,
        pdf_url=None,
        zpl_sent=sent,
        error=error,
    )


# ======================================================================
# 라벨 양식 (ADM-09 탭 2)
# ======================================================================
def _check_label_type(label_type: str) -> str:
    label_type = normalize_code(label_type)
    if label_type not in LABEL_TYPES:
        raise not_found("LABEL_TEMPLATE_NOT_FOUND", "라벨 양식", label_type)
    return label_type


async def _template_row(session: AsyncSession, label_type: str) -> LabelTemplate:
    row = await session.get(LabelTemplate, label_type)
    if row is None:  # 시드 누락 시 기본본으로 만든다 (조용히 빈 양식을 주지 않는다)
        fmt, body = load_default_template(label_type)
        row = LabelTemplate(label_type=label_type, format=fmt, body=body)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def template_out(session: AsyncSession, row: LabelTemplate) -> S.LabelTemplate:
    by = await session.get(AppUser, row.updated_by) if row.updated_by is not None else None
    return S.LabelTemplate(
        label_type=row.label_type,
        format=row.format,
        body=row.body,
        version=row.version,
        placeholders=placeholders_for(row.label_type),
        updated_at=row.updated_at,
        updated_by=UserSummary.model_validate(by) if by is not None else None,
    )


async def list_templates(session: AsyncSession) -> list[S.LabelTemplate]:
    return [
        await template_out(session, await _template_row(session, lt)) for lt in DEFAULT_TEMPLATES
    ]


async def get_template(session: AsyncSession, label_type: str) -> S.LabelTemplate:
    label_type = _check_label_type(label_type)
    return await template_out(session, await _template_row(session, label_type))


def validate_template(label_type: str, body: str) -> None:
    """문법 + 예시 컨텍스트 렌더. 실패 → 422 BAD_TEMPLATE (detail 에 원인)."""
    try:
        zpl_mod.compile_template(body)
        zpl_mod.render(body, **sample_context(label_type))
    except zpl_mod.BadTemplate as e:
        raise ApiError(
            422,
            "BAD_TEMPLATE",
            f"양식 오류: {e}",
            [{"loc": ["body", "body"], "msg": str(e), "type": "value_error"}],
        ) from e


async def put_template(
    session: AsyncSession, label_type: str, body: S.LabelTemplateUpdate, user_id: int
) -> S.LabelTemplate:
    label_type = _check_label_type(label_type)
    validate_template(label_type, body.body)
    row = await _template_row(session, label_type)
    row.body = body.body
    row.version = row.version + 1
    row.updated_by = user_id
    await session.commit()
    await session.refresh(row)
    return await template_out(session, row)


async def preview_template(
    session: AsyncSession, label_type: str, req: S.LabelPreviewRequest
) -> S.LabelPreview:
    """§11-7: 서버는 텍스트(ZPL/HTML)만 돌려준다. target 없으면 예시 값."""
    label_type = _check_label_type(label_type)
    row = await _template_row(session, label_type)
    purpose: str | None = None
    if req.printer_id:
        purpose = (await get_printer(session, req.printer_id)).purpose
    if req.target is None:
        ctx = sample_context(label_type)
    elif label_type == "WORK_ORDER_PDF":
        from app.domain.label.pdf import document_context

        so = await load_so(session, req.target)
        ctx = await document_context(session, so, None)
    else:
        _, ctx = await target_context(session, label_type, req.target)
        ctx["issue_no"] = await last_issue_no(
            session, TARGET_TYPE_FOR_LABEL[label_type], ctx["code"], label_type
        )
    try:
        rendered = zpl_mod.render(row.body, **ctx, **zpl_qr_params(purpose))
    except zpl_mod.BadTemplate as e:
        raise ApiError(422, "BAD_TEMPLATE", f"양식 오류: {e}") from e
    return S.LabelPreview(
        label_type=label_type,
        format=row.format,
        target=req.target,
        body=rendered,
    )

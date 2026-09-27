"""QR 착지 (api-contract §10 · §13.4 admin #30/#31 · screens-admin QRL-01).

``GET /api/v1/q/{code}?c=`` — 공개. 체크코드 검증(``verify_check``) 후 SO/WO/LT/US 를 해석한다.
- 형식 오류(VB) → 400 ``BAD_CODE_FORMAT`` · 체크코드 없음/불일치 → 400 ``BAD_CHECKCODE``
- 비로그인: #30 제외 필드(design_thumbnail_url · unit_price · 거래처 연락처 · memo)를 뺀다.
  Summary 형에는 원래 없고 WO 의 ``design_thumbnail_url`` 만 null 로. US 는 name·role·card_code 만.
- 로그인(JWT): ``allowed_actions`` 를 역할·상태로 계산 (AllowedAction 7종).
- LT 는 S3 (입고 LOT · 박스) — 지금은 404 ``LOT_NOT_FOUND``.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import order as S
from app.core.checkcode import classify, verify_check
from app.core.errors import ApiError, not_found
from app.db.models.master import AppUser
from app.db.models.order import SalesOrder, WorkOrder
from app.db.models.scan import ScanEvent
from app.domain.master.admin_service import user_summary
from app.domain.order.views import load_so_views, load_wo_views, so_summary, wo_summary

MANAGE_ROLES = frozenset({"ADMIN", "MANAGER"})
REPRINT_ROLES = frozenset({"ADMIN", "MANAGER", "SALES"})
WO_ISSUED_LIKE = frozenset({"ISSUED", "IN_PROGRESS", "PACKED", "ON_HOLD"})
WO_HOLDABLE = frozenset({"ISSUED", "IN_PROGRESS"})


def _parse(code: str, check: str | None) -> tuple[str, str]:
    norm = code.strip().upper()
    kind = classify(norm)
    if kind == "VB":
        raise ApiError(400, "BAD_CODE_FORMAT", f"유효하지 않은 코드입니다: {code}")
    if not verify_check(norm, check):
        raise ApiError(400, "BAD_CHECKCODE", "유효하지 않은 코드입니다 (체크코드 불일치)")
    return kind, norm


async def _has_pending(session: AsyncSession, wo_id: int) -> bool:
    stmt = select(exists().where(ScanEvent.wo_id == wo_id, ScanEvent.approval_status == "PENDING"))
    return bool((await session.execute(stmt)).scalar_one())


async def _wo_actions(session: AsyncSession, wo: WorkOrder, user: AppUser) -> list[str]:
    actions = ["VIEW_DETAIL"]
    if user.role in REPRINT_ROLES and wo.status in WO_ISSUED_LIKE:
        actions.append("REPRINT")
    if user.role in MANAGE_ROLES:
        if wo.status in WO_HOLDABLE:
            actions.append("HOLD")
            if wo.parent_wo_id is None:
                actions.append("SPLIT")
        if await _has_pending(session, wo.id):
            actions.append("APPROVE_PENDING")
    return actions


async def landing(
    session: AsyncSession, code: str, check: str | None, user: AppUser | None
) -> S.QrLanding:
    kind, norm = _parse(code, check)
    summary: dict[str, Any]
    actions: list[str] = []

    if kind == "SO":
        so = (
            await session.execute(select(SalesOrder).where(SalesOrder.code == norm))
        ).scalar_one_or_none()
        if so is None:
            raise not_found("SO_NOT_FOUND", "수주", norm)
        summary = so_summary((await load_so_views(session, [so]))[0]).model_dump()
        if user is not None:
            actions = ["VIEW_DETAIL"]
    elif kind == "WO":
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.code == norm))
        ).scalar_one_or_none()
        if wo is None:
            raise not_found("WO_NOT_FOUND", "작업지시", norm)
        view = (await load_wo_views(session, [wo]))[0]
        summary = wo_summary(view, with_thumbnail=user is not None).model_dump()
        if user is not None:
            actions = await _wo_actions(session, wo, user)
    elif kind == "US":
        u = (
            await session.execute(select(AppUser).where(AppUser.card_code == norm))
        ).scalar_one_or_none()
        if u is None or not u.active:
            raise not_found("USER_CARD_NOT_FOUND", "작업자 카드", norm)
        full = user_summary(u).model_dump()
        summary = full if user is not None else {k: full[k] for k in ("name", "role", "card_code")}
        if user is not None and user.role in MANAGE_ROLES:
            actions = ["VIEW_DETAIL"]
    else:  # LT — S3 자재·출하 웨이브
        raise not_found("LOT_NOT_FOUND", "LOT", norm)

    return S.QrLanding(
        type=kind,
        code=norm,
        summary=summary,
        allowed_actions=actions,
    )

"""기준정보 서비스 (api-contract §7.2 · §13.3). 거래처(+배송지) · 품목 · 품목군 · 가공방식 · 공정 ·
설비 · 라우팅.

규칙
- 물리 DELETE 없음. 비활성 = ``active=false``, 재활성 = ``activate`` (admin #3).
- 중복 코드 409 ``DUPLICATE_CODE``, 없는 참조 404 ``*_NOT_FOUND``.
- audit_log 는 ``app.db.audit`` 훅이 flush 시점에 자동 기록한다.
- 변경 함수는 commit 까지 하고 갱신된 ORM 객체를 돌려준다.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.v1.schemas import master as S
from app.core.errors import ApiError, duplicate_code, not_found, validation
from app.db.models.enums import EquipType
from app.db.models.master import (
    Carrier,
    Customer,
    CustomerAddress,
    Equipment,
    Item,
    ItemGroup,
    ItemRouting,
    PrintMethod,
    Process,
    RoutingStep,
)
from app.domain.common.listing import PageParams, paginate, parse_sort, q_filter

# ---- 정렬·검색 허용 표 (admin #4 · #5) ----
CUSTOMER_SORT: dict[str, Any] = {
    "code": Customer.code,
    "name": Customer.name,
    "updated_at": Customer.updated_at,
}
CUSTOMER_Q = (Customer.code, Customer.name, Customer.contact_name, Customer.phone)
ITEM_SORT: dict[str, Any] = {
    "code": Item.code,
    "name": Item.name,
    "item_group": Item.item_group,
    "updated_at": Item.updated_at,
}
ITEM_Q = (Item.code, Item.name, Item.spec, Item.color, Item.vendor_barcode)
EQUIPMENT_SORT: dict[str, Any] = {"code": Equipment.code, "name": Equipment.name}
EQUIPMENT_Q = (Equipment.code, Equipment.name)
ROUTING_SORT: dict[str, Any] = {
    "item_group": ItemRouting.item_group,
    "print_method": ItemRouting.print_method,
}

REQUIRED_INPUTS = frozenset(
    {"qty", "box_count", "inspection", "equipment", "qty_good", "qty_bad", "qty_box", "tracking_no"}
)


def _apply(obj: Any, data: dict[str, Any]) -> None:
    for k, v in data.items():
        setattr(obj, k, v)


# ======================================================================
# 택배사 검증 (admin #6): carrier 활성 행이 있으면 그 code 만, 0행이면 자유 입력
# ======================================================================
async def check_carrier(session: AsyncSession, carrier: str | None, loc: list[str | int]) -> None:
    if carrier is None:
        return
    codes = (
        (await session.execute(select(Carrier.code).where(Carrier.active.is_(True))))
        .scalars()
        .all()
    )
    if codes and carrier not in codes:
        raise validation(
            loc, f"등록된 택배사가 아닙니다: {carrier} (허용: {', '.join(codes)})", "BAD_CARRIER"
        )


# ======================================================================
# 거래처
# ======================================================================
async def list_customers(
    session: AsyncSession,
    params: PageParams,
    *,
    q: str | None,
    active: bool | None,
    sort: str | None,
) -> tuple[list[Customer], int]:
    stmt = select(Customer).options(selectinload(Customer.addresses))
    if active is not None:
        stmt = stmt.where(Customer.active.is_(active))
    if (f := q_filter(q, CUSTOMER_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, CUSTOMER_SORT))
    return await paginate(session, stmt, params)


async def get_customer(
    session: AsyncSession, customer_id: int, *, with_addresses: bool = False
) -> Customer:
    stmt = select(Customer).where(Customer.id == customer_id)
    if with_addresses:
        stmt = stmt.options(selectinload(Customer.addresses))
    c = (await session.execute(stmt)).scalar_one_or_none()
    if c is None:
        raise not_found("CUSTOMER_NOT_FOUND", "거래처", customer_id)
    return c


async def create_customer(session: AsyncSession, body: S.CustomerCreate) -> Customer:
    exists = (await session.execute(select(Customer.id).where(Customer.code == body.code))).first()
    if exists:
        raise duplicate_code("거래처", body.code)
    await check_carrier(session, body.default_carrier, ["body", "default_carrier"])
    c = Customer(**body.model_dump())
    session.add(c)
    await session.commit()
    return await get_customer(session, c.id, with_addresses=True)


async def update_customer(
    session: AsyncSession, customer_id: int, body: S.CustomerUpdate
) -> Customer:
    c = await get_customer(session, customer_id)
    data = body.model_dump(exclude_unset=True)
    if "default_carrier" in data:
        await check_carrier(session, data["default_carrier"], ["body", "default_carrier"])
    _apply(c, data)
    await session.commit()
    return await get_customer(session, customer_id, with_addresses=True)


async def set_customer_active(session: AsyncSession, customer_id: int, active: bool) -> Customer:
    c = await get_customer(session, customer_id)
    c.active = active
    await session.commit()
    return await get_customer(session, customer_id, with_addresses=True)


# ---- 배송지 (admin #7 · #8) ----
async def list_addresses(session: AsyncSession, customer_id: int) -> list[CustomerAddress]:
    await get_customer(session, customer_id)
    rows = await session.execute(
        select(CustomerAddress)
        .where(CustomerAddress.customer_id == customer_id)
        .order_by(CustomerAddress.is_default.desc(), CustomerAddress.id)
    )
    return list(rows.scalars().all())


async def get_address(session: AsyncSession, customer_id: int, addr_id: int) -> CustomerAddress:
    a = (
        await session.execute(
            select(CustomerAddress).where(
                CustomerAddress.id == addr_id, CustomerAddress.customer_id == customer_id
            )
        )
    ).scalar_one_or_none()
    if a is None:
        raise not_found("ADDRESS_NOT_FOUND", "배송지", addr_id)
    return a


async def _clear_default(session: AsyncSession, customer_id: int, except_id: int | None) -> None:
    """같은 거래처의 다른 기본 배송지를 해제 (admin #8: 409 없음, 자동 해제). ORM 으로 갱신해 감사
    로그에 남긴다.
    """
    rows = (
        await session.execute(
            select(CustomerAddress).where(
                CustomerAddress.customer_id == customer_id, CustomerAddress.is_default.is_(True)
            )
        )
    ).scalars()
    for row in rows:
        if row.id != except_id:
            row.is_default = False
    await session.flush()


async def create_address(
    session: AsyncSession, customer_id: int, body: S.CustomerAddressInput
) -> CustomerAddress:
    await get_customer(session, customer_id)
    if body.is_default:
        await _clear_default(session, customer_id, None)
    a = CustomerAddress(customer_id=customer_id, **body.model_dump())
    session.add(a)
    await session.commit()
    return a


async def update_address(
    session: AsyncSession, customer_id: int, addr_id: int, body: S.CustomerAddressUpdate
) -> CustomerAddress:
    a = await get_address(session, customer_id, addr_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("is_default"):
        await _clear_default(session, customer_id, a.id)
    _apply(a, data)
    await session.commit()
    return a


async def set_address_active(
    session: AsyncSession, customer_id: int, addr_id: int, active: bool
) -> CustomerAddress:
    a = await get_address(session, customer_id, addr_id)
    a.active = active
    if not active:
        a.is_default = False  # 비활성 배송지는 기본이 될 수 없다 (기본값)
    await session.commit()
    return a


# ======================================================================
# 품목군 (admin #9)
# ======================================================================
async def list_item_groups(session: AsyncSession, *, active: bool | None) -> list[ItemGroup]:
    stmt = select(ItemGroup).order_by(ItemGroup.code)
    if active is not None:
        stmt = stmt.where(ItemGroup.active.is_(active))
    return list((await session.execute(stmt)).scalars().all())


async def get_item_group(session: AsyncSession, code: str) -> ItemGroup:
    g = await session.get(ItemGroup, code)
    if g is None:
        raise not_found("ITEM_GROUP_NOT_FOUND", "품목군", code)
    return g


async def require_active_item_group(session: AsyncSession, code: str) -> ItemGroup:
    """ItemCreate.item_group 은 활성 코드여야 한다 (admin #9, 404 ITEM_GROUP_NOT_FOUND)."""
    g = await session.get(ItemGroup, code)
    if g is None or not g.active:
        raise not_found("ITEM_GROUP_NOT_FOUND", "활성 품목군", code)
    return g


async def create_item_group(session: AsyncSession, body: S.ItemGroupCreate) -> ItemGroup:
    if await session.get(ItemGroup, body.code) is not None:
        raise duplicate_code("품목군", body.code)
    g = ItemGroup(**body.model_dump())
    session.add(g)
    await session.commit()
    return g


async def update_item_group(session: AsyncSession, code: str, body: S.ItemGroupUpdate) -> ItemGroup:
    g = await get_item_group(session, code)
    _apply(g, body.model_dump(exclude_unset=True))
    await session.commit()
    return g


async def set_item_group_active(session: AsyncSession, code: str, active: bool) -> ItemGroup:
    g = await get_item_group(session, code)
    g.active = active
    await session.commit()
    return g


# ======================================================================
# 품목
# ======================================================================
async def list_items(
    session: AsyncSession,
    params: PageParams,
    *,
    q: str | None,
    active: bool | None,
    item_group: str | None,
    barcode: str | None,
    sort: str | None,
) -> tuple[list[Item], int]:
    stmt = select(Item)
    if active is not None:
        stmt = stmt.where(Item.active.is_(active))
    if item_group:
        stmt = stmt.where(Item.item_group == item_group)
    if barcode:
        stmt = stmt.where(Item.vendor_barcode == barcode)
    if (f := q_filter(q, ITEM_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, ITEM_SORT))
    return await paginate(session, stmt, params)


async def get_item(session: AsyncSession, item_id: int) -> Item:
    i = await session.get(Item, item_id)
    if i is None:
        raise not_found("ITEM_NOT_FOUND", "품목", item_id)
    return i


async def create_item(session: AsyncSession, body: S.ItemCreate) -> Item:
    if (await session.execute(select(Item.id).where(Item.code == body.code))).first():
        raise duplicate_code("품목", body.code)
    await require_active_item_group(session, body.item_group)
    data = body.model_dump()
    if data.get("qty_tolerance_pct") is None:
        data.pop("qty_tolerance_pct", None)  # DB 기본 3.0
    i = Item(**data)
    session.add(i)
    await session.commit()
    await session.refresh(i)
    return i


async def update_item(session: AsyncSession, item_id: int, body: S.ItemUpdate) -> Item:
    i = await get_item(session, item_id)
    data = body.model_dump(exclude_unset=True)
    if "item_group" in data and data["item_group"] is not None:
        await require_active_item_group(session, data["item_group"])
    if data.get("qty_tolerance_pct") is None:
        data.pop("qty_tolerance_pct", None)  # NOT NULL — null 은 무시
    _apply(i, data)
    await session.commit()
    await session.refresh(i)
    return i


async def set_item_active(session: AsyncSession, item_id: int, active: bool) -> Item:
    i = await get_item(session, item_id)
    i.active = active
    await session.commit()
    await session.refresh(i)
    return i


# ======================================================================
# 가공방식
# ======================================================================
async def list_print_methods(session: AsyncSession, *, active: bool | None) -> list[PrintMethod]:
    stmt = select(PrintMethod).order_by(PrintMethod.code)
    if active is not None:
        stmt = stmt.where(PrintMethod.active.is_(active))
    return list((await session.execute(stmt)).scalars().all())


async def get_print_method(session: AsyncSession, code: str) -> PrintMethod:
    pm = await session.get(PrintMethod, code)
    if pm is None:
        raise not_found("PRINT_METHOD_NOT_FOUND", "가공방식", code)
    return pm


async def create_print_method(session: AsyncSession, body: S.PrintMethodCreate) -> PrintMethod:
    if await session.get(PrintMethod, body.code) is not None:
        raise duplicate_code("가공방식", body.code)
    pm = PrintMethod(**body.model_dump())
    session.add(pm)
    await session.commit()
    return pm


async def update_print_method(
    session: AsyncSession, code: str, body: S.PrintMethodUpdate
) -> PrintMethod:
    pm = await get_print_method(session, code)
    _apply(pm, body.model_dump(exclude_unset=True))
    await session.commit()
    return pm


async def set_print_method_active(session: AsyncSession, code: str, active: bool) -> PrintMethod:
    pm = await get_print_method(session, code)
    pm.active = active
    await session.commit()
    return pm


# ======================================================================
# 공정
# ======================================================================
async def list_processes(session: AsyncSession, *, active: bool | None) -> list[Process]:
    stmt = select(Process).order_by(Process.seq)
    if active is not None:
        stmt = stmt.where(Process.active.is_(active))
    return list((await session.execute(stmt)).scalars().all())


async def get_process(session: AsyncSession, code: str) -> Process:
    p = await session.get(Process, code)
    if p is None:
        raise not_found("PROCESS_NOT_FOUND", "공정", code)
    return p


def _check_required_inputs(values: Sequence[str]) -> None:
    bad = [v for v in values if v not in REQUIRED_INPUTS]
    if bad:
        raise validation(
            ["body", "required_inputs"],
            f"허용되지 않는 입력 항목: {', '.join(bad)} "
            f"(허용: {', '.join(sorted(REQUIRED_INPUTS))})",
            "BAD_REQUIRED_INPUT",
        )


async def _check_seq_free(session: AsyncSession, seq: int, except_code: str | None) -> None:
    row = (
        await session.execute(select(Process.code).where(Process.seq == seq))
    ).scalar_one_or_none()
    if row is not None and row != except_code:
        raise ApiError(409, "DUPLICATE_CODE", f"공정 순서 {seq} 은(는) {row} 이(가) 쓰고 있습니다")


async def create_process(session: AsyncSession, body: S.ProcessCreate) -> Process:
    if await session.get(Process, body.code) is not None:
        raise duplicate_code("공정", body.code)
    _check_required_inputs(body.required_inputs)
    await _check_seq_free(session, body.seq, None)
    p = Process(**body.model_dump())
    session.add(p)
    await session.commit()
    return p


async def update_process(session: AsyncSession, code: str, body: S.ProcessUpdate) -> Process:
    p = await get_process(session, code)
    data = body.model_dump(exclude_unset=True)
    if data.get("required_inputs") is not None:
        _check_required_inputs(data["required_inputs"])
    if data.get("seq") is not None:
        await _check_seq_free(session, data["seq"], code)
    _apply(p, {k: v for k, v in data.items() if v is not None})
    await session.commit()
    return p


async def reorder_processes(session: AsyncSession, codes: list[str]) -> list[Process]:
    """전체 공정 코드를 새 순서로 (seq = 10, 20, …). 누락·중복·미존재 → 422."""
    if len(set(codes)) != len(codes):
        raise validation(["body", "codes"], "코드가 중복되었습니다")
    all_codes = set((await session.execute(select(Process.code))).scalars().all())
    if set(codes) != all_codes:
        missing = sorted(all_codes - set(codes))
        unknown = sorted(set(codes) - all_codes)
        raise validation(
            ["body", "codes"],
            f"전체 공정 코드를 보내야 합니다. 누락: {missing or '없음'}, "
            f"미존재: {unknown or '없음'}",
        )
    rows = {p.code: p for p in (await session.execute(select(Process))).scalars()}
    # seq UNIQUE 라 두 단계로: 임시 음수 → 최종
    for idx, code in enumerate(codes, start=1):
        rows[code].seq = -idx
    await session.flush()
    for idx, code in enumerate(codes, start=1):
        rows[code].seq = idx * 10
    await session.commit()
    return await list_processes(session, active=None)


async def set_process_active(session: AsyncSession, code: str, active: bool) -> Process:
    p = await get_process(session, code)
    if not active:
        # admin #11: 활성 라우팅 단계가 참조하면 409 PROCESS_IN_USE (라우팅 id 목록을 detail 에)
        routing_ids = (
            (
                await session.execute(
                    select(RoutingStep.routing_id)
                    .join(ItemRouting, ItemRouting.id == RoutingStep.routing_id)
                    .where(RoutingStep.process_code == code, ItemRouting.active.is_(True))
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        if routing_ids:
            raise ApiError(
                409,
                "PROCESS_IN_USE",
                f"공정 {code} 을(를) 참조하는 활성 라우팅이 {len(routing_ids)}건 있습니다",
                [{"routing_ids": sorted(routing_ids)}],
            )
    p.active = active
    await session.commit()
    return p


# ======================================================================
# 설비
# ======================================================================
async def list_equipment(
    session: AsyncSession,
    params: PageParams,
    *,
    q: str | None,
    active: bool | None,
    equip_type: str | None,
    process_code: str | None,
    sort: str | None,
) -> tuple[list[Equipment], int]:
    stmt = select(Equipment)
    if active is not None:
        stmt = stmt.where(Equipment.active.is_(active))
    if equip_type:
        stmt = stmt.where(Equipment.equip_type == equip_type)
    if process_code:
        stmt = stmt.where(Equipment.process_code == process_code)
    if (f := q_filter(q, EQUIPMENT_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, EQUIPMENT_SORT))
    return await paginate(session, stmt, params)


async def get_equipment(session: AsyncSession, equipment_id: int) -> Equipment:
    e = await session.get(Equipment, equipment_id)
    if e is None:
        raise not_found("EQUIPMENT_NOT_FOUND", "설비", equipment_id)
    return e


async def create_equipment(session: AsyncSession, body: S.EquipmentCreate) -> Equipment:
    if (await session.execute(select(Equipment.id).where(Equipment.code == body.code))).first():
        raise duplicate_code("설비", body.code)
    await get_process(session, body.process_code)
    e = Equipment(**body.model_dump())
    session.add(e)
    await session.commit()
    await session.refresh(e)
    return e


async def update_equipment(
    session: AsyncSession, equipment_id: int, body: S.EquipmentUpdate
) -> Equipment:
    e = await get_equipment(session, equipment_id)
    data = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    if "process_code" in data:
        await get_process(session, data["process_code"])
    _apply(e, data)
    await session.commit()
    await session.refresh(e)
    return e


async def set_equipment_active(session: AsyncSession, equipment_id: int, active: bool) -> Equipment:
    e = await get_equipment(session, equipment_id)
    e.active = active
    await session.commit()
    await session.refresh(e)
    return e


# ======================================================================
# 라우팅
# ======================================================================
def _routing_stmt() -> Any:
    return select(ItemRouting).options(selectinload(ItemRouting.steps))


async def list_routings(
    session: AsyncSession,
    params: PageParams,
    *,
    active: bool | None,
    item_group: str | None,
    print_method: str | None,
    sort: str | None,
) -> tuple[list[ItemRouting], int]:
    stmt = _routing_stmt()
    if active is not None:
        stmt = stmt.where(ItemRouting.active.is_(active))
    if item_group:
        stmt = stmt.where(ItemRouting.item_group == item_group)
    if print_method:
        stmt = stmt.where(ItemRouting.print_method == print_method)
    stmt = stmt.order_by(*parse_sort(sort, ROUTING_SORT))
    return await paginate(session, stmt, params)


async def get_routing(session: AsyncSession, routing_id: int) -> ItemRouting:
    r = (
        await session.execute(_routing_stmt().where(ItemRouting.id == routing_id))
    ).scalar_one_or_none()
    if r is None:
        raise not_found("ROUTING_NOT_FOUND", "라우팅", routing_id)
    return r


async def resolve_routing(session: AsyncSession, item_group: str, print_method: str) -> ItemRouting:
    """품목군 × 가공방식 → 활성 라우팅 (없으면 404 ROUTING_NOT_FOUND)."""
    r = (
        await session.execute(
            _routing_stmt().where(
                ItemRouting.item_group == item_group,
                ItemRouting.print_method == print_method,
                ItemRouting.active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if r is None:
        raise ApiError(
            404,
            "ROUTING_NOT_FOUND",
            f"해당 조합의 라우팅이 없습니다: 품목군 {item_group} × 가공방식 {print_method}",
        )
    return r


async def _validate_steps(session: AsyncSession, steps: Sequence[S.RoutingStepInput]) -> None:
    seqs = [s.seq for s in steps]
    if len(set(seqs)) != len(seqs):
        raise validation(["body", "steps"], "단계 순서(seq)가 중복되었습니다")
    codes = [s.process_code for s in steps]
    if len(set(codes)) != len(codes):
        raise validation(["body", "steps"], "같은 공정을 두 번 넣을 수 없습니다")
    active_codes = set(
        (await session.execute(select(Process.code).where(Process.active.is_(True))))
        .scalars()
        .all()
    )
    unknown = sorted(set(codes) - active_codes)
    if unknown:
        raise validation(["body", "steps"], f"활성 공정이 아닙니다: {', '.join(unknown)}")


async def create_routing(session: AsyncSession, body: S.RoutingCreate) -> ItemRouting:
    await require_active_item_group(session, body.item_group)
    await get_print_method(session, body.print_method)
    dup = (
        await session.execute(
            select(ItemRouting.id).where(
                ItemRouting.item_group == body.item_group,
                ItemRouting.print_method == body.print_method,
            )
        )
    ).first()
    if dup:
        raise ApiError(
            409,
            "DUPLICATE_CODE",
            f"라우팅 {body.item_group} × {body.print_method} 이(가) 이미 있습니다",
        )
    await _validate_steps(session, body.steps)
    r = ItemRouting(item_group=body.item_group, print_method=body.print_method)
    session.add(r)
    await session.flush()
    for s in sorted(body.steps, key=lambda x: x.seq):
        session.add(RoutingStep(routing_id=r.id, **s.model_dump()))
    await session.commit()
    return await get_routing(session, r.id)


async def replace_routing_steps(
    session: AsyncSession, routing_id: int, steps: Sequence[S.RoutingStepInput]
) -> ItemRouting:
    """단계 통째 교체 (PUT). 발행된 WO 의 스냅샷(wo_route_step)은 바뀌지 않는다."""
    r = await get_routing(session, routing_id)
    await _validate_steps(session, steps)
    for old in list(r.steps):
        await session.delete(old)
    await session.flush()
    for s in sorted(steps, key=lambda x: x.seq):
        session.add(RoutingStep(routing_id=r.id, **s.model_dump()))
    await session.commit()
    session.expire(r)
    return await get_routing(session, routing_id)


async def update_routing(
    session: AsyncSession, routing_id: int, body: S.RoutingUpdate
) -> ItemRouting:
    r = await get_routing(session, routing_id)
    if body.active is not None:
        r.active = body.active
    await session.commit()
    return await get_routing(session, routing_id)


async def set_routing_active(session: AsyncSession, routing_id: int, active: bool) -> ItemRouting:
    r = await get_routing(session, routing_id)
    r.active = active
    await session.commit()
    return await get_routing(session, routing_id)


EQUIP_TYPES = tuple(e.value for e in EquipType)

"""기준정보 라우터 (api-contract §7.2 · §13.1 · §13.3) —
거래처·배송지·품목·품목군·가공방식·공정·설비·라우팅.

상태코드 (admin #34): 생성 POST 201, 액션 POST(activate/deactivate/reorder) 200.
소형 마스터(print-methods · processes · item-groups · addresses)는 배열 응답 (admin #7).
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import permissions as P
from app.api.deps import Session, require_roles
from app.api.v1.schemas import master as S
from app.api.v1.schemas.common import ApiModel, Page
from app.domain.common.listing import PageDep, PageParams
from app.domain.master import service as svc

router = APIRouter(tags=["master"])

_rw_customer = Depends(require_roles(*P.CUSTOMER_ITEM_READ, station=True))
_w_customer = Depends(require_roles(*P.CUSTOMER_ITEM_WRITE))
_r_routing = Depends(require_roles(*P.ROUTING_READ, station=True))
_w_routing = Depends(require_roles(*P.ROUTING_WRITE))
_w_item_group = Depends(require_roles(*P.ITEM_GROUP_WRITE))
_w_process_create = Depends(require_roles(*P.PROCESS_CREATE))


def _page(
    items: Sequence[object], total: int, params: PageParams, model: type[ApiModel]
) -> dict[str, object]:
    return {
        "items": [model.model_validate(i) for i in items],
        "page": params.page,
        "size": params.size,
        "total": total,
    }


# ======================================================================
# 거래처
# ======================================================================
@router.get("/customers", response_model=Page[S.Customer], dependencies=[_rw_customer])
async def list_customers(
    params: PageParams = PageDep,
    q: str | None = None,
    active: bool | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_customers(session, params, q=q, active=active, sort=sort)
    return _page(items, total, params, S.Customer)


@router.post("/customers", response_model=S.Customer, status_code=201, dependencies=[_w_customer])
async def create_customer(body: S.CustomerCreate, session: AsyncSession = Session) -> S.Customer:
    return S.Customer.model_validate(await svc.create_customer(session, body))


@router.get("/customers/{customer_id}", response_model=S.Customer, dependencies=[_rw_customer])
async def get_customer(customer_id: int, session: AsyncSession = Session) -> S.Customer:
    return S.Customer.model_validate(
        await svc.get_customer(session, customer_id, with_addresses=True)
    )


@router.patch("/customers/{customer_id}", response_model=S.Customer, dependencies=[_w_customer])
async def update_customer(
    customer_id: int, body: S.CustomerUpdate, session: AsyncSession = Session
) -> S.Customer:
    return S.Customer.model_validate(await svc.update_customer(session, customer_id, body))


@router.post(
    "/customers/{customer_id}/deactivate", response_model=S.Customer, dependencies=[_w_customer]
)
async def deactivate_customer(customer_id: int, session: AsyncSession = Session) -> S.Customer:
    return S.Customer.model_validate(await svc.set_customer_active(session, customer_id, False))


@router.post(
    "/customers/{customer_id}/activate", response_model=S.Customer, dependencies=[_w_customer]
)
async def activate_customer(customer_id: int, session: AsyncSession = Session) -> S.Customer:
    return S.Customer.model_validate(await svc.set_customer_active(session, customer_id, True))


@router.get(
    "/customers/{customer_id}/addresses",
    response_model=list[S.CustomerAddress],
    dependencies=[_rw_customer],
)
async def list_addresses(
    customer_id: int, session: AsyncSession = Session
) -> list[S.CustomerAddress]:
    return [
        S.CustomerAddress.model_validate(a) for a in await svc.list_addresses(session, customer_id)
    ]


@router.post(
    "/customers/{customer_id}/addresses",
    response_model=S.CustomerAddress,
    status_code=201,
    dependencies=[_w_customer],
)
async def create_address(
    customer_id: int, body: S.CustomerAddressInput, session: AsyncSession = Session
) -> S.CustomerAddress:
    return S.CustomerAddress.model_validate(await svc.create_address(session, customer_id, body))


@router.patch(
    "/customers/{customer_id}/addresses/{addr_id}",
    response_model=S.CustomerAddress,
    dependencies=[_w_customer],
)
async def update_address(
    customer_id: int, addr_id: int, body: S.CustomerAddressUpdate, session: AsyncSession = Session
) -> S.CustomerAddress:
    return S.CustomerAddress.model_validate(
        await svc.update_address(session, customer_id, addr_id, body)
    )


@router.post(
    "/customers/{customer_id}/addresses/{addr_id}/deactivate",
    response_model=S.CustomerAddress,
    dependencies=[_w_customer],
)
async def deactivate_address(
    customer_id: int, addr_id: int, session: AsyncSession = Session
) -> S.CustomerAddress:
    return S.CustomerAddress.model_validate(
        await svc.set_address_active(session, customer_id, addr_id, False)
    )


@router.post(
    "/customers/{customer_id}/addresses/{addr_id}/activate",
    response_model=S.CustomerAddress,
    dependencies=[_w_customer],
)
async def activate_address(
    customer_id: int, addr_id: int, session: AsyncSession = Session
) -> S.CustomerAddress:
    return S.CustomerAddress.model_validate(
        await svc.set_address_active(session, customer_id, addr_id, True)
    )


# ======================================================================
# 품목군 (admin #9)
# ======================================================================
@router.get("/item-groups", response_model=list[S.ItemGroup], dependencies=[_rw_customer])
async def list_item_groups(
    active: bool | None = None, session: AsyncSession = Session
) -> list[S.ItemGroup]:
    return [
        S.ItemGroup.model_validate(g) for g in await svc.list_item_groups(session, active=active)
    ]


@router.post(
    "/item-groups", response_model=S.ItemGroup, status_code=201, dependencies=[_w_item_group]
)
async def create_item_group(
    body: S.ItemGroupCreate, session: AsyncSession = Session
) -> S.ItemGroup:
    return S.ItemGroup.model_validate(await svc.create_item_group(session, body))


@router.patch("/item-groups/{code}", response_model=S.ItemGroup, dependencies=[_w_item_group])
async def update_item_group(
    code: str, body: S.ItemGroupUpdate, session: AsyncSession = Session
) -> S.ItemGroup:
    return S.ItemGroup.model_validate(await svc.update_item_group(session, code, body))


@router.post(
    "/item-groups/{code}/deactivate", response_model=S.ItemGroup, dependencies=[_w_item_group]
)
async def deactivate_item_group(code: str, session: AsyncSession = Session) -> S.ItemGroup:
    return S.ItemGroup.model_validate(await svc.set_item_group_active(session, code, False))


@router.post(
    "/item-groups/{code}/activate", response_model=S.ItemGroup, dependencies=[_w_item_group]
)
async def activate_item_group(code: str, session: AsyncSession = Session) -> S.ItemGroup:
    return S.ItemGroup.model_validate(await svc.set_item_group_active(session, code, True))


# ======================================================================
# 품목
# ======================================================================
@router.get("/items", response_model=Page[S.Item], dependencies=[_rw_customer])
async def list_items(
    params: PageParams = PageDep,
    q: str | None = None,
    active: bool | None = None,
    item_group: str | None = None,
    barcode: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_items(
        session, params, q=q, active=active, item_group=item_group, barcode=barcode, sort=sort
    )
    return _page(items, total, params, S.Item)


@router.post("/items", response_model=S.Item, status_code=201, dependencies=[_w_customer])
async def create_item(body: S.ItemCreate, session: AsyncSession = Session) -> S.Item:
    return S.Item.model_validate(await svc.create_item(session, body))


@router.get("/items/{item_id}", response_model=S.Item, dependencies=[_rw_customer])
async def get_item(item_id: int, session: AsyncSession = Session) -> S.Item:
    return S.Item.model_validate(await svc.get_item(session, item_id))


@router.patch("/items/{item_id}", response_model=S.Item, dependencies=[_w_customer])
async def update_item(item_id: int, body: S.ItemUpdate, session: AsyncSession = Session) -> S.Item:
    return S.Item.model_validate(await svc.update_item(session, item_id, body))


@router.post("/items/{item_id}/deactivate", response_model=S.Item, dependencies=[_w_customer])
async def deactivate_item(item_id: int, session: AsyncSession = Session) -> S.Item:
    return S.Item.model_validate(await svc.set_item_active(session, item_id, False))


@router.post("/items/{item_id}/activate", response_model=S.Item, dependencies=[_w_customer])
async def activate_item(item_id: int, session: AsyncSession = Session) -> S.Item:
    return S.Item.model_validate(await svc.set_item_active(session, item_id, True))


# ======================================================================
# 가공방식
# ======================================================================
@router.get("/print-methods", response_model=list[S.PrintMethod], dependencies=[_r_routing])
async def list_print_methods(
    active: bool | None = None, session: AsyncSession = Session
) -> list[S.PrintMethod]:
    return [
        S.PrintMethod.model_validate(p)
        for p in await svc.list_print_methods(session, active=active)
    ]


@router.post(
    "/print-methods", response_model=S.PrintMethod, status_code=201, dependencies=[_w_routing]
)
async def create_print_method(
    body: S.PrintMethodCreate, session: AsyncSession = Session
) -> S.PrintMethod:
    return S.PrintMethod.model_validate(await svc.create_print_method(session, body))


@router.get("/print-methods/{code}", response_model=S.PrintMethod, dependencies=[_r_routing])
async def get_print_method(code: str, session: AsyncSession = Session) -> S.PrintMethod:
    return S.PrintMethod.model_validate(await svc.get_print_method(session, code))


@router.patch("/print-methods/{code}", response_model=S.PrintMethod, dependencies=[_w_routing])
async def update_print_method(
    code: str, body: S.PrintMethodUpdate, session: AsyncSession = Session
) -> S.PrintMethod:
    return S.PrintMethod.model_validate(await svc.update_print_method(session, code, body))


@router.post(
    "/print-methods/{code}/deactivate", response_model=S.PrintMethod, dependencies=[_w_routing]
)
async def deactivate_print_method(code: str, session: AsyncSession = Session) -> S.PrintMethod:
    return S.PrintMethod.model_validate(await svc.set_print_method_active(session, code, False))


@router.post(
    "/print-methods/{code}/activate", response_model=S.PrintMethod, dependencies=[_w_routing]
)
async def activate_print_method(code: str, session: AsyncSession = Session) -> S.PrintMethod:
    return S.PrintMethod.model_validate(await svc.set_print_method_active(session, code, True))


# ======================================================================
# 공정
# ======================================================================
@router.get("/processes", response_model=list[S.Process], dependencies=[_r_routing])
async def list_processes(
    active: bool | None = None, session: AsyncSession = Session
) -> list[S.Process]:
    return [S.Process.model_validate(p) for p in await svc.list_processes(session, active=active)]


@router.post(
    "/processes", response_model=S.Process, status_code=201, dependencies=[_w_process_create]
)
async def create_process(body: S.ProcessCreate, session: AsyncSession = Session) -> S.Process:
    return S.Process.model_validate(await svc.create_process(session, body))


@router.post("/processes/reorder", response_model=list[S.Process], dependencies=[_w_routing])
async def reorder_processes(
    body: S.ProcessReorderRequest, session: AsyncSession = Session
) -> list[S.Process]:
    return [S.Process.model_validate(p) for p in await svc.reorder_processes(session, body.codes)]


@router.get("/processes/{code}", response_model=S.Process, dependencies=[_r_routing])
async def get_process(code: str, session: AsyncSession = Session) -> S.Process:
    return S.Process.model_validate(await svc.get_process(session, code))


@router.patch("/processes/{code}", response_model=S.Process, dependencies=[_w_routing])
async def update_process(
    code: str, body: S.ProcessUpdate, session: AsyncSession = Session
) -> S.Process:
    return S.Process.model_validate(await svc.update_process(session, code, body))


@router.post("/processes/{code}/deactivate", response_model=S.Process, dependencies=[_w_routing])
async def deactivate_process(code: str, session: AsyncSession = Session) -> S.Process:
    return S.Process.model_validate(await svc.set_process_active(session, code, False))


@router.post("/processes/{code}/activate", response_model=S.Process, dependencies=[_w_routing])
async def activate_process(code: str, session: AsyncSession = Session) -> S.Process:
    return S.Process.model_validate(await svc.set_process_active(session, code, True))


# ======================================================================
# 설비
# ======================================================================
@router.get("/equipment", response_model=Page[S.Equipment], dependencies=[_r_routing])
async def list_equipment(
    params: PageParams = PageDep,
    q: str | None = None,
    active: bool | None = None,
    equip_type: S.EquipType | None = None,
    process_code: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_equipment(
        session,
        params,
        q=q,
        active=active,
        equip_type=equip_type,
        process_code=process_code,
        sort=sort,
    )
    return _page(items, total, params, S.Equipment)


@router.post("/equipment", response_model=S.Equipment, status_code=201, dependencies=[_w_routing])
async def create_equipment(body: S.EquipmentCreate, session: AsyncSession = Session) -> S.Equipment:
    return S.Equipment.model_validate(await svc.create_equipment(session, body))


@router.get("/equipment/{equipment_id}", response_model=S.Equipment, dependencies=[_r_routing])
async def get_equipment(equipment_id: int, session: AsyncSession = Session) -> S.Equipment:
    return S.Equipment.model_validate(await svc.get_equipment(session, equipment_id))


@router.patch("/equipment/{equipment_id}", response_model=S.Equipment, dependencies=[_w_routing])
async def update_equipment(
    equipment_id: int, body: S.EquipmentUpdate, session: AsyncSession = Session
) -> S.Equipment:
    return S.Equipment.model_validate(await svc.update_equipment(session, equipment_id, body))


@router.post(
    "/equipment/{equipment_id}/deactivate", response_model=S.Equipment, dependencies=[_w_routing]
)
async def deactivate_equipment(equipment_id: int, session: AsyncSession = Session) -> S.Equipment:
    return S.Equipment.model_validate(await svc.set_equipment_active(session, equipment_id, False))


@router.post(
    "/equipment/{equipment_id}/activate", response_model=S.Equipment, dependencies=[_w_routing]
)
async def activate_equipment(equipment_id: int, session: AsyncSession = Session) -> S.Equipment:
    return S.Equipment.model_validate(await svc.set_equipment_active(session, equipment_id, True))


# ======================================================================
# 라우팅 — /routings/resolve 는 /routings/{id} 보다 먼저
# ======================================================================
@router.get("/routings/resolve", response_model=S.Routing, dependencies=[_r_routing])
async def resolve_routing(
    item_group: str = Query(min_length=1),
    print_method: str = Query(min_length=1),
    session: AsyncSession = Session,
) -> S.Routing:
    return S.Routing.model_validate(await svc.resolve_routing(session, item_group, print_method))


@router.get("/routings", response_model=Page[S.Routing], dependencies=[_r_routing])
async def list_routings(
    params: PageParams = PageDep,
    active: bool | None = None,
    item_group: str | None = None,
    print_method: str | None = None,
    sort: str | None = None,
    session: AsyncSession = Session,
) -> dict[str, object]:
    items, total = await svc.list_routings(
        session, params, active=active, item_group=item_group, print_method=print_method, sort=sort
    )
    return _page(items, total, params, S.Routing)


@router.post("/routings", response_model=S.Routing, status_code=201, dependencies=[_w_routing])
async def create_routing(body: S.RoutingCreate, session: AsyncSession = Session) -> S.Routing:
    return S.Routing.model_validate(await svc.create_routing(session, body))


@router.get("/routings/{routing_id}", response_model=S.Routing, dependencies=[_r_routing])
async def get_routing(routing_id: int, session: AsyncSession = Session) -> S.Routing:
    return S.Routing.model_validate(await svc.get_routing(session, routing_id))


@router.patch("/routings/{routing_id}", response_model=S.Routing, dependencies=[_w_routing])
async def update_routing(
    routing_id: int, body: S.RoutingUpdate, session: AsyncSession = Session
) -> S.Routing:
    return S.Routing.model_validate(await svc.update_routing(session, routing_id, body))


@router.put("/routings/{routing_id}/steps", response_model=S.Routing, dependencies=[_w_routing])
async def put_routing_steps(
    routing_id: int, body: S.RoutingStepsPut, session: AsyncSession = Session
) -> S.Routing:
    return S.Routing.model_validate(
        await svc.replace_routing_steps(session, routing_id, body.steps)
    )


@router.post(
    "/routings/{routing_id}/deactivate", response_model=S.Routing, dependencies=[_w_routing]
)
async def deactivate_routing(routing_id: int, session: AsyncSession = Session) -> S.Routing:
    return S.Routing.model_validate(await svc.set_routing_active(session, routing_id, False))


@router.post("/routings/{routing_id}/activate", response_model=S.Routing, dependencies=[_w_routing])
async def activate_routing(routing_id: int, session: AsyncSession = Session) -> S.Routing:
    return S.Routing.model_validate(await svc.set_routing_active(session, routing_id, True))

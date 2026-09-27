"""라벨·PDF·프린터 테스트 공통 (개발A 의 수주 API 와 무관하게 ORM 으로 SO/WO 를 만든다)."""

from __future__ import annotations

import asyncio
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select

from app.core.sequence import next_code
from app.db.models.master import AppUser, Customer, Item, Printer
from app.db.models.order import SalesOrder, SalesOrderLine, WorkOrder, WoRouteStep
from app.db.session import SessionLocal
from tests.conftest import ensure_item_group, ensure_user, uniq

ROUTE = (("P20", "4.0"), ("P30", "24.0"), ("P50", "8.0"), ("P60", "4.0"))


def free_closed_port() -> int:
    """아무도 듣지 않는 포트 (connection refused 를 즉시 받는다)."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = int(s.getsockname()[1])
    s.close()
    return port


@asynccontextmanager
async def fake_printer() -> AsyncIterator[tuple[int, list[bytes]]]:
    """TCP 9100 흉내: 받은 바이트를 모은다. (port, received)."""
    received: list[bytes] = []

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        received.append(await reader.read())
        writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = int(server.sockets[0].getsockname()[1])
    try:
        yield port, received
    finally:
        server.close()
        await server.wait_closed()


async def ensure_printer(
    printer_id: str,
    *,
    purpose: str = "PACKING",
    port: int | None = None,
    active: bool = True,
    host: str = "127.0.0.1",
) -> str:
    async with SessionLocal() as s:
        p = await s.get(Printer, printer_id)
        if p is None:
            p = Printer(id=printer_id, name=printer_id, host=host, purpose=purpose)
            s.add(p)
        p.host = host
        p.port = port if port is not None else free_closed_port()
        p.purpose = purpose
        p.active = active
        await s.commit()
    return printer_id


async def deactivate_other_printers(keep: set[str]) -> None:
    """프린터 선택 순서 테스트용: 다른 테스트가 만든 활성 PACKING 프린터를 끈다."""
    async with SessionLocal() as s:
        for p in (await s.execute(select(Printer).where(Printer.active.is_(True)))).scalars():
            if p.id not in keep:
                p.active = False
        await s.commit()


async def make_so(
    *, with_wo: int = 1, issued: bool = True, item_spec: str | None = "40×80"
) -> dict[str, Any]:
    """거래처·품목·SO·라인·WO(n)·라우팅 스냅샷을 ORM 으로 만든다. 반환: 코드·id 묶음."""
    admin = await ensure_user("t_label_admin", "ADMIN", password="Admin1234x")
    group = await ensure_item_group("T_TOWEL_40", "테스트 40수")
    tag = uniq("")
    async with SessionLocal() as s:
        cust = Customer(code=f"C{tag}", name=f"라벨거래처 {tag}")
        item = Item(
            code=f"I{tag}",
            name=f"40수 타월 {tag}",
            item_group=group,
            spec=item_spec,
            color="화이트",
        )
        s.add_all([cust, item])
        await s.flush()
        so = SalesOrder(
            code=await next_code(s, "SO"),
            customer_id=cust.id,
            order_date=date(2026, 9, 28),
            due_date=date(2026, 10, 15),
            ship_to={"address1": "서울"},
            created_by=admin.id,
        )
        s.add(so)
        await s.flush()
        line = SalesOrderLine(
            so_id=so.id, line_no=1, item_id=item.id, print_method="SCREEN", qty=500
        )
        s.add(line)
        await s.flush()
        wos: list[str] = []
        for _ in range(with_wo):
            wo = WorkOrder(
                code=await next_code(s, "WO"),
                so_id=so.id,
                so_line_id=line.id,
                item_id=item.id,
                print_method="SCREEN",
                qty_ordered=500,
                status="ISSUED" if issued else "DRAFT",
                issued_at=datetime.now(UTC) if issued else None,
            )
            s.add(wo)
            await s.flush()
            for seq, (pc, hours) in enumerate(ROUTE, start=1):
                s.add(
                    WoRouteStep(
                        wo_id=wo.id,
                        seq=seq,
                        process_code=pc,
                        std_lead_hours=Decimal(hours),
                        tolerance_pct=Decimal("3.0"),
                    )
                )
            wos.append(wo.code)
        await s.commit()
        return {
            "so_code": so.code,
            "so_id": so.id,
            "customer_name": cust.name,
            "item_name": item.name,
            "wo_codes": wos,
            "admin": admin,
        }


async def worker_with_card(login_id: str) -> AppUser:
    u: AppUser = await ensure_user(login_id, "WORKER", pin="1234", card=True)
    return u

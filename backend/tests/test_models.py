"""스키마 (S0-2).

upgrade 후 전 테이블·뷰 존재 · CHECK 위반 INSERT 실패 3건 · scan_event 파티션 누락 INSERT 실패.
"""

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.db.base import SCHEMA, Base
from app.db.models import AppUser, Item, Printer, ScanEvent, Station
from app.db.session import SessionLocal

VIEWS = [
    "v_so_progress",
    "v_process_queue",
    "v_daily_output",
    "v_lead_time",
    "v_stock_current",
    "v_shipment_today",
    "v_lot_trace",
]


@pytest.mark.asyncio
async def test_all_model_tables_exist_after_upgrade() -> None:
    expected = {t.name for t in Base.metadata.sorted_tables}
    assert len(expected) == 37  # 0005 델타 +4 (label_template · app_setting · item_group · carrier)
    async with SessionLocal() as s:
        rows = await s.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = :s"), {"s": SCHEMA}
        )
        actual = set(rows.scalars().all())
        views = await s.execute(
            text("SELECT viewname FROM pg_views WHERE schemaname = :s"), {"s": SCHEMA}
        )
        partitions = await s.execute(
            text(
                "SELECT inhrelid::regclass::text FROM pg_inherits WHERE inhparent = (:t)::regclass"
            ),
            {"t": f"{SCHEMA}.scan_event"},
        )
        seeded = await s.execute(text(f"SELECT code FROM {SCHEMA}.process ORDER BY seq"))
    missing = expected - actual
    assert not missing, f"missing tables: {sorted(missing)}"
    assert set(VIEWS) <= set(views.scalars().all())
    assert len(partitions.scalars().all()) == 4  # 이번 달 + 3개월
    assert seeded.scalars().all() == ["P10", "P20", "P30", "P50", "P60"]  # P40 없음


@pytest.mark.asyncio
async def test_check_violation_user_role_rejected() -> None:
    async with SessionLocal() as s:
        s.add(AppUser(login_id=f"t-{uuid.uuid4().hex[:8]}", name="x", role="BOSS"))
        with pytest.raises(IntegrityError, match="ck_app_user_role"):
            await s.flush()
        await s.rollback()


@pytest.mark.asyncio
async def test_check_violation_item_tolerance_rejected() -> None:
    async with SessionLocal() as s:
        s.add(
            Item(
                code=f"IT-{uuid.uuid4().hex[:8]}",
                name="x",
                item_group="G",
                qty_tolerance_pct=99,
            )
        )
        with pytest.raises(IntegrityError, match="ck_item_qty_tolerance_pct"):
            await s.flush()
        await s.rollback()


@pytest.mark.asyncio
async def test_check_violation_printer_purpose_rejected() -> None:
    async with SessionLocal() as s:
        s.add(Printer(id=f"LP-{uuid.uuid4().hex[:6]}", name="x", host="h", purpose="OFFICE"))
        with pytest.raises(IntegrityError, match="ck_printer_purpose"):
            await s.flush()
        await s.rollback()


@pytest.mark.asyncio
async def test_scan_event_insert_without_partition_fails() -> None:
    """DEFAULT 파티션이 없어야 한다: 파티션 없는 월(10년 뒤)의 INSERT 는 실패로 드러난다."""
    far_future = datetime(2036, 6, 1, tzinfo=UTC)
    async with SessionLocal() as s:
        station = Station(
            id=f"T-{uuid.uuid4().hex[:6]}", type="KIOSK", api_key_hash="h", api_key_prefix="p"
        )
        s.add(station)
        await s.flush()
        s.add(
            ScanEvent(
                event_uuid=uuid.uuid4(),
                scanned_at=far_future,
                received_at=far_future,
                station_id=station.id,
                target_type="WO",
                target_code="WO-360601-0001",
                action="DONE",
                result="OK",
            )
        )
        with pytest.raises(DBAPIError, match="no partition of relation"):
            await s.flush()
        await s.rollback()


@pytest.mark.asyncio
async def test_scan_event_insert_into_current_partition_ok() -> None:
    now = datetime.now(UTC)
    async with SessionLocal() as s:
        station = Station(
            id=f"T-{uuid.uuid4().hex[:6]}", type="KIOSK", api_key_hash="h", api_key_prefix="p"
        )
        s.add(station)
        await s.flush()
        ev = ScanEvent(
            event_uuid=uuid.uuid4(),
            scanned_at=now,
            received_at=now,
            station_id=station.id,
            target_type="WO",
            target_code="WO-260928-0001",
            action="DONE",
            result="OK",
        )
        s.add(ev)
        await s.flush()
        assert ev.id is not None and ev.id > 0
        await s.rollback()

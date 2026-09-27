"""audit_log 훅 (db-schema §7.2): 대상 모델의 INSERT/UPDATE/DELETE 를 before/after JSON 으로 기록.

- ``before_flush`` 에서 dirty/deleted 의 변경 전·후를 잡고, ``after_flush_postexec`` 에서
  (IDENTITY PK 가 확정된 뒤) INSERT 를 포함해 AuditLog 행을 세션에 넣는다.
  ``Session.commit()`` 은 세션이 깨끗해질 때까지 flush 를 반복하므로 같은 트랜잭션에 실린다.
- 대상: customer · customer_address · item · item_group · process · equipment · print_method
  · item_routing · routing_step · station · app_user · printer · carrier · label_template ·
  app_setting
  · sales_order · sales_order_line · design (stock_txn[ADJUST] 는 재고 서비스가 명시적으로 쓴다).
- 잡음 컬럼(last_seen_at · updated_at · pin_failed_count · pin_locked_until)만 바뀐 UPDATE 는
  기록하지 않는다. 비밀 해시 컬럼은 값 대신 ``"<set>"``/None 으로 남긴다.
- 숫자 PK 는 ``row_id``, 자연키(문자열 PK) 테이블은 ``row_key=str(pk)`` (db-schema §15, 0006).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session, UOWTransaction

from app.core.request_context import current_request_id, current_user_id
from app.db.models.master import (
    AppSetting,
    AppUser,
    Carrier,
    Customer,
    CustomerAddress,
    Equipment,
    Item,
    ItemGroup,
    ItemRouting,
    LabelTemplate,
    Printer,
    PrintMethod,
    Process,
    RoutingStep,
    Station,
)
from app.db.models.ops import AuditLog
from app.db.models.order import Design, SalesOrder, SalesOrderLine

AUDITED_MODELS: tuple[type[Any], ...] = (
    Customer,
    CustomerAddress,
    Item,
    ItemGroup,
    Process,
    Equipment,
    PrintMethod,
    ItemRouting,
    RoutingStep,
    Station,
    AppUser,
    Printer,
    Carrier,
    LabelTemplate,
    AppSetting,
    SalesOrder,
    SalesOrderLine,
    Design,
)
NOISE_COLUMNS = frozenset({"last_seen_at", "updated_at", "pin_failed_count", "pin_locked_until"})
SECRET_COLUMNS = frozenset({"password_hash", "pin_hash", "api_key_hash"})

_PENDING_KEY = "_audit_pending"


@dataclass(slots=True)
class _Pending:
    obj: Any
    action: str
    before: dict[str, Any] | None
    after_snapshot: bool  # after_flush 에서 현재 상태를 after 로 찍을지


def _json_value(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, datetime | date):
        return v.isoformat()
    return v


def snapshot(obj: Any) -> dict[str, Any]:
    """컬럼 값 dict (JSON 직렬화 가능). 비밀 해시는 마스킹."""
    out: dict[str, Any] = {}
    for col in inspect(type(obj)).columns:
        key = col.key
        val = getattr(obj, key, None)
        if key in SECRET_COLUMNS:
            out[key] = "<set>" if val else None
        else:
            out[key] = _json_value(val)
    return out


def _row_ref(obj: Any) -> tuple[int | None, str | None]:
    """(row_id, row_key) — 숫자 PK 면 row_id, 자연키면 row_key."""
    pk_cols = inspect(type(obj)).primary_key
    val = getattr(obj, pk_cols[0].key)
    if isinstance(val, int):
        return val, None
    return None, str(val)


def _before_flush(session: Session, flush_context: UOWTransaction, instances: Any) -> None:
    pending: list[_Pending] = session.info.setdefault(_PENDING_KEY, [])
    for obj in session.new:
        if isinstance(obj, AUDITED_MODELS):
            pending.append(_Pending(obj, "INSERT", None, True))
    for obj in session.dirty:
        if not isinstance(obj, AUDITED_MODELS) or not session.is_modified(obj):
            continue
        before: dict[str, Any] = {}
        changed = False
        state = inspect(obj)
        for col in inspect(type(obj)).columns:
            hist = state.attrs[col.key].history
            if hist.has_changes():
                old = hist.deleted[0] if hist.deleted else None
                before[col.key] = "<set>" if col.key in SECRET_COLUMNS and old else _json_value(old)
                if col.key not in NOISE_COLUMNS:
                    changed = True
        if changed:
            pending.append(_Pending(obj, "UPDATE", before, True))
    for obj in session.deleted:
        if isinstance(obj, AUDITED_MODELS):
            pending.append(_Pending(obj, "DELETE", snapshot(obj), False))


def _after_flush_postexec(session: Session, flush_context: UOWTransaction) -> None:
    pending: list[_Pending] = session.info.get(_PENDING_KEY, [])
    if not pending:
        return
    session.info[_PENDING_KEY] = []
    user_id = current_user_id.get()
    request_id = current_request_id.get()
    for p in pending:
        row_id, row_key = _row_ref(p.obj)
        after = snapshot(p.obj) if p.after_snapshot else None
        before = p.before
        session.add(
            AuditLog(
                table_name=p.obj.__tablename__,
                row_id=row_id,
                row_key=row_key,
                action=p.action,
                before=before,
                after=after,
                user_id=user_id,
                request_id=request_id,
            )
        )


_installed = False


def install_audit_hooks() -> None:
    """앱 기동·테스트 시 1회.

    전역 Session 클래스에 리스너를 건다 (AsyncSession 의 sync 세션 포함).
    """
    global _installed
    if _installed:
        return
    event.listen(Session, "before_flush", _before_flush)
    event.listen(Session, "after_flush_postexec", _after_flush_postexec)
    _installed = True

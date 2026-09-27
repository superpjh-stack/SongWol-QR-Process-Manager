"""단말 · 사용자 · 코드 체계 설정 (api-contract §7.2 · §13.2 · §13.3).

- 단말: 생성/회전 응답에 ``api_key`` 평문 + ``setup_url`` + ``setup_qr_png`` 를 1회 포함 (admin
  #15).
  해시만 저장(SHA-256, ``app.core.apikey``). ``offline_state`` 는 app_setting
  STATION_OFFLINE_THRESHOLD 로 계산.
- 사용자: 비밀번호 정책(WEAK_PASSWORD) · PIN 정책 · WORKER/MANAGER 는 생성 시 카드 자동
  발급(shopfloor ⑥)
  · issue-card 는 US 채번 + label_issue(WORKER_CARD) (+ printer_id 면 즉시 ZPL 전송, admin #17).
- 코드 체계: app_setting CODE_SETTINGS. 접두사는 S0 에서 고정(파싱 정규식과 결합, 422 PREFIX_FIXED),
  세대 번호는 읽기 전용, seq_digits 만 변경 가능 → 채번(app.core.sequence)에 즉시 반영.
"""

from __future__ import annotations

import base64
import io
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import segno
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.schemas import master as S
from app.api.v1.schemas.order import LabelJob
from app.core.apikey import api_key_prefix, generate_api_key, hash_api_key
from app.core.config import get_settings
from app.core.errors import ApiError, duplicate_code, not_found, validation
from app.core.hashing import hash_secret
from app.core.security import is_valid_pin, password_problem
from app.core.sequence import next_code
from app.db.models.master import AppSetting, AppUser, Printer, Process, Station
from app.db.models.order import LabelIssue
from app.db.seed_data import APP_SETTING_ROWS
from app.domain.common.listing import PageParams, paginate, parse_sort, q_filter
from app.domain.label import zpl as zpl_mod

STATION_SORT: dict[str, Any] = {
    "id": Station.id,
    "type": Station.type,
    "last_seen_at": Station.last_seen_at,
}
STATION_Q = (Station.id, Station.location)
USER_SORT: dict[str, Any] = {
    "login_id": AppUser.login_id,
    "name": AppUser.name,
    "role": AppUser.role,
}
USER_Q = (AppUser.login_id, AppUser.name, AppUser.card_code)

PROCESS_REQUIRED_TYPES = frozenset({"KIOSK", "PDA", "TOUCHPC"})
CARD_DEFAULT_ROLES = frozenset({"WORKER", "MANAGER"})
STATION_LOGIN_ROLES = frozenset({"WORKER", "MANAGER", "ADMIN"})
CODE_SETTINGS_KEY = "CODE_SETTINGS"
OFFLINE_THRESHOLD_KEY = "STATION_OFFLINE_THRESHOLD"
FIXED_PREFIXES = {"SO": "SO", "WO": "WO", "LT": "LT", "US": "US"}
SETUP_QR_PX = 300


# ======================================================================
# app_setting
# ======================================================================
def _default_setting(key: str) -> Any:
    for row in APP_SETTING_ROWS:
        if row["key"] == key:
            return row["value"]
    raise KeyError(key)


async def get_setting(session: AsyncSession, key: str) -> Any:
    row = await session.get(AppSetting, key)
    return row.value if row is not None else _default_setting(key)


async def get_code_settings(session: AsyncSession) -> S.CodeSettings:
    return S.CodeSettings.model_validate(await get_setting(session, CODE_SETTINGS_KEY))


async def put_code_settings(
    session: AsyncSession, body: S.CodeSettings, user_id: int
) -> S.CodeSettings:
    current = await get_code_settings(session)
    if body.prefixes.model_dump() != FIXED_PREFIXES:
        raise validation(
            ["body", "prefixes"],
            "접두사는 S0 에서 SO/WO/LT/US 로 고정입니다 (코드 파싱 규칙과 결합) — "
            "변경은 계약 개정 대상",
            "PREFIX_FIXED",
        )
    if body.checkcode_key_generation != current.checkcode_key_generation:
        raise validation(
            ["body", "checkcode_key_generation"],
            "체크코드 비밀키 세대는 읽기 전용입니다 (회전은 인프라 작업)",
            "READ_ONLY_FIELD",
        )
    row = await session.get(AppSetting, CODE_SETTINGS_KEY)
    if row is None:
        row = AppSetting(key=CODE_SETTINGS_KEY, value=body.model_dump())
        session.add(row)
    else:
        row.value = body.model_dump()  # 새 dict 할당 → 변경 감지
    row.updated_by = user_id
    await session.commit()
    return await get_code_settings(session)


# ======================================================================
# 단말
# ======================================================================
def offline_state(
    last_seen_at: datetime | None, threshold: dict[str, Any], now: datetime | None = None
) -> str:
    """ONLINE / WARN / ERROR (admin #14). 한 번도 접속 안 한 단말은 ERROR (기본값)."""
    if last_seen_at is None:
        return "ERROR"
    now = now or datetime.now(UTC)
    minutes = (now - last_seen_at).total_seconds() / 60
    if minutes >= float(threshold.get("error_minutes", 1440)):
        return "ERROR"
    if minutes >= float(threshold.get("warn_minutes", 30)):
        return "WARN"
    return "ONLINE"


async def station_out(
    session: AsyncSession, st: Station, threshold: dict[str, Any] | None = None
) -> S.Station:
    threshold = (
        threshold if threshold is not None else await get_setting(session, OFFLINE_THRESHOLD_KEY)
    )
    return S.Station(
        id=st.id,
        type=st.type,
        process_code=st.process_code,
        location=st.location,
        api_key_prefix=st.api_key_prefix,
        last_seen_at=st.last_seen_at,
        active=st.active,
        printer_id=st.printer_id,
        offline_state=offline_state(st.last_seen_at, threshold),
    )


async def list_stations(
    session: AsyncSession,
    params: PageParams,
    *,
    q: str | None,
    active: bool | None,
    type_: str | None,
    sort: str | None,
) -> tuple[list[S.Station], int]:
    stmt = select(Station)
    if active is not None:
        stmt = stmt.where(Station.active.is_(active))
    if type_:
        stmt = stmt.where(Station.type == type_)
    if (f := q_filter(q, STATION_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, STATION_SORT))
    rows, total = await paginate(session, stmt, params)
    threshold = await get_setting(session, OFFLINE_THRESHOLD_KEY)
    return [await station_out(session, r, threshold) for r in rows], total


async def get_station(session: AsyncSession, station_id: str) -> Station:
    st = await session.get(Station, station_id)
    if st is None:
        raise not_found("STATION_NOT_FOUND", "단말", station_id)
    return st


async def _check_station_refs(
    session: AsyncSession, *, type_: str, process_code: str | None, printer_id: str | None
) -> None:
    if type_ in PROCESS_REQUIRED_TYPES and not process_code:
        raise validation(["body", "process_code"], f"{type_} 단말은 고정 공정코드가 필요합니다")
    if process_code is not None and await session.get(Process, process_code) is None:
        raise not_found("PROCESS_NOT_FOUND", "공정", process_code)
    if printer_id is not None and await session.get(Printer, printer_id) is None:
        raise not_found("PRINTER_NOT_FOUND", "프린터", printer_id)


def setup_payload(station: Station, api_key: str) -> tuple[str, str]:
    """(setup_url, setup_qr_png base64) — admin #15: ``{PUBLIC_HOST}/setup?s=&k=&p=&v=1``."""
    params: dict[str, str] = {"s": station.id, "k": api_key}
    if station.printer_id:
        params["p"] = station.printer_id
    params["v"] = "1"
    url = f"{get_settings().public_host.rstrip('/')}/setup?{urlencode(params)}"
    qr = segno.make(url, error="q")
    modules = qr.symbol_size(scale=1, border=2)[0]
    scale = max(1, SETUP_QR_PX // modules)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=scale, border=2)
    return url, base64.b64encode(buf.getvalue()).decode("ascii")


async def create_station(session: AsyncSession, body: S.StationCreate) -> S.StationCreated:
    if await session.get(Station, body.id) is not None:
        raise duplicate_code("단말", body.id)
    await _check_station_refs(
        session, type_=body.type, process_code=body.process_code, printer_id=body.printer_id
    )
    key = generate_api_key()
    st = Station(
        **body.model_dump(), api_key_hash=hash_api_key(key), api_key_prefix=api_key_prefix(key)
    )
    session.add(st)
    await session.commit()
    await session.refresh(st)
    url, png = setup_payload(st, key)
    base = await station_out(session, st)
    return S.StationCreated(**base.model_dump(), api_key=key, setup_url=url, setup_qr_png=png)


async def update_station(
    session: AsyncSession, station_id: str, body: S.StationUpdate
) -> S.Station:
    st = await get_station(session, station_id)
    data = body.model_dump(exclude_unset=True)
    new_type = data.get("type") or st.type
    new_process = data["process_code"] if "process_code" in data else st.process_code
    new_printer = data["printer_id"] if "printer_id" in data else st.printer_id
    await _check_station_refs(
        session, type_=new_type, process_code=new_process, printer_id=new_printer
    )
    for k, v in data.items():
        if k == "type" and v is None:
            continue
        setattr(st, k, v)
    await session.commit()
    await session.refresh(st)
    return await station_out(session, st)


async def set_station_active(session: AsyncSession, station_id: str, active: bool) -> S.Station:
    st = await get_station(session, station_id)
    st.active = active
    await session.commit()
    await session.refresh(st)
    return await station_out(session, st)


async def rotate_station_key(session: AsyncSession, station_id: str) -> S.StationKeyRotated:
    """새 key 1회 응답. 구 key 는 즉시 무효."""
    st = await get_station(session, station_id)
    key = generate_api_key()
    st.api_key_hash = hash_api_key(key)
    st.api_key_prefix = api_key_prefix(key)
    await session.commit()
    await session.refresh(st)
    url, png = setup_payload(st, key)
    return S.StationKeyRotated(api_key=key, setup_url=url, setup_qr_png=png)


# ======================================================================
# 사용자
# ======================================================================
def user_out(u: AppUser) -> S.User:
    return S.User(
        id=u.id,
        login_id=u.login_id,
        name=u.name,
        role=u.role,
        card_code=u.card_code,
        active=u.active,
        has_pin=u.pin_hash is not None,
        has_password=u.password_hash is not None,
        created_at=u.created_at,
    )


def user_summary(u: AppUser) -> S.UserSummary:
    return S.UserSummary(
        id=u.id, login_id=u.login_id, name=u.name, role=u.role, card_code=u.card_code
    )


async def list_users(
    session: AsyncSession,
    params: PageParams,
    *,
    q: str | None,
    active: bool | None,
    role: str | None,
    sort: str | None,
) -> tuple[list[AppUser], int]:
    stmt = select(AppUser)
    if active is not None:
        stmt = stmt.where(AppUser.active.is_(active))
    if role:
        stmt = stmt.where(AppUser.role == role)
    if (f := q_filter(q, USER_Q)) is not None:
        stmt = stmt.where(f)
    stmt = stmt.order_by(*parse_sort(sort, USER_SORT))
    return await paginate(session, stmt, params)


async def get_user(session: AsyncSession, user_id: int) -> AppUser:
    u = await session.get(AppUser, user_id)
    if u is None:
        raise not_found("USER_NOT_FOUND", "사용자", user_id)
    return u


def _check_password(password: str) -> None:
    problem = password_problem(password)
    if problem:
        raise validation(["body", "password"], problem, "WEAK_PASSWORD")


def _check_pin(pin: str) -> None:
    if not is_valid_pin(pin):
        raise validation(["body", "pin"], "PIN 은 숫자 4~6자리여야 합니다")


async def _issue_card_code(
    session: AsyncSession, u: AppUser, *, printer_id: str | None
) -> tuple[str, LabelJob | None]:
    """US 채번 → card_code 교체 → label_issue(WORKER_CARD, issue_no=1).

    printer_id 면 즉시 전송을 시도한다.
    """
    code = await next_code(session, "US")
    u.card_code = code
    printer: Printer | None = None
    if printer_id is not None:
        printer = await session.get(Printer, printer_id)
        if printer is None:
            raise not_found("PRINTER_NOT_FOUND", "프린터", printer_id)
    issue = LabelIssue(
        target_type="US",
        target_code=code,
        label_type="WORKER_CARD",
        issue_no=1,
        printer_id=printer_id,
        copies=1,
        issued_by=None,
    )
    session.add(issue)
    await session.flush()
    if printer is None:
        return code, None
    body = await zpl_mod.template_body(session, "WORKER_CARD")
    rendered = zpl_mod.render(
        body, code=code, qr_url=zpl_mod.qr_url(code), issue_no=1, name=u.name, role=u.role
    )
    job = LabelJob(
        issue_no=1,
        label_type="WORKER_CARD",
        printer_id=printer.id,
        copies=1,
        sent_at=None,
        pdf_url=None,
        zpl_sent=False,
        error=None,
    )
    try:
        await zpl_mod.send_zpl(printer.host, printer.port, rendered)
        job.zpl_sent = True
        job.sent_at = datetime.now(UTC)
    except zpl_mod.PrinterUnreachable:
        job.error = "PRINTER_UNREACHABLE"  # 카드는 발급됨. 화면이 [재출력] 을 보인다 (§13.7 원칙)
    return code, job


async def create_user(session: AsyncSession, body: S.UserCreate) -> AppUser:
    if (await session.execute(select(AppUser.id).where(AppUser.login_id == body.login_id))).first():
        raise duplicate_code("사용자", body.login_id)
    if body.password is not None:
        _check_password(body.password)
    if body.pin is not None:
        _check_pin(body.pin)
    u = AppUser(
        login_id=body.login_id,
        name=body.name,
        role=body.role,
        password_hash=hash_secret(body.password) if body.password else None,
        pin_hash=hash_secret(body.pin) if body.pin else None,
        password_changed_at=datetime.now(UTC) if body.password else None,
    )
    session.add(u)
    await session.flush()
    issue_card = body.issue_card if body.issue_card is not None else body.role in CARD_DEFAULT_ROLES
    if issue_card:
        await _issue_card_code(session, u, printer_id=None)
    await session.commit()
    await session.refresh(u)
    return u


async def update_user(session: AsyncSession, user_id: int, body: S.UserUpdate) -> AppUser:
    u = await get_user(session, user_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        if v is not None:
            setattr(u, k, v)
    await session.commit()
    await session.refresh(u)
    return u


async def set_user_active(session: AsyncSession, user_id: int, active: bool) -> AppUser:
    u = await get_user(session, user_id)
    u.active = active
    await session.commit()
    await session.refresh(u)
    return u


async def set_pin(session: AsyncSession, user_id: int, pin: str) -> AppUser:
    _check_pin(pin)
    u = await get_user(session, user_id)
    u.pin_hash = hash_secret(pin)
    u.pin_failed_count = 0
    u.pin_locked_until = None
    await session.commit()
    await session.refresh(u)
    return u


async def set_password(session: AsyncSession, user_id: int, password: str) -> AppUser:
    _check_password(password)
    u = await get_user(session, user_id)
    u.password_hash = hash_secret(password)
    u.password_changed_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(u)
    return u


async def issue_card(
    session: AsyncSession, user_id: int, body: S.IssueCardRequest
) -> S.IssueCardResponse:
    """admin #17: 카드가 있고 reissue 없으면 409 CARD_EXISTS. reissue → 새 US 코드, 이전 코드 즉시
    무효.
    """
    u = await get_user(session, user_id)
    if u.card_code and not body.reissue:
        raise ApiError(
            409, "CARD_EXISTS", f"이미 카드 {u.card_code} 이(가) 있습니다. 재발급은 reissue=true"
        )
    code, job = await _issue_card_code(session, u, printer_id=body.printer_id)
    await session.commit()
    return S.IssueCardResponse(card_code=code, label_job=job)

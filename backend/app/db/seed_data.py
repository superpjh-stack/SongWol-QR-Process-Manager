"""시드 기준정보 상수 (db-schema §10).

Alembic 0001 과 ``app.db.seed`` 가 같이 쓴다 (로직 중복 금지).

spec §4.2 라우팅 값은 [확인] 제안값이라 여기 두지 않는다 (운영은 A1-11 엑셀 등록).
"""

from typing import Any, TypedDict


class ProcessRow(TypedDict):
    code: str
    name: str
    seq: int
    requires_equipment: bool
    required_inputs: list[str]


class PrintMethodRow(TypedDict):
    code: str
    name: str
    equip_types: list[str]
    skips_p30: bool


class StationRow(TypedDict):
    id: str
    type: str
    process_code: str | None
    location: str | None


# process — P40 은 존재하지 않는다 (spec §2.2 결정 2026-09-28)
PROCESS_ROWS: list[ProcessRow] = [
    {
        "code": "P10",
        "name": "수주 등록",
        "seq": 10,
        "requires_equipment": False,
        "required_inputs": [],
    },
    {
        "code": "P20",
        "name": "입고",
        "seq": 20,
        "requires_equipment": False,
        "required_inputs": ["qty", "box_count", "inspection"],
    },
    {
        "code": "P30",
        "name": "인쇄",
        "seq": 30,
        "requires_equipment": True,
        "required_inputs": ["equipment", "qty_good", "qty_bad"],
    },
    {
        "code": "P50",
        "name": "포장",
        "seq": 50,
        "requires_equipment": False,
        "required_inputs": ["qty_box"],
    },
    {
        "code": "P60",
        "name": "발송",
        "seq": 60,
        "requires_equipment": False,
        "required_inputs": ["tracking_no"],
    },
]

# print_method (§10, §12-6)
PRINT_METHOD_ROWS: list[PrintMethodRow] = [
    {"code": "SCREEN", "name": "나염", "equip_types": ["PRINT"], "skips_p30": False},
    {"code": "TRANSFER", "name": "전사(승화)", "equip_types": ["TRANSFER"], "skips_p30": False},
    {"code": "DTF", "name": "DTF", "equip_types": ["DTF"], "skips_p30": False},
    {"code": "EMB", "name": "자수", "equip_types": ["EMB"], "skips_p30": False},
    {"code": "PRINT_EMB", "name": "인쇄+자수", "equip_types": ["PRINT", "EMB"], "skips_p30": False},
    {"code": "NONE", "name": "무가공", "equip_types": [], "skips_p30": True},
]

# 초기 사용자 (§10): admin / ADMIN. 비밀번호는 SEED_ADMIN_PASSWORD.
ADMIN_LOGIN_ID = "admin"
ADMIN_ROLE = "ADMIN"

# station 시드(개발) (§10). API key 는 seed 실행 시 생성해 stdout 에 1회 출력.
DEV_STATION_ROWS: list[StationRow] = [
    {"id": "K-P30-1", "type": "KIOSK", "process_code": "P30", "location": None},
    {"id": "K-P30-2", "type": "KIOSK", "process_code": "P30", "location": None},
    {"id": "K-P50-1", "type": "KIOSK", "process_code": "P50", "location": None},
    {"id": "PDA-P20-1", "type": "PDA", "process_code": "P20", "location": None},
    {"id": "PDA-P60-1", "type": "PDA", "process_code": "P60", "location": None},
    {"id": "BOARD-1", "type": "BOARD", "process_code": None, "location": None},
]


def as_dicts(rows: list[Any]) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]

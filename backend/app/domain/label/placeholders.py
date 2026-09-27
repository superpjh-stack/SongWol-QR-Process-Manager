"""라벨 양식 플레이스홀더 (api-contract §13.3 admin #18).

여기 선언한 목록이 ``GET /label-templates/{type}`` 의 ``placeholders`` 응답과 렌더 검증의 단일
원천이다. 공통 ``code, qr_url, issue_no, printed_at`` + 유형별 항목. ZPL QR 명령이 쓰는
``qr_ecc``(M/Q, 프린터 용도로 결정) · ``qr_mag`` 는 계약 목록에 없는 추가 변수(보고 항목).
"""

from __future__ import annotations

from typing import Final

LABEL_TYPES: Final[tuple[str, ...]] = ("WORK_ORDER_PDF", "WO_LABEL", "BOX_LABEL", "WORKER_CARD")
TEST_LABEL_TYPE: Final = "TEST"  # 프린터 테스트 라벨 — label_template 테이블에 없다 (파일만)

COMMON: Final[tuple[str, ...]] = ("code", "qr_url", "issue_no", "printed_at", "qr_ecc", "qr_mag")

_WO_FIELDS: Final[tuple[str, ...]] = (
    "so_code",
    "customer_name",
    "item_name",
    "spec",
    "color",
    "print_method_name",
    "qty_ordered",
    "due_date",
    "design_thumbnail_path",
    "steps",  # [{process_code, process_name, std_lead_hours, seq}]
)

PLACEHOLDERS: Final[dict[str, tuple[str, ...]]] = {
    "WO_LABEL": COMMON + _WO_FIELDS,
    # 문서 전체 = 표지(SO) + WO 마다 1쪽. 표지 컨텍스트는 SO 필드, ``work_orders[]`` 각 항목이
    # WO 플레이스홀더(_WO_FIELDS + code/qr_url/issue_no) 를 가진다.
    "WORK_ORDER_PDF": COMMON
    + _WO_FIELDS
    + ("order_date", "customer_name", "lines", "work_orders", "font_css", "qr_png_uri"),
    "BOX_LABEL": COMMON
    + (
        "box_no",
        "box_total",
        "qty",
        "wo_code",
        "customer_name",
        "item_name",
        "spec",
        "color",
        "offline_seq",
    ),
    "WORKER_CARD": COMMON + ("name", "role"),
    TEST_LABEL_TYPE: ("printer_id", "printer_name", "host", "port", "printed_at", "qr_url"),
}


def placeholders_for(label_type: str) -> list[str]:
    seen: dict[str, None] = {}
    for p in PLACEHOLDERS[label_type]:
        seen.setdefault(p, None)
    return list(seen)


# 미리보기·검증용 예시 값 (target 없이 미리보기할 때). 실제 데이터가 아니다.
SAMPLE_CONTEXT: Final[dict[str, dict[str, object]]] = {
    "WO_LABEL": {
        "code": "WO-260928-0001",
        "so_code": "SO-260928-0001",
        "customer_name": "예시 거래처",
        "item_name": "40수 타월",
        "spec": "40×80",
        "color": "화이트",
        "print_method_name": "나염",
        "qty_ordered": 500,
        "due_date": "2026-10-15",
        "design_thumbnail_path": None,
        "steps": [
            {"seq": 1, "process_code": "P20", "process_name": "입고", "std_lead_hours": "4.0"},
            {"seq": 2, "process_code": "P30", "process_name": "인쇄", "std_lead_hours": "24.0"},
            {"seq": 3, "process_code": "P50", "process_name": "포장", "std_lead_hours": "8.0"},
            {"seq": 4, "process_code": "P60", "process_name": "발송", "std_lead_hours": "4.0"},
        ],
    },
    "BOX_LABEL": {
        "code": "LT-260928-0001",
        "box_no": 1,
        "box_total": 3,
        "qty": 100,
        "wo_code": "WO-260928-0001",
        "customer_name": "예시 거래처",
        "item_name": "40수 타월",
        "spec": "40×80",
        "color": "화이트",
        "offline_seq": None,
    },
    "WORKER_CARD": {"code": "US-0001", "name": "홍길동", "role": "WORKER"},
}

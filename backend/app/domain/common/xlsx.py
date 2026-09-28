"""간단 xlsx 내보내기 (openpyxl, admin #29 · A4-06). 헤더 1행 + 데이터.

``domain/master/import_service.py`` 가 이미 openpyxl 로 템플릿을 만든다 — 같은 라이브러리를
목록 내보내기에도 쓴다(새 의존성 없음).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import date, datetime
from io import BytesIO
from typing import Any

from openpyxl import Workbook

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _cell(v: Any) -> Any:
    if isinstance(v, datetime | date):
        return v.isoformat()
    if isinstance(v, bool):
        return "Y" if v else "N"
    return v


def rows_to_xlsx(headers: Sequence[str], rows: Sequence[Sequence[Any]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "data"
    ws.append(list(headers))
    for row in rows:
        ws.append([_cell(v) for v in row])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()

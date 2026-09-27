"""QR 발행 (spec §6, B1-01).

- ``qr_url(code)`` = ``{PUBLIC_HOST}/q/{CODE}?c={CHECK}`` (D25, api-contract §9)
- ``qr_png(code, ecc, px)`` → PNG bytes (segno). 작업지시서 PDF 가 data URI 로 심는다
- ZPL 은 이미지를 심지 않고 ``^BQ`` 명령을 쓴다 (plan §5.1) — ``zpl_qr_params()`` 가 오류정정·배율
- 오류정정: 기본 M(15%), 인쇄 구역(purpose=PRODUCTION) 라벨은 Q(25%) (spec §6)
- 최소 크기: 라벨 20×20 mm, 작업지시서 30×30 mm. 203dpi(8 dot/mm) 에서 배율 6 × 37모듈(v5) ≈ 28 mm
"""

from __future__ import annotations

import base64
import io
from typing import Literal

import segno

from app.core.checkcode import make_check
from app.core.config import get_settings

Ecc = Literal["M", "Q"]

ZPL_QR_MAG_DEFAULT = 6  # 8 dot/mm 기준 QR v5(37모듈) ≈ 27.8 mm ≥ 20 mm
PDF_QR_MM = 30


def qr_url(code: str) -> str:
    """spec §6: ``https://{host}/q/{CODE}?c={CHECK}``. 호스트는 PUBLIC_HOST (D25)."""
    return f"{get_settings().public_host.rstrip('/')}/q/{code}?c={make_check(code)}"


def qr_png(code: str, ecc: Ecc = "M", px: int = 300, *, url: str | None = None) -> bytes:
    """QR PNG. ``px`` 는 목표 한 변 픽셀(모듈 배율은 내림) — 최소 1 배율."""
    target = url if url is not None else qr_url(code)
    qr = segno.make(target, error=ecc.lower(), micro=False)
    modules = qr.symbol_size(scale=1, border=4)[0]
    scale = max(1, px // modules)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=scale, border=4)
    return buf.getvalue()


def qr_png_data_uri(code: str, ecc: Ecc = "M", px: int = 300) -> str:
    return "data:image/png;base64," + base64.b64encode(qr_png(code, ecc, px)).decode("ascii")


def ecc_for_printer(purpose: str | None) -> Ecc:
    """인쇄 구역(PRODUCTION) 은 Q, 그 외(PACKING·프린터 미정) 는 M... 단 프린터 미정이면 Q.

    프린터를 모르는 미리보기는 더 강한 Q 로 보여 준다 (인쇄 구역이 최소 요구).
    """
    if purpose is None or purpose == "PRODUCTION":
        return "Q"
    return "M"


def zpl_qr_params(purpose: str | None, mag: int = ZPL_QR_MAG_DEFAULT) -> dict[str, object]:
    """템플릿 변수 ``qr_ecc``·``qr_mag``. ZPL: ``^BQN,2,{mag},{ecc}^FD{ecc}A,{url}^FS``."""
    return {"qr_ecc": ecc_for_printer(purpose), "qr_mag": mag}

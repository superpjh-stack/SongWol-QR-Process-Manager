"""S1-4/S1-6: QR 발행(qr_url·체크코드·PNG) · label_issue 차수 · ZPL 렌더 · 템플릿 API ·
/labels/print (프린터 선택 순서 · 미도달 200 · 부수 · 권한)."""

from __future__ import annotations

import time

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.checkcode import make_check, parse_qr, verify_check
from app.db.models.master import Station
from app.db.models.order import LabelIssue, WorkOrder
from app.db.session import SessionLocal
from app.domain.label import qr as qr_mod
from app.domain.label import service as svc
from app.domain.label import zpl as zpl_mod
from app.domain.label.placeholders import LABEL_TYPES, placeholders_for
from app.domain.label.templates import load_default_template
from tests.conftest import ensure_station, headers_for, uniq
from tests.label_helpers import (
    deactivate_other_printers,
    ensure_printer,
    fake_printer,
    free_closed_port,
    make_so,
    worker_with_card,
)

API = "/api/v1"


# ======================================================================
# QR (B1-01, spec §6)
# ======================================================================
def test_qr_url_check_and_parse() -> None:
    code = "WO-260928-0012"
    url = qr_mod.qr_url(code)
    assert url.endswith(f"/q/{code}?c={make_check(code)}")
    assert url.startswith("http")
    parsed = parse_qr(url)
    assert parsed.type == "WO" and parsed.code == code and parsed.check is not None
    assert verify_check(parsed.code, parsed.check)
    assert not verify_check(parsed.code, "ZZZZ")


def test_qr_png_is_png_and_ecc_levels() -> None:
    png_m = qr_mod.qr_png("SO-260928-0001", "M", 300)
    png_q = qr_mod.qr_png("SO-260928-0001", "Q", 300)
    assert png_m[:8] == b"\x89PNG\r\n\x1a\n" and png_q[:8] == b"\x89PNG\r\n\x1a\n"
    assert qr_mod.qr_png_data_uri("US-0001").startswith("data:image/png;base64,")
    assert qr_mod.ecc_for_printer("PRODUCTION") == "Q"
    assert qr_mod.ecc_for_printer("PACKING") == "M"
    assert qr_mod.ecc_for_printer(None) == "Q"


# ======================================================================
# ZPL 렌더 (B1-02)
# ======================================================================
def test_zpl_render_has_bq_url_and_fields() -> None:
    ctx = svc.sample_context("WO_LABEL")
    zpl = zpl_mod.render(
        load_default_template("WO_LABEL")[1], **ctx, **qr_mod.zpl_qr_params("PRODUCTION")
    )
    assert "^BQN,2,6,Q" in zpl and f"^FDQA,{ctx['qr_url']}" in zpl
    for field in ("code", "so_code", "customer_name", "item_name", "print_method_name"):
        assert str(ctx[field]) in zpl
    assert "500" in zpl and "2026-10-15" in zpl and "발행 1차" in zpl
    assert "P20 > P30 > P50 > P60" in zpl
    assert zpl.strip().startswith("^XA") and zpl.strip().endswith("^XZ")


def test_zpl_ecc_follows_printer_purpose() -> None:
    zpl = zpl_mod.render(
        load_default_template("BOX_LABEL")[1],
        **svc.sample_context("BOX_LABEL"),
        **qr_mod.zpl_qr_params("PACKING"),
    )
    assert "^BQN,2,6,M" in zpl and "^FDMA," in zpl
    assert "임시 #" not in zpl  # offline_seq None


def test_all_default_templates_render_with_sample() -> None:
    for lt in LABEL_TYPES:
        body = load_default_template(lt)[1]
        rendered = zpl_mod.render(body, **svc.sample_context(lt))
        assert rendered
        assert set(placeholders_for(lt)) >= {"code", "qr_url", "issue_no", "printed_at"}


def test_bad_template_syntax_and_undefined() -> None:
    with pytest.raises(zpl_mod.BadTemplate):
        zpl_mod.compile_template("^XA {% if %} ^XZ")
    with pytest.raises(zpl_mod.BadTemplate):
        zpl_mod.render("^XA {{ not_a_placeholder }} ^XZ", code="X")
    assert zpl_mod.with_copies("^XA^XZ", 3).count("^XA") == 3


async def test_send_zpl_closed_port_fails_fast() -> None:
    t0 = time.monotonic()
    with pytest.raises(zpl_mod.PrinterUnreachable):
        await zpl_mod.send_zpl("127.0.0.1", free_closed_port(), "^XA^XZ")
    assert time.monotonic() - t0 < zpl_mod.SEND_TIMEOUT_SEC + 1


async def test_send_zpl_success() -> None:
    async with fake_printer() as (port, received):
        await zpl_mod.send_zpl("127.0.0.1", port, "^XA^FDhello^FS^XZ")
    assert received and b"^FDhello^FS" in received[0]


# ======================================================================
# label_issue 차수 · issue_labels_for_wo
# ======================================================================
async def test_record_issue_increments_and_issue_labels_for_wo() -> None:
    data = await make_so(with_wo=2)
    async with SessionLocal() as s:
        nos = [
            (await svc.record_issue(s, "US", "US-9999", "WORKER_CARD")).issue_no for _ in range(3)
        ]
        await s.commit()
    assert nos == [1, 2, 3]

    async with SessionLocal() as s:
        wo1 = (
            await s.execute(select(WorkOrder).where(WorkOrder.code == data["wo_codes"][0]))
        ).scalar_one()
        issued = await svc.issue_labels_for_wo(s, wo1, data["admin"].id)
        await s.commit()
        kinds = {(i.target_type, i.label_type, i.issue_no) for i in issued}
        assert kinds == {
            ("SO", "WORK_ORDER_PDF", 1),
            ("WO", "WORK_ORDER_PDF", 1),
            ("WO", "WO_LABEL", 1),
        }
        # 같은 SO 의 두 번째 WO: 표지는 다시 발행하지 않는다
        wo2 = (
            await s.execute(select(WorkOrder).where(WorkOrder.code == data["wo_codes"][1]))
        ).scalar_one()
        issued2 = await svc.issue_labels_for_wo(s, wo2)
        await s.commit()
        assert {i.target_type for i in issued2} == {"WO"} and len(issued2) == 2
        assert await svc.last_issue_no(s, "SO", data["so_code"], "WORK_ORDER_PDF") == 1
        # ports 어댑터 시그니처 (session, wo) -> None
        assert await svc.label_issuer(s, wo1) is None
        await s.commit()
        assert await svc.last_issue_no(s, "WO", wo1.code, "WO_LABEL") == 2


# ======================================================================
# 라벨 양식 API (ADM-09 탭 2)
# ======================================================================
async def test_label_templates_api(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    res = await client.get(f"{API}/label-templates", headers=admin_headers)
    assert res.status_code == 200, res.text
    rows = res.json()
    assert isinstance(rows, list) and {r["label_type"] for r in rows} == set(LABEL_TYPES)
    fmt = {r["label_type"]: r["format"] for r in rows}
    assert fmt["WORK_ORDER_PDF"] == "HTML" and fmt["WO_LABEL"] == "ZPL"

    res = await client.get(f"{API}/label-templates/WO_LABEL", headers=admin_headers)
    assert res.status_code == 200
    t = res.json()
    assert (
        t["placeholders"] == placeholders_for("WO_LABEL") and "customer_name" in t["placeholders"]
    )
    assert "^BQN" in t["body"] and t["version"] >= 1
    version = t["version"]

    res = await client.get(f"{API}/label-templates/NOPE", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "LABEL_TEMPLATE_NOT_FOUND"

    # 문법 오류 → 422 BAD_TEMPLATE, 선언 밖 변수 → 422 BAD_TEMPLATE
    res = await client.put(
        f"{API}/label-templates/WO_LABEL", headers=admin_headers, json={"body": "^XA{% if %}^XZ"}
    )
    assert res.status_code == 422 and res.json()["code"] == "BAD_TEMPLATE", res.text
    res = await client.put(
        f"{API}/label-templates/WO_LABEL",
        headers=admin_headers,
        json={"body": "^XA^FD{{ nope }}^FS^XZ"},
    )
    assert res.status_code == 422 and res.json()["code"] == "BAD_TEMPLATE"
    # 정상 저장 → version +1, updated_by
    new_body = t["body"] + "\n{#- edited -#}"
    res = await client.put(
        f"{API}/label-templates/WO_LABEL", headers=admin_headers, json={"body": new_body}
    )
    assert res.status_code == 200, res.text
    assert res.json()["version"] == version + 1
    assert res.json()["updated_by"]["login_id"] == "t_admin"
    # 원복 (다른 테스트가 기본 양식을 기대)
    res = await client.put(
        f"{API}/label-templates/WO_LABEL", headers=admin_headers, json={"body": t["body"]}
    )
    assert res.status_code == 200 and res.json()["version"] == version + 2

    # 미리보기: target 없음 → 예시 값 ZPL 텍스트
    res = await client.post(f"{API}/label-templates/WO_LABEL/preview", headers=admin_headers)
    assert res.status_code == 200 and "^BQN" in res.json()["body"]
    assert res.json()["format"] == "ZPL" and res.json()["target"] is None
    # target 있음 → 실제 WO 데이터
    data = await make_so()
    res = await client.post(
        f"{API}/label-templates/WO_LABEL/preview",
        headers=admin_headers,
        json={"target": data["wo_codes"][0]},
    )
    assert res.status_code == 200, res.text
    assert data["wo_codes"][0] in res.json()["body"] and data["customer_name"] in res.json()["body"]
    # WORK_ORDER_PDF 미리보기는 HTML 텍스트
    res = await client.post(
        f"{API}/label-templates/WORK_ORDER_PDF/preview",
        headers=admin_headers,
        json={"target": data["so_code"]},
    )
    assert res.status_code == 200 and res.json()["format"] == "HTML"
    assert "<html" in res.json()["body"] and data["so_code"] in res.json()["body"]
    # label_type 과 대상 불일치 → 422
    res = await client.post(
        f"{API}/label-templates/BOX_LABEL/preview",
        headers=admin_headers,
        json={"target": data["wo_codes"][0]},
    )
    assert res.status_code == 422


async def test_label_templates_permissions(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    manager = await headers_for(client, "t_manager", "MANAGER")
    viewer = await headers_for(client, "t_viewer", "VIEWER")
    assert (await client.get(f"{API}/label-templates", headers=manager)).status_code == 200
    assert (
        await client.put(
            f"{API}/label-templates/WO_LABEL", headers=manager, json={"body": "^XA^XZ"}
        )
    ).status_code == 403
    assert (await client.get(f"{API}/label-templates", headers=viewer)).status_code == 403
    _, key = await ensure_station("T-K-LBL-1")
    res = await client.get(f"{API}/label-templates/BOX_LABEL", headers={"X-Station-Key": key})
    assert res.status_code == 200  # STATION R (템플릿만)
    assert (await client.get(f"{API}/label-templates")).status_code == 401


# ======================================================================
# POST /labels/print
# ======================================================================
async def test_print_wo_label_unreachable_then_success(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    data = await make_so()
    wo = data["wo_codes"][0]
    pid = await ensure_printer(uniq("LP-T"), purpose="PRODUCTION")  # 닫힌 포트
    res = await client.post(
        f"{API}/labels/print",
        headers=admin_headers,
        json={"target": wo, "label_type": "WO_LABEL", "printer": pid},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["zpl_sent"] is False and job["error"] == "PRINTER_UNREACHABLE"
    assert job["issue_no"] == 1 and job["printer_id"] == pid and job["sent_at"] is None
    # 실패도 차수를 소비한다 (발행 이력에 남는다)
    res = await client.get(
        f"{API}/labels/issues", headers=admin_headers, params={"target_code": wo}
    )
    assert res.status_code == 200 and [i["issue_no"] for i in res.json()] == [1]
    assert res.json()[0]["issued_by"]["login_id"] == "t_admin"

    async with fake_printer() as (port, received):
        await ensure_printer(pid, purpose="PRODUCTION", port=port)
        res = await client.post(
            f"{API}/labels/print",
            headers=admin_headers,
            json={"target": wo, "label_type": "WO_LABEL", "printer_id": pid, "copies": 2},
        )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["zpl_sent"] is True and job["error"] is None and job["issue_no"] == 2
    assert job["sent_at"] and job["sent_at"].endswith("+09:00") and job["copies"] == 2
    sent = received[0].decode("utf-8")
    assert sent.count("^XA") == 2 and wo in sent and "^BQN,2,6,Q" in sent and "발행 2차" in sent


async def test_print_validation_and_not_found(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    data = await make_so()
    pid = await ensure_printer(uniq("LP-V"))
    res = await client.post(
        f"{API}/labels/print",
        headers=admin_headers,
        json={"target": data["so_code"], "label_type": "WO_LABEL", "printer": pid},
    )
    assert res.status_code == 422 and res.json()["code"] == "VALIDATION_ERROR"
    res = await client.post(
        f"{API}/labels/print",
        headers=admin_headers,
        json={"target": "WO-990101-9999", "label_type": "WO_LABEL", "printer": pid},
    )
    assert res.status_code == 404 and res.json()["code"] == "WO_NOT_FOUND"
    res = await client.post(
        f"{API}/labels/print",
        headers=admin_headers,
        json={"target": data["wo_codes"][0], "label_type": "WO_LABEL", "printer": "LP-NOPE"},
    )
    assert res.status_code == 404 and res.json()["code"] == "PRINTER_NOT_FOUND"
    res = await client.post(
        f"{API}/labels/print",
        headers=admin_headers,
        json={"target": data["wo_codes"][0], "label_type": "WORK_ORDER_PDF"},
    )
    assert res.status_code == 422
    # 작업자 카드: US 대상
    u = await worker_with_card("t_label_worker")
    async with fake_printer() as (port, received):
        await ensure_printer(pid, port=port)
        res = await client.post(
            f"{API}/labels/print",
            headers=admin_headers,
            json={"target": u.card_code, "label_type": "WORKER_CARD", "printer": pid},
        )
    assert res.status_code == 200 and res.json()["zpl_sent"] is True
    assert u.name in received[0].decode("utf-8") and "WORKER" in received[0].decode("utf-8")


async def test_printer_selection_order(client: AsyncClient) -> None:
    """§13.7 ②: 본문 printer → station.printer_id → 유일 PACKING → 없으면 NO_PRINTER."""
    data = await make_so()
    wo = data["wo_codes"][0]
    station_id, key = await ensure_station("T-K-P50-LBL", process_code="P50")
    sh = {"X-Station-Key": key}
    explicit = await ensure_printer(uniq("LP-E"), purpose="PRODUCTION")
    station_p = await ensure_printer(uniq("LP-S"), purpose="PACKING")
    packing = await ensure_printer(uniq("LP-P"), purpose="PACKING")
    await deactivate_other_printers({explicit, station_p, packing})
    async with SessionLocal() as s:
        st = await s.get(Station, station_id)
        assert st is not None
        st.printer_id = station_p
        await s.commit()
    body = {"target": wo, "label_type": "WO_LABEL"}
    # ① 명시
    res = await client.post(f"{API}/labels/print", headers=sh, json={**body, "printer": explicit})
    assert res.status_code == 200 and res.json()["printer_id"] == explicit
    # ② 단말 프린터
    res = await client.post(f"{API}/labels/print", headers=sh, json=body)
    assert res.status_code == 200 and res.json()["printer_id"] == station_p
    assert res.json()["error"] == "PRINTER_UNREACHABLE"  # 닫힌 포트 — 실패는 드러난다
    # ③ 단말 프린터 없음 → 활성 PACKING 이 정확히 1대(station_p 를 끄면 packing 만)
    async with SessionLocal() as s:
        st = await s.get(Station, station_id)
        assert st is not None
        st.printer_id = None
        await s.commit()
    await ensure_printer(station_p, purpose="PACKING", active=False)
    res = await client.post(f"{API}/labels/print", headers=sh, json=body)
    assert res.status_code == 200 and res.json()["printer_id"] == packing
    before = res.json()["issue_no"]
    # ④ PACKING 2대 → 미출력 NO_PRINTER, 차수 소비 없음
    await ensure_printer(station_p, purpose="PACKING", active=True)
    res = await client.post(f"{API}/labels/print", headers=sh, json=body)
    assert res.status_code == 200
    assert res.json()["zpl_sent"] is False and res.json()["error"] == "NO_PRINTER"
    assert res.json()["printer_id"] is None and res.json()["issue_no"] == before
    # ⑤ PACKING 0대 → NO_PRINTER
    await ensure_printer(station_p, active=False)
    await ensure_printer(packing, active=False)
    res = await client.post(f"{API}/labels/print", headers=sh, json=body)
    assert res.status_code == 200 and res.json()["error"] == "NO_PRINTER"
    async with SessionLocal() as s:
        rows = (
            (await s.execute(select(LabelIssue).where(LabelIssue.target_code == wo)))
            .scalars()
            .all()
        )
    assert [r.issue_no for r in rows] == [1, 2, 3] and {r.station_id for r in rows} == {station_id}


async def test_print_permissions(client: AsyncClient) -> None:
    data = await make_so()
    pid = await ensure_printer(uniq("LP-A"))
    body = {"target": data["wo_codes"][0], "label_type": "WO_LABEL", "printer": pid}
    for login, role, status in (
        ("t_sales", "SALES", 200),
        ("t_manager", "MANAGER", 200),
        ("t_worker_w", "WORKER", 403),
        ("t_viewer", "VIEWER", 403),
    ):
        h = await headers_for(client, login, role)
        assert (
            await client.post(f"{API}/labels/print", headers=h, json=body)
        ).status_code == status
    assert (await client.post(f"{API}/labels/print", json=body)).status_code == 401

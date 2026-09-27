"""S0-5 기준정보 CRUD: 각 엔티티 CRUD · 페이징·검색·비활성·재활성 · 정렬 검증 · 라우팅 resolve
· issue-card 채번 · is_default 유일성 · 코드 체계 설정 · 감사 로그."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from tests.conftest import ensure_item_group, headers_for, uniq

API = "/api/v1"


# ======================================================================
# 거래처 + 배송지
# ======================================================================
@pytest.mark.asyncio
async def test_customer_crud_paging_search_deactivate(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    tag = uniq("")
    codes = [f"C{tag}-{i:02d}" for i in range(7)]
    for i, code in enumerate(codes):
        res = await client.post(
            f"{API}/customers",
            headers=admin_headers,
            json={
                "code": code,
                "name": f"거래처{tag} {i}",
                "phone": f"02-{i:04d}",
                "contact_name": "김담당",
            },
        )
        assert res.status_code == 201, res.text
        assert res.json()["addresses"] == []
    # 중복 코드 409
    res = await client.post(
        f"{API}/customers", headers=admin_headers, json={"code": codes[0], "name": "x"}
    )
    assert res.status_code == 409 and res.json()["code"] == "DUPLICATE_CODE"
    # 페이징 + q
    res = await client.get(
        f"{API}/customers", headers=admin_headers, params={"q": tag, "page": 2, "size": 3}
    )
    assert res.status_code == 200
    page = res.json()
    assert (
        page["total"] == 7 and page["page"] == 2 and page["size"] == 3 and len(page["items"]) == 3
    )
    # 정렬 (name 내림차순) · 허용 외 컬럼 → 422 BAD_SORT
    res = await client.get(
        f"{API}/customers", headers=admin_headers, params={"q": tag, "sort": "-name"}
    )
    names = [c["name"] for c in res.json()["items"]]
    assert names == sorted(names, reverse=True)
    res = await client.get(f"{API}/customers", headers=admin_headers, params={"sort": "phone"})
    assert res.status_code == 422 and res.json()["code"] == "BAD_SORT"
    # q 는 contact_name 도 본다
    res = await client.get(
        f"{API}/customers", headers=admin_headers, params={"q": "김담당", "size": 200}
    )
    assert res.json()["total"] >= 7
    # 상세 · PATCH (보낸 필드만, null 은 NULL)
    cid = (
        await client.get(f"{API}/customers", headers=admin_headers, params={"q": codes[1]})
    ).json()["items"][0]["id"]
    res = await client.patch(
        f"{API}/customers/{cid}",
        headers=admin_headers,
        json={"contact_name": None, "email": "a@b.c"},
    )
    assert res.status_code == 200
    assert (
        res.json()["contact_name"] is None
        and res.json()["email"] == "a@b.c"
        and res.json()["code"] == codes[1]
    )
    # 비활성 → active 필터 · 재활성
    res = await client.post(f"{API}/customers/{cid}/deactivate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is False
    res = await client.get(
        f"{API}/customers", headers=admin_headers, params={"q": tag, "active": "true"}
    )
    assert res.json()["total"] == 6
    res = await client.get(
        f"{API}/customers", headers=admin_headers, params={"q": tag, "active": "false"}
    )
    assert res.json()["total"] == 1
    res = await client.post(f"{API}/customers/{cid}/activate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is True
    res = await client.get(f"{API}/customers/999999999", headers=admin_headers)
    assert res.status_code == 404 and res.json()["code"] == "CUSTOMER_NOT_FOUND"
    # STATION 키는 R 가능 (품목·거래처 표시용)
    from tests.conftest import ensure_station

    _, key = await ensure_station("T-K-CUST-1")
    res = await client.get(f"{API}/customers/{cid}", headers={"X-Station-Key": key})
    assert res.status_code == 200
    res = await client.post(
        f"{API}/customers", headers={"X-Station-Key": key}, json={"code": "S", "name": "s"}
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_customer_address_is_default_uniqueness(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    code = uniq("CA")
    cid = (
        await client.post(
            f"{API}/customers", headers=admin_headers, json={"code": code, "name": "주소테스트"}
        )
    ).json()["id"]
    a1 = await client.post(
        f"{API}/customers/{cid}/addresses",
        headers=admin_headers,
        json={"label": "본사", "address1": "서울 강남구 1", "is_default": True},
    )
    assert a1.status_code == 201 and a1.json()["is_default"] is True
    a2 = await client.post(
        f"{API}/customers/{cid}/addresses",
        headers=admin_headers,
        json={"label": "창고", "address1": "경기 김포 2", "is_default": True},
    )
    assert (
        a2.status_code == 201 and a2.json()["is_default"] is True
    )  # 409 없음 — 기존 기본 자동 해제
    lst = await client.get(f"{API}/customers/{cid}/addresses", headers=admin_headers)
    assert lst.status_code == 200 and isinstance(lst.json(), list)
    defaults = [a for a in lst.json() if a["is_default"]]
    assert len(defaults) == 1 and defaults[0]["id"] == a2.json()["id"]
    # PATCH 로 a1 을 기본으로 → a2 해제
    res = await client.patch(
        f"{API}/customers/{cid}/addresses/{a1.json()['id']}",
        headers=admin_headers,
        json={"is_default": True},
    )
    assert res.status_code == 200
    lst = (await client.get(f"{API}/customers/{cid}/addresses", headers=admin_headers)).json()
    assert [a["id"] for a in lst if a["is_default"]] == [a1.json()["id"]]
    # 마지막 기본을 false 로 → 허용 (기본 주소 없는 거래처 가능)
    res = await client.patch(
        f"{API}/customers/{cid}/addresses/{a1.json()['id']}",
        headers=admin_headers,
        json={"is_default": False},
    )
    assert res.status_code == 200 and res.json()["is_default"] is False
    # 비활성 / 재활성 · 거래처 상세에 addresses 포함
    res = await client.post(
        f"{API}/customers/{cid}/addresses/{a2.json()['id']}/deactivate", headers=admin_headers
    )
    assert res.status_code == 200 and res.json()["active"] is False
    res = await client.post(
        f"{API}/customers/{cid}/addresses/{a2.json()['id']}/activate", headers=admin_headers
    )
    assert res.json()["active"] is True
    detail = await client.get(f"{API}/customers/{cid}", headers=admin_headers)
    assert len(detail.json()["addresses"]) == 2


# ======================================================================
# 품목 · 품목군
# ======================================================================
@pytest.mark.asyncio
async def test_item_crud_requires_active_item_group(
    client: AsyncClient, admin_headers: dict[str, str], item_group: str
) -> None:
    code = uniq("IT")
    res = await client.post(
        f"{API}/items",
        headers=admin_headers,
        json={"code": code, "name": "타월", "item_group": "NOPE"},
    )
    assert res.status_code == 404 and res.json()["code"] == "ITEM_GROUP_NOT_FOUND"
    res = await client.post(
        f"{API}/items",
        headers=admin_headers,
        json={
            "code": code,
            "name": "40수 타월",
            "item_group": item_group,
            "spec": "40×80",
            "vendor_barcode": f"VB{code}",
        },
    )
    assert res.status_code == 201, res.text
    item = res.json()
    assert item["qty_tolerance_pct"] == 3.0 and item["active"] is True
    res = await client.get(f"{API}/items", headers=admin_headers, params={"barcode": f"VB{code}"})
    assert res.json()["total"] == 1
    res = await client.get(
        f"{API}/items",
        headers=admin_headers,
        params={"item_group": item_group, "q": "40수", "sort": "item_group,-code"},
    )
    assert res.json()["total"] >= 1
    res = await client.patch(
        f"{API}/items/{item['id']}",
        headers=admin_headers,
        json={"qty_tolerance_pct": 5.5, "weight_g": 150},
    )
    assert (
        res.status_code == 200
        and res.json()["qty_tolerance_pct"] == 5.5
        and res.json()["weight_g"] == 150
    )
    res = await client.patch(
        f"{API}/items/{item['id']}", headers=admin_headers, json={"qty_tolerance_pct": 99}
    )
    assert res.status_code == 422
    res = await client.post(f"{API}/items/{item['id']}/deactivate", headers=admin_headers)
    assert res.json()["active"] is False
    # 비활성 품목군으로는 등록 불가
    g2 = await ensure_item_group(uniq("TG"))
    res = await client.post(f"{API}/item-groups/{g2}/deactivate", headers=admin_headers)
    assert res.status_code == 200 and res.json()["active"] is False
    res = await client.post(
        f"{API}/items",
        headers=admin_headers,
        json={"code": uniq("IT"), "name": "x", "item_group": g2},
    )
    assert res.status_code == 404
    groups = await client.get(
        f"{API}/item-groups", headers=admin_headers, params={"active": "true"}
    )
    assert isinstance(groups.json(), list) and g2 not in [g["code"] for g in groups.json()]
    res = await client.post(
        f"{API}/item-groups", headers=admin_headers, json={"code": uniq("TG"), "name": "새 품목군"}
    )
    assert res.status_code == 201


# ======================================================================
# 가공방식 · 공정 · 설비
# ======================================================================
@pytest.mark.asyncio
async def test_print_methods_and_processes(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    res = await client.get(f"{API}/print-methods", headers=admin_headers)
    assert res.status_code == 200 and isinstance(res.json(), list)
    assert {p["code"] for p in res.json()} >= {
        "SCREEN",
        "TRANSFER",
        "DTF",
        "EMB",
        "PRINT_EMB",
        "NONE",
    }
    none = next(p for p in res.json() if p["code"] == "NONE")
    assert none["skips_p30"] is True and none["equip_types"] == []
    code = uniq("PM")
    res = await client.post(
        f"{API}/print-methods",
        headers=admin_headers,
        json={"code": code, "name": "테스트", "equip_types": ["PRINT"]},
    )
    assert res.status_code == 201
    res = await client.patch(
        f"{API}/print-methods/{code}", headers=admin_headers, json={"equip_types": ["PRINT", "EMB"]}
    )
    assert res.json()["equip_types"] == ["PRINT", "EMB"]
    res = await client.patch(
        f"{API}/print-methods/{code}", headers=admin_headers, json={"equip_types": ["LASER"]}
    )
    assert res.status_code == 422
    assert (
        await client.post(f"{API}/print-methods/{code}/deactivate", headers=admin_headers)
    ).json()["active"] is False

    # 공정: seq 순 배열, P40 없음
    res = await client.get(f"{API}/processes", headers=admin_headers)
    seqs = [p["code"] for p in res.json()]
    assert seqs[:5] == ["P10", "P20", "P30", "P50", "P60"] and "P40" not in seqs
    # POST 는 ADMIN 만
    manager = await headers_for(client, "t_manager", "MANAGER")
    res = await client.post(
        f"{API}/processes", headers=manager, json={"code": "P9", "name": "x", "seq": 99}
    )
    assert res.status_code == 403
    res = await client.post(
        f"{API}/processes",
        headers=admin_headers,
        json={"code": "P70", "name": "검사", "seq": 70, "required_inputs": ["qty"]},
    )
    assert res.status_code in (201, 409)  # 이전 실행 잔재 허용
    res = await client.patch(
        f"{API}/processes/P70", headers=admin_headers, json={"required_inputs": ["bogus"]}
    )
    assert res.status_code == 422 and res.json()["code"] == "BAD_REQUIRED_INPUT"
    # reorder: 전체 코드 필요
    res = await client.post(
        f"{API}/processes/reorder", headers=manager, json={"codes": ["P10", "P20"]}
    )
    assert res.status_code == 422
    all_codes = [
        p["code"] for p in (await client.get(f"{API}/processes", headers=admin_headers)).json()
    ]
    reordered = [c for c in all_codes if c != "P70"] + ["P70"]
    res = await client.post(f"{API}/processes/reorder", headers=manager, json={"codes": reordered})
    assert res.status_code == 200 and [p["code"] for p in res.json()] == reordered
    assert [p["seq"] for p in res.json()] == [10 * (i + 1) for i in range(len(reordered))]
    # 원래 순서로 복구 (다른 테스트가 P10..P60 순서를 기대)
    res = await client.post(
        f"{API}/processes/reorder",
        headers=admin_headers,
        json={
            "codes": ["P10", "P20", "P30", "P50", "P60"]
            + [c for c in all_codes if c not in {"P10", "P20", "P30", "P50", "P60"}]
        },
    )
    assert res.status_code == 200
    assert (await client.post(f"{API}/processes/P70/deactivate", headers=admin_headers)).json()[
        "active"
    ] is False
    # 정리: 시드 5종만 남긴다 (test_models 가 정확한 시드 목록을 검사한다). 물리 삭제는 테스트 전용.
    from app.db.models.master import Process
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        p70 = await s.get(Process, "P70")
        if p70 is not None:
            await s.delete(p70)
        # reorder 는 10·20·30·40·50 을 부여한다 → 시드 값(P50=50, P60=60)으로 복구
        # (seq UK 라 P60 부터)
        for code, seq in (("P60", 60), ("P50", 50)):
            proc = await s.get(Process, code)
            assert proc is not None
            proc.seq = seq
            await s.flush()
        await s.commit()


@pytest.mark.asyncio
async def test_equipment_crud_filters(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    code = uniq("PRT-")
    res = await client.post(
        f"{API}/equipment",
        headers=admin_headers,
        json={"code": code, "name": "나염기", "equip_type": "PRINT"},
    )
    assert res.status_code == 201 and res.json()["process_code"] == "P30"
    eid = res.json()["id"]
    res = await client.post(
        f"{API}/equipment",
        headers=admin_headers,
        json={"code": uniq("X"), "name": "x", "equip_type": "PRINT", "process_code": "P99"},
    )
    assert res.status_code == 404 and res.json()["code"] == "PROCESS_NOT_FOUND"
    res = await client.get(
        f"{API}/equipment",
        headers=admin_headers,
        params={"equip_type": "PRINT", "process_code": "P30", "q": code},
    )
    assert res.json()["total"] == 1
    res = await client.patch(
        f"{API}/equipment/{eid}",
        headers=admin_headers,
        json={"equip_type": "EMB", "name": "자수기"},
    )
    assert res.json()["equip_type"] == "EMB"
    res = await client.get(f"{API}/equipment", headers=admin_headers, params={"sort": "updated_at"})
    assert res.status_code == 422 and res.json()["code"] == "BAD_SORT"
    assert (await client.post(f"{API}/equipment/{eid}/deactivate", headers=admin_headers)).json()[
        "active"
    ] is False
    assert (await client.post(f"{API}/equipment/{eid}/activate", headers=admin_headers)).json()[
        "active"
    ] is True


# ======================================================================
# 라우팅
# ======================================================================
@pytest.mark.asyncio
async def test_routing_create_resolve_put_steps_and_process_in_use(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    group = await ensure_item_group(uniq("RG"))
    steps = [
        {"seq": 10, "process_code": "P20", "std_lead_hours": 8, "tolerance_pct": None},
        {"seq": 20, "process_code": "P30", "std_lead_hours": 24, "tolerance_pct": 3.0},
        {"seq": 30, "process_code": "P50", "std_lead_hours": 8},
        {"seq": 40, "process_code": "P60", "std_lead_hours": 4},
    ]
    res = await client.get(
        f"{API}/routings/resolve",
        headers=admin_headers,
        params={"item_group": group, "print_method": "SCREEN"},
    )
    assert res.status_code == 404 and res.json()["code"] == "ROUTING_NOT_FOUND"
    res = await client.post(
        f"{API}/routings",
        headers=admin_headers,
        json={"item_group": group, "print_method": "SCREEN", "steps": steps},
    )
    assert res.status_code == 201, res.text
    rid = res.json()["id"]
    assert [s["process_code"] for s in res.json()["steps"]] == ["P20", "P30", "P50", "P60"]
    # UK 중복 409 · 같은 공정 2번 422 · 미존재 공정 422
    res = await client.post(
        f"{API}/routings",
        headers=admin_headers,
        json={"item_group": group, "print_method": "SCREEN", "steps": steps},
    )
    assert res.status_code == 409
    bad = steps[:1] + [{"seq": 20, "process_code": "P20", "std_lead_hours": 1}]
    res = await client.post(
        f"{API}/routings",
        headers=admin_headers,
        json={"item_group": group, "print_method": "DTF", "steps": bad},
    )
    assert res.status_code == 422
    # resolve
    res = await client.get(
        f"{API}/routings/resolve",
        headers=admin_headers,
        params={"item_group": group, "print_method": "SCREEN"},
    )
    assert res.status_code == 200 and res.json()["id"] == rid
    # 단계 통째 교체 (무가공: P30 생략)
    res = await client.put(
        f"{API}/routings/{rid}/steps",
        headers=admin_headers,
        json={"steps": [steps[0], steps[2], steps[3]]},
    )
    assert res.status_code == 200 and [s["process_code"] for s in res.json()["steps"]] == [
        "P20",
        "P50",
        "P60",
    ]
    # 활성 라우팅이 참조하는 공정 비활성 → 409 PROCESS_IN_USE (detail 에 routing id)
    res = await client.post(f"{API}/processes/P50/deactivate", headers=admin_headers)
    assert res.status_code == 409 and res.json()["code"] == "PROCESS_IN_USE"
    assert rid in res.json()["detail"][0]["routing_ids"]
    # 목록·비활성 후 resolve 404
    res = await client.get(
        f"{API}/routings",
        headers=admin_headers,
        params={"item_group": group, "sort": "print_method"},
    )
    assert res.json()["total"] == 1
    res = await client.post(f"{API}/routings/{rid}/deactivate", headers=admin_headers)
    assert res.json()["active"] is False
    res = await client.get(
        f"{API}/routings/resolve",
        headers=admin_headers,
        params={"item_group": group, "print_method": "SCREEN"},
    )
    assert res.status_code == 404
    res = await client.patch(f"{API}/routings/{rid}", headers=admin_headers, json={"active": True})
    assert res.json()["active"] is True


# ======================================================================
# 단말 · 사용자 · 코드 체계
# ======================================================================
@pytest.mark.asyncio
async def test_station_create_returns_key_once(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    sid = uniq("T-K-")
    res = await client.post(
        f"{API}/stations", headers=admin_headers, json={"id": sid, "type": "KIOSK"}
    )
    assert res.status_code == 422  # KIOSK 는 process_code 필수
    res = await client.post(
        f"{API}/stations",
        headers=admin_headers,
        json={"id": sid, "type": "KIOSK", "process_code": "P30", "location": "인쇄동"},
    )
    assert res.status_code == 201, res.text
    created = res.json()
    assert created["api_key"] and created["api_key_prefix"] == created["api_key"][:8]
    assert created["setup_url"].startswith("http") and "setup_qr_png" in created
    assert created["offline_state"] == "ERROR"  # 아직 접속 없음
    # 재조회에는 키가 없다
    res = await client.get(f"{API}/stations/{sid}", headers=admin_headers)
    assert res.status_code == 200 and "api_key" not in res.json()
    res = await client.get(
        f"{API}/stations", headers=admin_headers, params={"q": "인쇄동", "sort": "-last_seen_at"}
    )
    assert res.json()["total"] >= 1
    res = await client.patch(
        f"{API}/stations/{sid}", headers=admin_headers, json={"printer_id": "LP-NOPE"}
    )
    assert res.status_code == 404 and res.json()["code"] == "PRINTER_NOT_FOUND"
    res = await client.patch(
        f"{API}/stations/{sid}", headers=admin_headers, json={"location": None}
    )
    assert res.status_code == 200 and res.json()["location"] is None
    manager = await headers_for(client, "t_manager", "MANAGER")
    assert (await client.get(f"{API}/stations", headers=manager)).status_code == 200
    assert (
        await client.post(f"{API}/stations/{sid}/rotate-key", headers=manager)
    ).status_code == 403


@pytest.mark.asyncio
async def test_user_create_issue_card_pin_password(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    login = uniq("t_u_").lower()
    # 약한 비밀번호 422 WEAK_PASSWORD
    res = await client.post(
        f"{API}/users",
        headers=admin_headers,
        json={"login_id": login, "name": "김작업", "role": "WORKER", "password": "short"},
    )
    assert res.status_code == 422 and res.json()["code"] == "WEAK_PASSWORD"
    res = await client.post(
        f"{API}/users",
        headers=admin_headers,
        json={"login_id": login, "name": "김작업", "role": "WORKER", "pin": "12"},
    )
    assert res.status_code == 422
    # WORKER 는 기본 카드 발급 (US-NNNN)
    res = await client.post(
        f"{API}/users",
        headers=admin_headers,
        json={"login_id": login, "name": "김작업", "role": "WORKER", "pin": "1234"},
    )
    assert res.status_code == 201, res.text
    u = res.json()
    assert u["card_code"] and u["card_code"].startswith("US-") and len(u["card_code"]) >= 7
    assert u["has_pin"] is True and u["has_password"] is False
    first_card = u["card_code"]
    # 이미 카드 → 409 CARD_EXISTS, reissue → 새 코드 (이전 코드 무효)
    res = await client.post(f"{API}/users/{u['id']}/issue-card", headers=admin_headers, json={})
    assert res.status_code == 409 and res.json()["code"] == "CARD_EXISTS"
    res = await client.post(
        f"{API}/users/{u['id']}/issue-card", headers=admin_headers, json={"reissue": True}
    )
    assert (
        res.status_code == 200
        and res.json()["card_code"] != first_card
        and res.json()["label_job"] is None
    )
    new_card = res.json()["card_code"]
    assert int(new_card.split("-")[1]) > int(first_card.split("-")[1])
    from app.db.models.order import LabelIssue
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        issues = (
            (
                await s.execute(
                    select(LabelIssue).where(LabelIssue.target_code.in_([first_card, new_card]))
                )
            )
            .scalars()
            .all()
        )
    assert {i.label_type for i in issues} == {"WORKER_CARD"} and len(issues) == 2
    # SALES 는 기본 카드 없음, issue_card=true 로 강제 가능
    res = await client.post(
        f"{API}/users",
        headers=admin_headers,
        json={
            "login_id": uniq("t_s_").lower(),
            "name": "영업",
            "role": "SALES",
            "password": "Sales1234",
        },
    )
    assert (
        res.status_code == 201
        and res.json()["card_code"] is None
        and res.json()["has_password"] is True
    )
    # set-pin / set-password
    res = await client.post(
        f"{API}/users/{u['id']}/set-password",
        headers=admin_headers,
        json={"password": "Worker1234"},
    )
    assert res.status_code == 200 and res.json()["has_password"] is True
    res = await client.post(
        f"{API}/users/{u['id']}/set-pin", headers=admin_headers, json={"pin": "abcd"}
    )
    assert res.status_code == 422
    res = await client.post(
        f"{API}/users/{u['id']}/set-pin", headers=admin_headers, json={"pin": "987654"}
    )
    assert res.status_code == 200
    # 목록 필터 role · q(card_code) · 정렬
    res = await client.get(
        f"{API}/users",
        headers=admin_headers,
        params={"role": "WORKER", "q": new_card, "sort": "-name"},
    )
    assert res.json()["total"] == 1 and res.json()["items"][0]["login_id"] == login
    res = await client.patch(
        f"{API}/users/{u['id']}", headers=admin_headers, json={"name": "김작업2", "role": "MANAGER"}
    )
    assert res.json()["name"] == "김작업2" and res.json()["role"] == "MANAGER"
    assert (await client.post(f"{API}/users/{u['id']}/deactivate", headers=admin_headers)).json()[
        "active"
    ] is False
    assert (await client.post(f"{API}/users/{u['id']}/activate", headers=admin_headers)).json()[
        "active"
    ] is True
    # 중복 login_id
    res = await client.post(
        f"{API}/users",
        headers=admin_headers,
        json={"login_id": login, "name": "x", "role": "VIEWER"},
    )
    assert res.status_code == 409


@pytest.mark.asyncio
async def test_code_settings_get_put(client: AsyncClient, admin_headers: dict[str, str]) -> None:
    res = await client.get(f"{API}/settings/codes", headers=admin_headers)
    assert res.status_code == 200
    cs = res.json()
    assert cs["prefixes"] == {"SO": "SO", "WO": "WO", "LT": "LT", "US": "US"}
    assert cs["seq_digits"] in (4, 5) and cs["checkcode_key_generation"] == 1
    # 접두사 변경 → 422 PREFIX_FIXED · 세대 변경 → 422 READ_ONLY_FIELD
    bad = {**cs, "prefixes": {**cs["prefixes"], "SO": "SA"}}
    res = await client.put(f"{API}/settings/codes", headers=admin_headers, json=bad)
    assert res.status_code == 422 and res.json()["code"] == "PREFIX_FIXED"
    res = await client.put(
        f"{API}/settings/codes", headers=admin_headers, json={**cs, "checkcode_key_generation": 2}
    )
    assert res.status_code == 422 and res.json()["code"] == "READ_ONLY_FIELD"
    # seq_digits 5 → 이후 채번은 5자리
    res = await client.put(
        f"{API}/settings/codes", headers=admin_headers, json={**cs, "seq_digits": 5}
    )
    assert res.status_code == 200 and res.json()["seq_digits"] == 5
    from app.core.sequence import min_seq_digits
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        assert await min_seq_digits(s) == 5
    res = await client.put(
        f"{API}/settings/codes", headers=admin_headers, json={**cs, "seq_digits": 4}
    )
    assert res.json()["seq_digits"] == 4
    manager = await headers_for(client, "t_manager", "MANAGER")
    assert (await client.get(f"{API}/settings/codes", headers=manager)).status_code == 200
    assert (await client.put(f"{API}/settings/codes", headers=manager, json=cs)).status_code == 403


@pytest.mark.asyncio
async def test_audit_log_records_master_changes(
    client: AsyncClient, admin_headers: dict[str, str]
) -> None:
    code = uniq("AU")
    res = await client.post(
        f"{API}/customers", headers=admin_headers, json={"code": code, "name": "감사"}
    )
    cid = res.json()["id"]
    res = await client.patch(
        f"{API}/customers/{cid}",
        headers={**admin_headers, "X-Request-Id": "req-audit-1"},
        json={"name": "감사2"},
    )
    assert res.status_code == 200 and res.headers["X-Request-Id"] == "req-audit-1"
    from app.db.models.ops import AuditLog
    from app.db.session import SessionLocal

    async with SessionLocal() as s:
        logs = (
            (
                await s.execute(
                    select(AuditLog)
                    .where(AuditLog.table_name == "customer", AuditLog.row_id == cid)
                    .order_by(AuditLog.id)
                )
            )
            .scalars()
            .all()
        )
    assert [log.action for log in logs] == ["INSERT", "UPDATE"]
    assert logs[0].before is None and logs[0].after["code"] == code
    assert logs[1].before == {"name": "감사"} and logs[1].after["name"] == "감사2"
    assert logs[1].request_id == "req-audit-1" and logs[1].user_id is not None

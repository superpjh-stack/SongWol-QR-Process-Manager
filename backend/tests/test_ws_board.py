"""S4: ``WS /ws/board`` (api-contract §8) — 접속 직후 ``snapshot``, 스캔 커밋 후 ``wo_updated``.

FastAPI 의 WebSocket 은 ``starlette.testclient.TestClient`` 로만 테스트할 수 있다(httpx
``AsyncClient``/``ASGITransport`` 는 WS 를 지원하지 않는다) — 이 파일만 **동기** 테스트
함수를 쓴다. ``TestClient`` 는 앱을 별도 스레드+이벤트루프(포털)에서 돌리므로, 같은 프로세스의
전역 비동기 엔진(``app.db.session.engine``)을 pytest-asyncio 의 루프와 섞어 쓰면 "다른
이벤트루프에 붙은 Future" 오류가 난다 — 그래서 이 파일의 모든 DB 접근은 ``TestClient`` 를
통한 HTTP 호출로만 하고, ORM 직접 접근이 필요한 준비 단계(관리자 사용자 생성)는
``asyncio.run()`` 으로 완전히 분리된 루프에서 실행한 뒤 ``engine.dispose()`` 로 커넥션 풀을
비운다(다음 절이 새 루프를 또 쓸 수 있게).
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, date, datetime, timedelta

from starlette.testclient import TestClient

from app.core.checkcode import make_check
from app.db.session import SessionLocal, engine
from app.domain.board import delay_job
from tests.conftest import TEST_ADMIN_LOGIN, TEST_ADMIN_PASSWORD, ensure_user, uniq
from tests.helpers_order import png_bytes

API = "/api/v1"


def _setup_admin() -> None:
    asyncio.run(ensure_user(TEST_ADMIN_LOGIN, "ADMIN", password=TEST_ADMIN_PASSWORD))
    asyncio.run(engine.dispose())


def _login(client: TestClient) -> dict[str, str]:
    res = client.post(
        f"{API}/auth/login",
        json={"login_id": TEST_ADMIN_LOGIN, "password": TEST_ADMIN_PASSWORD},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


def _issue_simple_wo(
    client: TestClient, headers: dict[str, str], *, due_date: str = "2026-10-10"
) -> dict[str, object]:
    """거래처·품목·라우팅(SCREEN)·수주·도안 확정·발행까지 동기 HTTP 로 직접 만든다
    (``tests/helpers_order.py`` 는 async 라 이 파일에서 못 쓴다). ``due_date`` 를 과거로
    주면 지연 감지 잡(§6.5) 대상 WO 를 만들 수 있다(``test_delay_job_broadcasts_...``)."""
    group = uniq("TG")
    res = client.post(f"{API}/item-groups", headers=headers, json={"code": group, "name": group})
    assert res.status_code == 201, res.text

    ccode = uniq("C")
    res = client.post(
        f"{API}/customers",
        headers=headers,
        json={"code": ccode, "name": f"거래처 {ccode}", "phone": "02-000-0000"},
    )
    assert res.status_code == 201, res.text
    cust = res.json()
    res = client.post(
        f"{API}/customers/{cust['id']}/addresses",
        headers=headers,
        json={
            "label": "본사",
            "receiver": "수령인",
            "phone": "010-1111-2222",
            "address1": "부산 1",
            "is_default": True,
        },
    )
    assert res.status_code == 201, res.text
    addr = res.json()

    icode = uniq("I")
    res = client.post(
        f"{API}/items",
        headers=headers,
        json={
            "code": icode,
            "name": f"타월 {icode}",
            "item_group": group,
            "qty_tolerance_pct": 3.0,
        },
    )
    assert res.status_code == 201, res.text
    item = res.json()

    steps = [
        {"seq": 1, "process_code": "P20", "std_lead_hours": 8, "tolerance_pct": None},
        {"seq": 2, "process_code": "P30", "std_lead_hours": 24, "tolerance_pct": 2.5},
        {"seq": 3, "process_code": "P50", "std_lead_hours": 8, "tolerance_pct": None},
        {"seq": 4, "process_code": "P60", "std_lead_hours": 4, "tolerance_pct": None},
    ]
    res = client.post(
        f"{API}/routings",
        headers=headers,
        json={"item_group": group, "print_method": "SCREEN", "steps": steps},
    )
    assert res.status_code == 201, res.text

    res = client.post(
        f"{API}/so",
        headers=headers,
        json={
            "customer_id": cust["id"],
            "order_date": "2026-10-01",
            "due_date": due_date,
            "address_id": addr["id"],
            "lines": [{"item_id": item["id"], "print_method": "SCREEN", "qty": 500}],
        },
    )
    assert res.status_code == 201, res.text
    so = res.json()
    line_id = so["lines"][0]["id"]

    res = client.post(
        f"{API}/so/{so['id']}/lines/{line_id}/design",
        headers=headers,
        files={"file": ("d.png", png_bytes(), "image/png")},
    )
    assert res.status_code == 201, res.text
    res = client.post(f"{API}/so/{so['id']}/lines/{line_id}/design/confirm", headers=headers)
    assert res.status_code == 200, res.text

    res = client.post(f"{API}/so/{so['id']}/propose-wo", headers=headers)
    assert res.status_code == 200, res.text
    drafts = res.json()["items"]
    res = client.post(f"{API}/so/{so['id']}/issue-wo", headers=headers, json={"drafts": drafts})
    assert res.status_code == 200, res.text
    wo = res.json()["work_orders"][0]
    return {"wo": wo, "so": so}


def _make_station(
    client: TestClient, headers: dict[str, str], process_code: str
) -> tuple[str, str]:
    sid = uniq("T-K-WS-")
    res = client.post(
        f"{API}/stations",
        headers=headers,
        json={"id": sid, "type": "KIOSK", "process_code": process_code},
    )
    assert res.status_code == 201, res.text
    return sid, res.json()["api_key"]


def test_ws_board_snapshot_on_connect_and_wo_updated_after_scan() -> None:
    _setup_admin()
    from app.main import app

    try:
        with TestClient(app) as client:
            headers = _login(client)
            created = _issue_simple_wo(client, headers)
            wo = created["wo"]
            assert isinstance(wo, dict)
            wo_code = wo["code"]

            p30_station, p30_key = _make_station(client, headers, "P30")
            res = client.post(
                f"{API}/equipment",
                headers=headers,
                json={
                    "code": uniq("PRT"),
                    "name": "설비",
                    "process_code": "P30",
                    "equip_type": "PRINT",
                },
            )
            assert res.status_code == 201, res.text
            eq_code = res.json()["code"]

            res = client.post(
                f"{API}/users",
                headers=headers,
                json={"login_id": uniq("w").lower(), "name": "작업자", "role": "WORKER"},
            )
            assert res.status_code == 201, res.text
            worker_card = res.json()["card_code"]
            assert worker_card

            token = headers["Authorization"].split(" ", 1)[1]
            with client.websocket_connect(f"/ws/board?token={token}") as ws:
                snap = ws.receive_json()
                assert snap["type"] == "snapshot"
                assert "summary" in snap and "today_due" in snap["summary"]

                body = {
                    "event_uuid": str(uuid.uuid4()),
                    "scanned_at": datetime.now(UTC).isoformat(),
                    "station_id": p30_station,
                    "worker_card": worker_card,
                    "code": wo_code,
                    "check": make_check(wo_code),
                    "action": "DONE",
                    "equipment_code": eq_code,
                    "qty_good": 500,
                    "qty_bad": 0,
                }
                res = client.post(
                    f"{API}/scan", headers={"X-Station-Key": p30_key}, json=body
                )
                assert res.status_code == 200, res.text
                scan_result = res.json()
                # P20 이 아직 미완료라 E1 로 보류될 수 있다 — 어느 쪽이든 wo_updated 또는
                # approval_pending 중 하나가 온다(§8 표: "스캔 반영·승인" 모두 브로드캐스트
                # 대상).
                msg = ws.receive_json()
                assert msg["type"] in ("wo_updated", "approval_pending")
                if msg["type"] == "wo_updated":
                    assert msg["wo"]["code"] == wo_code
                else:
                    assert scan_result["requires_approval"] is True
    finally:
        asyncio.run(engine.dispose())


async def _run_delay_detection() -> delay_job.DelayRunResult:
    async with SessionLocal() as session:
        return await delay_job.run_delay_detection(session)


def test_delay_job_broadcasts_new_notification_and_skips_on_dedupe() -> None:
    """DEF-QA2-S4-002 회귀 (중): 지연 감지 잡이 DB 에 알림 행은 만들면서도
    ``ws/broadcast.py::broadcast_notification()`` 을 부르지 않아 ``/board`` Ticker 가 알림을
    영영 못 받던 결함. 새로 만든 알림은 커밋 직후 ``notification`` WS 메시지로 브로드캐스트되고,
    dedupe 로 건너뛴(신규가 아닌) 실행은 아무것도 브로드캐스트하지 않아야 한다.

    ``run_delay_detection`` 은 ``TestClient`` 의 WS 연결과 같은 이벤트루프(포털)에서 돌려야
    한다 — ``asyncio.run()`` 으로 별도 루프에서 돌리면 ``manager.broadcast()`` 가 다른
    루프에 붙은 WebSocket 으로 전송을 시도해 실패한다(이 파일 모듈 docstring의 경고와 같은
    종류의 함정). ``client.portal.call()`` 로 TestClient 자신의 루프에서 실행한다.
    """
    _setup_admin()
    from app.main import app

    try:
        with TestClient(app) as client:
            headers = _login(client)
            past_due = (date.today() - timedelta(days=1)).isoformat()
            created_a = _issue_simple_wo(client, headers, due_date=past_due)
            wo_a = created_a["wo"]
            assert isinstance(wo_a, dict)
            wo_a_code = wo_a["code"]

            token = headers["Authorization"].split(" ", 1)[1]
            with client.websocket_connect(f"/ws/board?token={token}") as ws:
                snap = ws.receive_json()
                assert snap["type"] == "snapshot"

                assert client.portal is not None
                first = client.portal.call(_run_delay_detection)
                assert first.notifications_created >= 1

                msg = ws.receive_json()
                assert msg["type"] == "notification"
                assert msg["notification"]["type"] == "DELAY"
                assert msg["notification"]["target_code"] == wo_a_code

                # 같은 날 재실행 — dedupe 로 새 알림 없음 → 브로드캐스트도 없어야 한다.
                second = client.portal.call(_run_delay_detection)
                assert second.notifications_created == 0

                # 새로 지연된 WO 를 하나 더 만들어(issue-wo 자체가 wo_updated 1건을 먼저
                # 브로드캐스트한다 — 그 다음 메시지가 곧바로 세 번째 실행의 신규 notification
                # 이어야 한다) 세 번째 실행에서 "진짜 신규" 브로드캐스트를 검증한다. dedupe
                # 실행(second)이 잘못 브로드캐스트했다면 그 유령 메시지가 큐에 먼저 있어
                # "다음 메시지 = wo_updated" 단언이 깨진다 — 이렇게 무-브로드캐스트를 검증한다.
                created_b = _issue_simple_wo(client, headers, due_date=past_due)
                wo_b = created_b["wo"]
                assert isinstance(wo_b, dict)
                wo_b_code = wo_b["code"]

                msg_issue = ws.receive_json()
                assert msg_issue["type"] == "wo_updated"
                assert msg_issue["wo"]["code"] == wo_b_code

                third = client.portal.call(_run_delay_detection)
                assert third.notifications_created >= 1

                msg2 = ws.receive_json()
                assert msg2["type"] == "notification"
                assert msg2["notification"]["target_code"] == wo_b_code
    finally:
        asyncio.run(engine.dispose())


def test_ws_board_rejects_bad_token() -> None:
    _setup_admin()
    from starlette.websockets import WebSocketDisconnect

    from app.main import app

    try:
        with TestClient(app) as client:
            try:
                with client.websocket_connect("/ws/board?token=not-a-real-jwt"):
                    raise AssertionError("인증 실패인데 접속이 성공했습니다")
            except WebSocketDisconnect as e:
                assert e.code == 4401
    finally:
        asyncio.run(engine.dispose())

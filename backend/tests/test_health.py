from datetime import datetime

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health_returns_200_with_db_status() -> None:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        res = await client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["db"] in ("ok", "error")
    # ISO8601 UTC
    parsed = datetime.fromisoformat(body["time"])
    assert parsed.tzinfo is not None
    assert parsed.utcoffset() is not None and parsed.utcoffset().total_seconds() == 0

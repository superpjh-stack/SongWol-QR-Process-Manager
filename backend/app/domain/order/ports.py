"""다른 도메인으로 나가는 훅 (동시 개발 중이라 직접 import 하지 않는다).

``issue_labels_for_wo(session, wo, issued_by)`` — WO 발행 시 라벨·QR 발행(label_issue
WORK_ORDER_PDF · WO_LABEL, api-contract §7.3 issue-wo). ``issued_by`` 는 발행한 사용자 id
(label_issue.issued_by, DEF-QA1-S1-002). 기본 구현은 **no-op + 로그**. 개발B 가
``app/domain/label`` 서비스 함수를 ``set_label_issuer()`` 로 연결한다
(``app.domain.label.service.label_issuer``).

발행 트랜잭션 안에서 호출된다 (session 은 아직 commit 전). 훅이 예외를 올리면 발행 전체가
롤백된다 — 프린터 실패 같은 「라벨만 실패」는 훅 안에서 label_job.error 로 표현해야 한다
(§13.7 원칙: 데이터는 커밋, 실패는 화면에).
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.order import WorkOrder

logger = logging.getLogger(__name__)

LabelIssuer = Callable[[AsyncSession, WorkOrder, int | None], Awaitable[None]]


async def _noop_label_issuer(session: AsyncSession, wo: WorkOrder, issued_by: int | None) -> None:
    logger.info("issue_labels_for_wo: no label issuer connected — skipped for %s", wo.code)


_label_issuer: LabelIssuer = _noop_label_issuer


def set_label_issuer(fn: LabelIssuer) -> None:
    """개발B 가 앱 기동 시(또는 라벨 모듈 import 시) 실제 구현을 꽂는다."""
    global _label_issuer
    _label_issuer = fn


async def issue_labels_for_wo(
    session: AsyncSession, wo: WorkOrder, issued_by: int | None = None
) -> None:
    """WO 발행 직후 라벨 발행 훅. ``issued_by`` = 발행한 사용자(label_issue.issued_by,
    DEF-QA1-S1-002). 기본은 no-op."""
    await _label_issuer(session, wo, issued_by)


def so_pdf_url(so_code: str) -> str:
    """IssueWoResponse.pdf_url — 작업지시서 PDF 경로 (api-contract §7.7, 개발B 구현)."""
    return f"/api/v1/labels/so/{so_code}.pdf"

"""공통 부트스트랩: 앱(main)·시드·스크립트가 세션을 쓰기 전에 한 번 호출한다.

- audit_log 훅 설치 (DEF-QA2-005: seed 경로도 감사 대상)
멱등이다.
"""

from app.db.audit import install_audit_hooks


def bootstrap() -> None:
    install_audit_hooks()

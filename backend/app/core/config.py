"""환경 설정 (pydantic-settings).

값은 환경변수 또는 저장소 루트의 ``.env`` 에서 읽는다. ``.env`` 는 git 에서 제외한다.
시크릿(JWT_SECRET, CHECKCODE_SECRET)은 기본값이 없으므로 반드시 설정해야 한다.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/app/core/config.py → 저장소 루트
_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", _REPO_ROOT / "backend" / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "songwol-qr"
    debug: bool = False

    # DB: postgresql+asyncpg://user:pass@host:port/dbname
    database_url: str = "postgresql+asyncpg://localhost:5432/songwol_qr"

    # 인증·체크코드 (spec §13: 체크코드 비밀키는 환경변수)
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 12
    checkcode_secret: str
    # 체크코드 비밀키 회전 (plan §5.1: 구 secret 도 검증 허용, 2세대). 비어 있으면 회전 중이 아님.
    checkcode_secret_prev: str | None = None
    # 시드 admin 비밀번호 (db-schema §10).
    # 없으면 admin 행은 password_hash NULL (로그인 불가) 로 만든다.
    seed_admin_password: str | None = None

    # 시간대: 표시는 Asia/Seoul, 서버 저장은 UTC (spec §13)
    tz: str = "Asia/Seoul"

    # QR URL · 단말 등록 URL 의 호스트 (api-contract §9, §13.2 admin #15). 예 https://qr.songwol.co.kr
    public_host: str = "http://localhost:5173"

    # 엑셀 일괄 등록 원본 보관 위치 (spec §12.2 「원본 엑셀 파일은 해시와 함께 보관」).
    # commit 이 이 파일을 다시 읽는다. 기본 backend/var/imports (git 제외).
    import_dir: str = str(_REPO_ROOT / "backend" / "var" / "imports")
    # api-contract §13.3 admin #22: 최대 5MB · 5,000행
    import_max_bytes: int = 5 * 1024 * 1024
    import_max_rows: int = 5000

    # 라벨 프린터 (ZPL → TCP 9100). Phase 0 에서는 자리만 둔다.
    printer_host: str = ""
    printer_port: int = 9100


@lru_cache
def get_settings() -> Settings:
    return Settings()  # 시크릿(jwt_secret, checkcode_secret)은 .env / 환경변수에서 채운다

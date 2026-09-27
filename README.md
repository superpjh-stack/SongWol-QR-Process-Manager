# songwol-qr — 송월타월 QR 공정관리시스템

FastAPI + PostgreSQL 백엔드, React PWA 프론트. 설계 문서 위치는 `docs/README.md` 참고.

## 요구 도구
- Python **3.12** (macOS homebrew: `/opt/homebrew/bin/python3.12`. `python3` 가 3.14 이면 쓰지 않는다)
- Node 24 / npm 11
- PostgreSQL 16+ (로컬 개발기는 17.10, 포트 5432)
- Docker (선택, `infra/docker-compose.yml`)

## 처음 실행
```bash
# 0. 환경변수
cp .env.example .env            # JWT_SECRET, CHECKCODE_SECRET 를 채운다

# 1. DB
createdb -h localhost songwol_qr # 이미 있으면 생략

# 2. backend
cd backend
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --port 8000 --reload
curl localhost:8000/health       # {"status":"ok","db":"ok","time":"...Z"}

# 3. web (다른 터미널)
cd web
npm install
npm run dev                      # http://localhost:5173, /api·/ws 는 :8000 으로 proxy

# 4. 검증
cd backend && .venv/bin/ruff check . && .venv/bin/mypy app && .venv/bin/pytest -q
cd web && npm run lint && npx tsc --noEmit && npm run build
```

## 포트
| 용도 | 포트 |
|---|---|
| backend (uvicorn) | 8000 |
| web (vite dev) | 5173 |
| 로컬 PostgreSQL | 5432 |
| docker compose postgres | **5433** (로컬 PostgreSQL 이 5432 를 쓰므로) |
| 라벨 프린터 (ZPL) | 9100 |

## 마이그레이션 · 시드 · 파티션
```bash
cd backend
.venv/bin/alembic upgrade head           # 0001_master → 0002_order → 0003_events_material_shipping → 0004_ops_views
.venv/bin/alembic check                  # 모델(app/db/models) ↔ DB 차이 없으면 "No new upgrade operations detected"
.venv/bin/python -m app.db.seed          # db-schema §10 시드 (멱등). --dev-stations 로 개발 단말 6대 + API key 1회 출력
cd .. && set -a && . ./.env && set +a
backend/.venv/bin/python infra/scripts/create_partitions.py --months-ahead 3   # scan_event 월 파티션 (cron 월 1회)
```
- Alembic 은 `mes` 스키마만 관리한다 (같은 DB 서버를 데이터관리시스템·AI Agent 와 공유). `alembic_version` 도 `mes` 에 있어
  env.py 가 첫 실행 전에 `CREATE SCHEMA IF NOT EXISTS mes` 를 별도 트랜잭션으로 실행한다.
- 모델은 `app/db/models/<도메인>.py` (master · order · scan · material · shipping · ops). 단일 진실은
  문서 폴더의 `contracts/db-schema.md` 다. 상태값은 `app/db/models/enums.py` 의 `StrEnum`, DB 는 VARCHAR + CHECK.
- `scan_event` 는 `received_at` 월 RANGE 파티션. DEFAULT 파티션이 없으므로 파티션이 없는 달의 INSERT 는 실패한다
  (의도). 0003 리비전이 이번 달 ~ +3개월을 만들고, 이후는 `create_partitions.py` 가 만든다.
- `scan_event.id` 만 시퀀스 기본값(bigserial 동등)이다: PG 16 은 파티션 테이블에 IDENTITY 를 허용하지 않는다.
- 시드의 admin 비밀번호는 `SEED_ADMIN_PASSWORD`. 없으면 admin 은 password_hash NULL(로그인 불가) 로 만들어지고
  나중에 환경변수를 넣고 `python -m app.db.seed` 를 다시 돌리면 갱신된다.
- 채번은 `app/core/sequence.py` (`code_sequence` 행 `SELECT … FOR UPDATE`, Asia/Seoul 일자 경계),
  체크코드·QR 파싱은 `app/core/checkcode.py` (`CHECKCODE_SECRET`, 회전 시 `CHECKCODE_SECRET_PREV`).

## API (S0-3 인증 · S0-5 기준정보 · S0-6 엑셀 일괄 등록)
- 경로·요청·응답·오류·권한의 단일 진실은 문서 폴더 `contracts/api-contract.md` (§13 델타 v0.2 우선). Swagger: `/docs`.
- 인증: `POST /api/v1/auth/login` → JWT(12h, `Authorization: Bearer`). 단말은 `X-Station-Key` (SHA-256 해시 대조,
  요청마다 `last_seen_at` 갱신). 작업자 로그인 `POST /auth/worker` (카드 `US-NNNN` 또는 login_id+PIN, 5회 실패 15분 잠금).
  역할 가드는 `app/api/deps.py::require_roles`, 역할 집합은 `app/api/permissions.py`.
- 오류는 전부 `{code, message, detail[]}` (`app/core/errors.py::ApiError` + `app/main.py` 핸들러).
  응답 헤더 `X-Request-Id` 는 `audit_log.request_id` 로 남는다.
- 기준정보 변경은 `app/db/audit.py` 의 `before_flush`/`after_flush_postexec` 훅이 `audit_log` 에 before/after 로 기록한다.
- Pydantic 스키마는 `app/api/v1/schemas/*.py` (ts-types.md 와 클래스명 1:1). 서비스·라우터는 `app/domain/<도메인>/`.
- 코드 체계(ADM-10) 저장처는 `app_setting.CODE_SETTINGS`. `seq_digits` 는 채번(`app/core/sequence.py`)이 매번 읽는다.
  접두사는 S0 에서 SO/WO/LT/US 고정(422 `PREFIX_FIXED`).
- 엑셀 임포트: `GET /master/import/template?entity=` → `POST /master/import/preview`(multipart, 201, PREVIEW 배치)
  → `POST /master/import/{batch_id}/commit {merge_policy, skip_invalid?}`. 원본은 `IMPORT_DIR`(기본 `backend/var/imports`)
  에 `{batch_id}.xlsx` 로 보관되고 commit 이 다시 읽어 재검증한다. 5MB · 5,000행. entity=stock 은 S5.
- 단말 등록: `POST /stations` 201 응답에 `api_key`·`setup_url`·`setup_qr_png` 1회. `PUBLIC_HOST` 로 URL 을 만든다.
- 품목군 개발 시드: `python -m app.db.seed --dev-item-groups` (TOWEL_40 · TOWEL_50, 미결 U-1).

## 테스트
```bash
cd backend && .venv/bin/pytest -q
```
- 테스트 DB 는 `DATABASE_URL` 의 DB 이름 + `_test` (기본 `songwol_qr_test`). 없으면 conftest 가 만든다.
- 세션 시작 시 `alembic upgrade head → downgrade base → upgrade head` 왕복을 실제로 돈다.
- `tests/test_sequence.py` 는 실 DB 로 100 코루틴 동시 채번 중복 0 을 확인한다.
- 문서 폴더 `tools/seed_check.py` 가 테이블·제약·시드·파티션·뷰·캐시 대사를 요약한다:
  `backend/.venv/bin/python "<docs>/tools/seed_check.py"`.

## QA 도구 (문서 폴더 `tools/`, 코드 리포 밖)
```bash
# 실서버를 띄운 뒤 (예: --port 8011, 같은 DB 에 alembic upgrade head + seed 선행)
backend/.venv/bin/python "<docs>/tools/check_contract.py" --openapi http://127.0.0.1:8011/openapi.json   # OpenAPI ↔ api-contract ↔ ts-types
backend/.venv/bin/python "<docs>/tools/qa_s0_api.py" --base http://127.0.0.1:8011                          # 기능·계약 실호출 (QA①)
backend/.venv/bin/python "<docs>/tools/qa_s0_data.py" --base http://localhost:8012 \
    --dsn postgresql://localhost:5432/songwol_qr_qa2 --admin-password '<seed admin 비밀번호>'              # 데이터 정합·비기능 (QA②, 전용 DB)
```
- 두 QA 스크립트는 실행마다 `QA1-`/`qa2` 접두사 데이터를 만든다 — 개발 DB 가 아니라 전용 DB 에 돌린다.
- qa_s0_data 의 B2-15 는 admin 비밀번호를 20회 틀린다 → D27 이후 admin 이 15분 잠긴다(429 LOGIN_LOCKED). 이어지는 admin 로그인은 잠금 해제 후.

## 주의
- `.env` 와 `migration/samples/` 는 git 에 올리지 않는다.
- 시간대: 표시 `Asia/Seoul`, 저장 UTC.
- `weasyprint` 는 시스템 라이브러리(pango/cairo) 의존으로 `pyproject.toml` 에 주석만 있다. 라벨/PDF 웨이브에서 Docker 이미지와 함께 추가.
- `passlib 1.7.4` 는 `bcrypt 5.x` 와 조합 시 경고/오류가 알려져 있다. PIN 해시 구현 시 `bcrypt<5` 고정 또는 `bcrypt` 직접 사용을 결정할 것.
- `infra/scripts/backup.sh` 는 스텁(TODO)이며 실행 시 exit 1 을 돌려준다. `create_partitions.py` 는 동작한다.

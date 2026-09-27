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

## 마이그레이션
```bash
cd backend
.venv/bin/alembic revision --autogenerate -m "..."   # 모델을 alembic/env.py 에 import 한 뒤
.venv/bin/alembic upgrade head
```
Alembic 은 `mes` 스키마만 관리한다 (같은 DB 서버를 데이터관리시스템·AI Agent 와 공유).

## 주의
- `.env` 와 `migration/samples/` 는 git 에 올리지 않는다.
- 시간대: 표시 `Asia/Seoul`, 저장 UTC.
- `weasyprint` 는 시스템 라이브러리(pango/cairo) 의존으로 `pyproject.toml` 에 주석만 있다. 라벨/PDF 웨이브에서 Docker 이미지와 함께 추가.
- `passlib 1.7.4` 는 `bcrypt 5.x` 와 조합 시 경고/오류가 알려져 있다. PIN 해시 구현 시 `bcrypt<5` 고정 또는 `bcrypt` 직접 사용을 결정할 것.
- `infra/scripts/*` 는 스텁(TODO)이며 실행 시 exit 1 을 돌려준다.

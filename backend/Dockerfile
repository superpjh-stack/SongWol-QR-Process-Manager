# 운영 배포용 백엔드 이미지 (plan §5.4). 빌드 컨텍스트는 저장소 루트(`..`)여야 한다 —
# alembic 0003 이 `infra/scripts/create_partitions.py` 를 파일 경로로 import 하므로
# 그 스크립트가 이미지 안에 같이 있어야 한다(RISK-1, progress.md).
FROM python:3.12-slim AS base

# WeasyPrint(작업지시서 PDF) 시스템 의존성 + 한글 폰트(fonts-nanum, RISK-S1-5) +
# cron·postgresql-client(같은 이미지를 backup/파티션 cron 서비스로도 재사용, infra/docker-compose.prod.yml).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 libpangoft2-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 libffi8 \
    fonts-nanum cron postgresql-client rsync \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/share/zoneinfo/Asia/Seoul /etc/localtime && echo "Asia/Seoul" > /etc/timezone

# backend/ 와 infra/ 를 저장소와 같은 형제 디렉터리 구조로 둔다 — 0003 마이그레이션이
# `Path(__file__).resolve().parents[3]`(= backend/alembic/versions 에서 3단계 위 = 이 /app)
# 기준으로 `infra/scripts/create_partitions.py` 를 찾기 때문에, backend/ 를 /app 에 바로
# 풀어버리면(평탄화) 한 단계가 모자라 경로를 못 찾는다(실제로 겪은 배포 실패, 2026-09-29).
WORKDIR /app/backend

COPY backend/pyproject.toml ./
# 소스 없이 의존성만 먼저 설치해 레이어 캐시를 살린다.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e . 2>/dev/null || true

COPY backend/ ./
COPY infra/scripts /app/infra/scripts

RUN pip install --no-cache-dir -e .

ENV PYTHONUNBUFFERED=1 TZ=Asia/Seoul

EXPOSE 8000

# 기동 시 매번 마이그레이션을 최신으로 맞춘다(멱등, alembic upgrade head).
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2"]

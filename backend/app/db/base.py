"""SQLAlchemy DeclarativeBase.

도메인 모델은 ``app/db/models/<도메인>.py`` 에 있다 (contracts/db-schema.md §1:
master · order · scan · material · shipping · ops).
``alembic/env.py`` 가 ``Base.metadata`` 를 autogenerate 비교 대상으로 쓴다.
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# spec §10: 데이터관리시스템·AI Agent 와 DB 서버를 공유하되 스키마를 분리한다.
SCHEMA = "mes"

# db-schema §1 명명: ix_<table>_<cols> · uq_<table>_<cols> · fk_<table>_<col> · ck_<table>_<name>
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)

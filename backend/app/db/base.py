"""SQLAlchemy DeclarativeBase.

도메인 모델은 아직 없다. 다음 웨이브에서 각 ``app/domain/*/models.py`` 가 ``Base`` 를 상속하고,
``alembic/env.py`` 가 ``Base.metadata`` 를 autogenerate 대상으로 쓴다.
"""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# spec §10: 데이터관리시스템·AI Agent 와 DB 서버를 공유하되 스키마를 분리한다.
SCHEMA = "mes"

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)

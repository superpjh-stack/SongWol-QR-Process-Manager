"""``/api/v1`` 라우터 집합. 도메인 라우터는 여기에만 붙인다."""

from fastapi import APIRouter

from app.api.v1 import auth
from app.domain.master import admin_router, import_router
from app.domain.master import router as master_router

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(auth.router)
api_v1.include_router(master_router.router)
api_v1.include_router(admin_router.router)
api_v1.include_router(import_router.router)

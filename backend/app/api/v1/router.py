"""``/api/v1`` 라우터 집합. 도메인 라우터는 여기에만 붙인다."""

from fastapi import APIRouter

from app.api.v1 import auth
from app.domain.label import router as label_router
from app.domain.master import admin_router, import_router
from app.domain.master import router as master_router
from app.domain.material import router as material_router
from app.domain.order import q_router, wo_router
from app.domain.order import router as order_router
from app.domain.scan import router as scan_router
from app.domain.shipping import router as shipping_router

api_v1 = APIRouter(prefix="/api/v1")
api_v1.include_router(auth.router)
api_v1.include_router(master_router.router)
api_v1.include_router(admin_router.router)
api_v1.include_router(import_router.router)
api_v1.include_router(label_router.router)
api_v1.include_router(order_router.router)
api_v1.include_router(wo_router.router)
api_v1.include_router(scan_router.router)
api_v1.include_router(material_router.router)
api_v1.include_router(shipping_router.router)
api_v1.include_router(q_router.router)

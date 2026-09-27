"""권한 매트릭스 (api-contract §4 · §13.8) — 역할 집합 상수.

라우터가 ``require_roles(*X)`` 로 쓴다.
"""

ALL_USER_ROLES = ("ADMIN", "MANAGER", "SALES", "WORKER", "VIEWER")

# 기준정보 거래처·품목·품목군 (A1-01/02/11 + admin #9)
CUSTOMER_ITEM_READ = ("ADMIN", "MANAGER", "SALES", "WORKER")  # + STATION
CUSTOMER_ITEM_WRITE = ("ADMIN", "SALES")
ITEM_GROUP_WRITE = ("ADMIN", "MANAGER")  # §13.8 「품목군·택배사 마스터」

# 공정·설비·가공방식·라우팅 (A1-03~06)
ROUTING_READ = ("ADMIN", "MANAGER", "SALES", "WORKER")  # + STATION
ROUTING_WRITE = ("ADMIN", "MANAGER")
PROCESS_CREATE = ("ADMIN",)

# 단말·사용자·프린터·라벨양식·코드체계 (A1-07~10)
ADMIN_MASTER_READ = ("ADMIN", "MANAGER")
ADMIN_MASTER_WRITE = ("ADMIN",)

# 엑셀 임포트 (A1-11 · §13.1 admin #13)
IMPORT_CUSTOMER_ITEM = ("ADMIN", "SALES")
IMPORT_STOCK = ("ADMIN", "MANAGER")

# 감사 로그·마이그레이션
MIGRATION_READ = ("ADMIN", "MANAGER")
MIGRATION_WRITE = ("ADMIN",)

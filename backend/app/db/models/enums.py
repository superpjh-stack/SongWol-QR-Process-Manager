"""상태값 열거 (spec §2.3 · db-schema).

DB 는 VARCHAR + CHECK 로 저장한다 (PG ENUM 미사용, db-schema §12-21).
여기의 값이 CHECK 목록의 원천이다.
"""

from enum import StrEnum


def sql_in(column: str, enum_cls: type[StrEnum]) -> str:
    """``col IN ('A','B',…)`` CHECK 본문."""
    values = ", ".join(f"'{m.value}'" for m in enum_cls)
    return f"{column} IN ({values})"


class EquipType(StrEnum):
    PRINT = "PRINT"
    TRANSFER = "TRANSFER"
    DTF = "DTF"
    EMB = "EMB"


class StationType(StrEnum):
    KIOSK = "KIOSK"
    PDA = "PDA"
    TOUCHPC = "TOUCHPC"
    BOARD = "BOARD"
    ADMIN = "ADMIN"


class Role(StrEnum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    SALES = "SALES"
    WORKER = "WORKER"
    VIEWER = "VIEWER"


class PrinterPurpose(StrEnum):
    PRODUCTION = "PRODUCTION"
    PACKING = "PACKING"


class CodePrefix(StrEnum):
    SO = "SO"
    WO = "WO"
    LT = "LT"
    US = "US"


class SoStatus(StrEnum):
    OPEN = "OPEN"
    IN_PROGRESS = "IN_PROGRESS"
    PARTIAL_SHIPPED = "PARTIAL_SHIPPED"
    SHIPPED = "SHIPPED"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"


class WoStatus(StrEnum):
    DRAFT = "DRAFT"
    ISSUED = "ISSUED"
    IN_PROGRESS = "IN_PROGRESS"
    PACKED = "PACKED"
    SHIPPED = "SHIPPED"
    CLOSED = "CLOSED"
    ON_HOLD = "ON_HOLD"
    CANCELLED = "CANCELLED"


class ReceiptStatus(StrEnum):
    NONE = "NONE"
    PARTIAL = "PARTIAL"
    FULL = "FULL"
    OVER = "OVER"


class StepStatus(StrEnum):
    WAITING = "WAITING"
    STARTED = "STARTED"
    DONE = "DONE"
    DONE_ESTIMATED = "DONE_ESTIMATED"
    PARTIAL = "PARTIAL"
    SKIPPED = "SKIPPED"


class LabelTargetType(StrEnum):
    SO = "SO"
    WO = "WO"
    LT = "LT"
    US = "US"


class LabelType(StrEnum):
    WORK_ORDER_PDF = "WORK_ORDER_PDF"
    WO_LABEL = "WO_LABEL"
    BOX_LABEL = "BOX_LABEL"
    WORKER_CARD = "WORKER_CARD"


class ScanTargetType(StrEnum):
    SO = "SO"
    WO = "WO"
    LT = "LT"
    US = "US"
    VB = "VB"


class ScanAction(StrEnum):
    START = "START"
    DONE = "DONE"
    RECEIVE = "RECEIVE"
    PACK = "PACK"
    SHIP = "SHIP"
    LOGIN = "LOGIN"
    CANCEL = "CANCEL"
    REPRINT = "REPRINT"
    APPROVE = "APPROVE"
    MAP = "MAP"


class ScanResult(StrEnum):
    OK = "OK"
    WARN = "WARN"
    REJECT = "REJECT"


class ApprovalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"


class LotStatus(StrEnum):
    OK = "OK"
    QUARANTINE = "QUARANTINE"


class Inspection(StrEnum):
    PASS = "PASS"
    COND = "COND"
    FAIL = "FAIL"


class StockTxnType(StrEnum):
    MIGRATE = "MIGRATE"
    RECEIVE = "RECEIVE"
    SHIP = "SHIP"
    ADJUST = "ADJUST"
    REWORK = "REWORK"


class StockSource(StrEnum):
    IMS_XLS = "IMS_XLS"
    NEW = "NEW"
    COUNT = "COUNT"


class ShipmentStatus(StrEnum):
    READY = "READY"
    SHIPPED = "SHIPPED"
    DELIVERED = "DELIVERED"


class NotificationType(StrEnum):
    DELAY = "DELAY"
    DEFECT = "DEFECT"
    RECEIPT_SHORT = "RECEIPT_SHORT"
    QTY_VARIANCE = "QTY_VARIANCE"
    APPROVAL_REQUEST = "APPROVAL_REQUEST"
    OFFLINE_BACKLOG = "OFFLINE_BACKLOG"


class NotificationChannel(StrEnum):
    KAKAO = "KAKAO"
    SMS = "SMS"
    PUSH = "PUSH"
    EMAIL = "EMAIL"
    INAPP = "INAPP"


class AuditAction(StrEnum):
    INSERT = "INSERT"
    UPDATE = "UPDATE"
    DELETE = "DELETE"
    APPROVE = "APPROVE"


class MigrationSource(StrEnum):
    IMS_XLS = "IMS_XLS"
    COUNT = "COUNT"


class MigrationStatus(StrEnum):
    PREVIEW = "PREVIEW"
    LOADED = "LOADED"
    FAILED = "FAILED"
    ROLLED_BACK = "ROLLED_BACK"

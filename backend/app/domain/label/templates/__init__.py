"""기본 라벨 양식 (Jinja2). 리비전 0005 가 label_template 테이블 시드로 적재한다.

``TEST.zpl.j2`` 는 프린터 테스트 라벨 — 테이블 CHECK(4종) 밖이라 파일로만 둔다.
"""

from pathlib import Path

TEMPLATE_DIR = Path(__file__).resolve().parent

# label_type → (format, 파일명). WORK_ORDER_PDF 만 HTML (db-schema §14.1).
DEFAULT_TEMPLATES: dict[str, tuple[str, str]] = {
    "WORK_ORDER_PDF": ("HTML", "WORK_ORDER_PDF.html.j2"),
    "WO_LABEL": ("ZPL", "WO_LABEL.zpl.j2"),
    "BOX_LABEL": ("ZPL", "BOX_LABEL.zpl.j2"),
    "WORKER_CARD": ("ZPL", "WORKER_CARD.zpl.j2"),
}

TEST_TEMPLATE_FILE = "TEST.zpl.j2"


def load_default_template(label_type: str) -> tuple[str, str]:
    """(format, body)."""
    fmt, filename = DEFAULT_TEMPLATES[label_type]
    return fmt, (TEMPLATE_DIR / filename).read_text(encoding="utf-8")


def load_test_template() -> str:
    return (TEMPLATE_DIR / TEST_TEMPLATE_FILE).read_text(encoding="utf-8")

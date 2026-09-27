"""수주·작업지시 도메인 (S1 개발A).

- ``so_service`` 수주 등록·조회·변경·취소 (A2-01 · A2-05 · A2-06 · A2-07)
- ``design_service`` 도안 업로드·확정·파일 (A2-02)
- ``wo_service`` WO 제안·발행·조회·보류·재개·취소·종결 (A2-03 · A2-04 · B4)
- ``recalc`` 캐시 갱신 ``recalc_wo`` · ``recalc_so`` · 지연 판정 (db-schema §8, api-contract §6.1 ·
  §6.5) — S2 스캔 엔진이 재사용
- ``views`` ORM → 응답 스키마 조립 (N+1 회피 로더)
- ``ports`` 라벨 발행 훅 (개발B ``app/domain/label`` 이 연결)
- ``q_service`` QR 착지 (api-contract §10)
"""

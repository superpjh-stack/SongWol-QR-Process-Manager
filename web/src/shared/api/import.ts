/** 엑셀 일괄 등록 · 마이그레이션 현황 API — api-contract §7.2 (A1-11) + §13.3 admin #12·#22~#24 */
import { api, API_PREFIX, downloadBlob, qs, type QueryParams } from './client'
import type { ImportCommitRequest, ImportEntity, ImportPreview, ImportResult, MigrationBatch, MigrationSource, Page } from '../types'

const P = API_PREFIX

export const importApi = {
  /** GET /master/import/template?entity= → xlsx (blob 다운로드). 파일명은 Content-Disposition 우선 */
  downloadTemplate: (entity: ImportEntity) => downloadBlob(`${P}/master/import/template${qs({ entity })}`, `import-template-${entity}.xlsx`),
  /** POST /master/import/preview — multipart `file` · `entity` · `source?` (admin #12). 201 */
  preview: (file: File, entity: ImportEntity, source?: MigrationSource) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('entity', entity)
    if (source) fd.append('source', source)
    return api.post<ImportPreview>(`${P}/master/import/preview`, fd)
  },
  /** POST /master/import/{batch_id}/commit {merge_policy, skip_invalid?} → ImportResult. 423 적재 중 · 409 IMPORT_HAS_ERRORS */
  commit: (batchId: number, body: ImportCommitRequest) => api.post<ImportResult>(`${P}/master/import/${batchId}/commit`, body),
}

export const migrationApi = {
  /** GET /migration/batches?page&size&sort&entity&status&source (admin #5) */
  batches: (params?: QueryParams) => api.get<Page<MigrationBatch>>(`${P}/migration/batches${qs(params)}`),
}

/** ApiError → ErrorAlert (screens-admin §0.4). 403·404·409·422 는 재시도 버튼 없음 */
import { ErrorAlert } from '@/shared/ui/admin'
import { toErrorView } from '@/shared/api'

export function ApiErrorAlert({ error, onRetry, className }: { error: unknown; onRetry?: (() => void) | undefined; className?: string | undefined }) {
  const v = toErrorView(error)
  return <ErrorAlert title={v.title} message={v.message} {...(v.retryable && onRetry ? { onRetry } : {})} {...(className ? { className } : {})} />
}

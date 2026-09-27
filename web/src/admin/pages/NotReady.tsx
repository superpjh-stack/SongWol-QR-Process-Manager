/** 아직 스프린트가 오지 않은 화면의 자리. screens-admin §0.1 의 스프린트 태그를 보여 준다 */
import { EmptyState, PageHeader } from '@/shared/ui/admin'

export function NotReady({ id, title, sprint }: { id: string; title: string; sprint: string }) {
  return (
    <>
      <PageHeader title={title} breadcrumb={id} />
      <EmptyState title="준비 중" description={`${id} ${title} — ${sprint} 에서 만든다 (specs/screens-admin.md)`} />
    </>
  )
}

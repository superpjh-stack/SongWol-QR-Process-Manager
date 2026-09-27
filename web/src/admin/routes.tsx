/** 관리자 웹 라우트 (screens-admin §0.1 URL 표 그대로). 로그인 `/login`, 나머지 `/admin/*` */
import type { RouteObject } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'
import { RequireRole } from './guards'
import type { ScreenKey } from './permissions'
import { LoginPage } from './pages/LoginPage'
import { NotReady } from './pages/NotReady'
import { CustomersPage } from './pages/master/CustomersPage'
import { CustomerDetailPage } from './pages/master/CustomerDetailPage'
import { ItemsPage } from './pages/master/ItemsPage'
import { ItemGroupsPage } from './pages/master/ItemGroupsPage'
import { PrintMethodsPage } from './pages/master/PrintMethodsPage'
import { ProcessesPage } from './pages/master/ProcessesPage'
import { EquipmentPage } from './pages/master/EquipmentPage'
import { RoutingsPage } from './pages/master/RoutingsPage'
import { RoutingDetailPage } from './pages/master/RoutingDetailPage'
import { StationsPage } from './pages/master/StationsPage'
import { UsersPage } from './pages/master/UsersPage'
import { CodeSettingsPage } from './pages/master/CodeSettingsPage'
import { ImportPage } from './pages/master/ImportPage'
import { MigrationBatchesPage } from './pages/system/MigrationBatchesPage'

const guard = (screen: ScreenKey, el: React.ReactNode) => <RequireRole screen={screen}>{el}</RequireRole>
const later = (screen: ScreenKey, id: string, title: string, sprint: string) => guard(screen, <NotReady id={id} title={title} sprint={sprint} />)

export const loginRoute: RouteObject = { path: '/login', element: <LoginPage /> }

export const adminRoute: RouteObject = {
  path: '/admin',
  element: <AdminLayout />,
  children: [
    { index: true, element: later('dashboard', 'ADM-28', '대시보드', '[S4-2]') },
    { path: 'so/*', element: later('so', 'ADM-12', '수주 목록', '[S1-7]') },
    { path: 'wo/pending', element: later('wo.pending', 'ADM-17', '예외 승인 대기', '[S2-3]') },
    { path: 'wo/*', element: later('wo', 'ADM-15', '작업지시 목록', '[S1]') },
    { path: 'material/receipts', element: later('material', 'ADM-18', '입고 목록', '[S3-1]') },
    { path: 'material/stock', element: later('material', 'ADM-19', '재고 현황', '[S3-5]') },
    { path: 'material/stock/adjust', element: later('material.adjust', 'ADM-20', '재고 조정', '[S3-5]') },
    { path: 'material/txns', element: later('material', 'ADM-21', '입출고 이력', '[S3-5]') },
    { path: 'shipping', element: later('shipping', 'ADM-22', '포장·출하 목록', '[S3-9]') },
    { path: 'shipping/new', element: later('shipping.new', 'ADM-23', '발송 등록', '[S3-7]') },
    { path: 'shipping/daily', element: later('shipping', 'ADM-24', '출하 일보', '[S3-9]') },
    { path: 'reports/output', element: later('reports', 'ADM-25', '실적 집계', '[S4-4]') },
    { path: 'reports/lead-time', element: later('reports', 'ADM-26', '리드타임 분석', '[S7-4] [확장]') },
    { path: 'trace', element: later('trace', 'ADM-27', 'LOT 역추적', '[S7-3] [확장]') },
    { path: 'master/customers', element: guard('master.customers', <CustomersPage />) },
    { path: 'master/customers/:id', element: guard('master.customers', <CustomerDetailPage />) },
    { path: 'master/items', element: guard('master.items', <ItemsPage />) },
    { path: 'master/item-groups', element: guard('master.item-groups', <ItemGroupsPage />) },
    { path: 'master/print-methods', element: guard('master.print-methods', <PrintMethodsPage />) },
    { path: 'master/processes', element: guard('master.processes', <ProcessesPage />) },
    { path: 'master/equipment', element: guard('master.equipment', <EquipmentPage />) },
    { path: 'master/routings', element: guard('master.routings', <RoutingsPage />) },
    { path: 'master/routings/:id', element: guard('master.routings', <RoutingDetailPage />) },
    { path: 'master/stations', element: guard('master.stations', <StationsPage />) },
    { path: 'master/users', element: guard('master.users', <UsersPage />) },
    { path: 'master/labels', element: later('master.labels', 'ADM-09', '라벨 양식 · 프린터', '[S1]') },
    { path: 'master/codes', element: guard('master.codes', <CodeSettingsPage />) },
    { path: 'master/import', element: guard('master.import', <ImportPage />) },
    { path: 'system/notifications', element: later('system.notifications', 'ADM-29', '알림 이력', '[S4-8]') },
    { path: 'system/audit', element: later('system.audit', 'ADM-30', '감사 로그', '[S4-8]') },
    { path: 'system/migration', element: guard('system.migration', <MigrationBatchesPage />) },
    { path: '*', element: <NotReady id="—" title="화면 없음" sprint="URL 표(screens-admin §0.1)에 없는 경로" /> },
  ],
}

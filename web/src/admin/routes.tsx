/** 관리자 웹 라우트 (screens-admin §0.1 URL 표 그대로). 로그인 `/login`, 나머지 `/admin/*` */
import type { RouteObject } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'
import { RequireRole } from './guards'
import type { ScreenKey } from './permissions'
import { LoginPage } from './pages/LoginPage'
import { NotReady } from './pages/NotReady'
import { DashboardPage } from './pages/DashboardPage'
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
import { LabelsPage } from './pages/master/LabelsPage'
import { SalesOrdersPage } from './pages/so/SalesOrdersPage'
import { SalesOrderFormPage } from './pages/so/SalesOrderFormPage'
import { SalesOrderDetailPage } from './pages/so/SalesOrderDetailPage'
import { WorkOrdersPage } from './pages/wo/WorkOrdersPage'
import { WorkOrderDetailPage } from './pages/wo/WorkOrderDetailPage'
import { PendingApprovalsPage } from './pages/wo/PendingApprovalsPage'
import { ReceiptsPage } from './pages/material/ReceiptsPage'
import { StockPage } from './pages/material/StockPage'
import { StockAdjustPage } from './pages/material/StockAdjustPage'
import { StockTxnsPage } from './pages/material/StockTxnsPage'
import { VendorBarcodesPage } from './pages/material/VendorBarcodesPage'
import { ShippingPage } from './pages/shipping/ShippingPage'
import { ShipmentFormPage } from './pages/shipping/ShipmentFormPage'
import { DailyReportPage } from './pages/shipping/DailyReportPage'
import { OutputReportPage } from './pages/reports/OutputReportPage'
import { NotificationsPage } from './pages/system/NotificationsPage'
import { AuditLogPage } from './pages/system/AuditLogPage'

const guard = (screen: ScreenKey, el: React.ReactNode) => <RequireRole screen={screen}>{el}</RequireRole>
const later = (screen: ScreenKey, id: string, title: string, sprint: string) => guard(screen, <NotReady id={id} title={title} sprint={sprint} />)

export const loginRoute: RouteObject = { path: '/login', element: <LoginPage /> }

export const adminRoute: RouteObject = {
  path: '/admin',
  element: <AdminLayout />,
  children: [
    { index: true, element: guard('dashboard', <DashboardPage />) },
    { path: 'so', element: guard('so', <SalesOrdersPage />) },
    { path: 'so/new', element: guard('so', <SalesOrderFormPage />) },
    { path: 'so/:code/edit', element: guard('so', <SalesOrderFormPage />) },
    { path: 'so/:code', element: guard('so', <SalesOrderDetailPage />) },
    { path: 'wo', element: guard('wo', <WorkOrdersPage />) },
    { path: 'wo/pending', element: guard('wo.pending', <PendingApprovalsPage />) },
    { path: 'wo/:code', element: guard('wo', <WorkOrderDetailPage />) },
    { path: 'material/receipts', element: guard('material', <ReceiptsPage />) },
    { path: 'material/stock', element: guard('material', <StockPage />) },
    { path: 'material/stock/adjust', element: guard('material.adjust', <StockAdjustPage />) },
    { path: 'material/txns', element: guard('material', <StockTxnsPage />) },
    { path: 'material/vendor-barcodes', element: guard('material', <VendorBarcodesPage />) },
    { path: 'shipping', element: guard('shipping', <ShippingPage />) },
    { path: 'shipping/new', element: guard('shipping.new', <ShipmentFormPage />) },
    { path: 'shipping/daily', element: guard('shipping', <DailyReportPage />) },
    { path: 'reports/output', element: guard('reports', <OutputReportPage />) },
    { path: 'reports/lead-time', element: later('reports', 'ADM-26', '리드타임 분석', '[S7-4] [확장]') },
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
    { path: 'master/labels', element: guard('master.labels', <LabelsPage />) },
    { path: 'master/codes', element: guard('master.codes', <CodeSettingsPage />) },
    { path: 'master/import', element: guard('master.import', <ImportPage />) },
    { path: 'system/notifications', element: guard('system.notifications', <NotificationsPage />) },
    { path: 'system/audit', element: guard('system.audit', <AuditLogPage />) },
    { path: 'system/migration', element: guard('system.migration', <MigrationBatchesPage />) },
    { path: '*', element: <NotReady id="—" title="화면 없음" sprint="URL 표(screens-admin §0.1)에 없는 경로" /> },
  ],
}

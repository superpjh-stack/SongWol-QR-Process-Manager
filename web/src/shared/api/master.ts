/**
 * 기준정보 API — api-contract §7.2 + §13.1·§13.3 델타. 경로는 계약 그대로.
 * CRUD 공통형: GET /{res} · POST /{res} · GET /{res}/{id} · PATCH /{res}/{id} · POST /{res}/{id}/deactivate · …/activate
 * 소형 마스터(print-methods·processes·item-groups·carriers·printers·addresses)는 배열 응답 (admin #7).
 */
import { api, API_PREFIX, qs, type QueryParams } from './client'
import type {
  Carrier,
  CarrierCreate,
  CodeSettings,
  Customer,
  CustomerAddress,
  CustomerAddressInput,
  CustomerAddressUpdate,
  CustomerCreate,
  CustomerUpdate,
  Equipment,
  EquipmentCreate,
  EquipmentUpdate,
  IssueCardRequest,
  IssueCardResponse,
  Item,
  ItemCreate,
  ItemGroup,
  ItemGroupCreate,
  ItemGroupUpdate,
  ItemUpdate,
  Page,
  PrintMethod,
  PrintMethodCreate,
  PrintMethodUpdate,
  Printer,
  Process,
  ProcessCreate,
  ProcessReorderRequest,
  ProcessUpdate,
  Routing,
  RoutingCreate,
  RoutingStepInput,
  RoutingStepsPut,
  RoutingUpdate,
  Station,
  StationCreate,
  StationCreated,
  StationKeyRotated,
  StationUpdate,
  User,
  UserCreate,
  UserUpdate,
  SetPinRequest,
  SetPasswordRequest,
} from '../types'

/** Page 응답 리소스 (경로 세그먼트). 정렬 허용 컬럼은 api-contract §13.1 admin #4 */
export type PagedResource = 'customers' | 'items' | 'equipment' | 'routings' | 'stations' | 'users'
/** 배열 응답 소형 마스터 */
export type ArrayResource = 'print-methods' | 'processes' | 'item-groups' | 'carriers' | 'printers'
export type MasterResource = PagedResource | ArrayResource

export const SORTABLE: Record<PagedResource | 'migration/batches', readonly string[]> = {
  customers: ['code', 'name', 'updated_at'],
  items: ['code', 'name', 'item_group', 'updated_at'],
  equipment: ['code', 'name'],
  routings: ['item_group', 'print_method'],
  stations: ['id', 'type', 'last_seen_at'],
  users: ['login_id', 'name', 'role'],
  'migration/batches': ['created_at'],
}

const P = API_PREFIX

/** 공통형 — 리소스별 타입은 아래 개별 객체가 고정한다 */
export function crud<T, C, U>(res: MasterResource) {
  const base = `${P}/${res}`
  return {
    list: (params?: QueryParams) => api.get<Page<T>>(`${base}${qs(params)}`),
    listAll: (params?: QueryParams) => api.get<T[]>(`${base}${qs(params)}`),
    get: (id: string | number) => api.get<T>(`${base}/${encodeURIComponent(String(id))}`),
    create: (body: C) => api.post<T>(base, body),
    update: (id: string | number, body: U) => api.patch<T>(`${base}/${encodeURIComponent(String(id))}`, body),
    deactivate: (id: string | number) => api.post<T>(`${base}/${encodeURIComponent(String(id))}/deactivate`),
    activate: (id: string | number) => api.post<T>(`${base}/${encodeURIComponent(String(id))}/activate`),
  }
}

export const customersApi = {
  ...crud<Customer, CustomerCreate, CustomerUpdate>('customers'),
  addresses: {
    list: (customerId: number) => api.get<CustomerAddress[]>(`${P}/customers/${customerId}/addresses`),
    create: (customerId: number, body: CustomerAddressInput) => api.post<CustomerAddress>(`${P}/customers/${customerId}/addresses`, body),
    update: (customerId: number, addrId: number, body: CustomerAddressUpdate) =>
      api.patch<CustomerAddress>(`${P}/customers/${customerId}/addresses/${addrId}`, body),
    deactivate: (customerId: number, addrId: number) => api.post<CustomerAddress>(`${P}/customers/${customerId}/addresses/${addrId}/deactivate`),
    activate: (customerId: number, addrId: number) => api.post<CustomerAddress>(`${P}/customers/${customerId}/addresses/${addrId}/activate`),
  },
}

export const itemsApi = crud<Item, ItemCreate, ItemUpdate>('items')

export const itemGroupsApi = crud<ItemGroup, ItemGroupCreate, ItemGroupUpdate>('item-groups')
export const carriersApi = crud<Carrier, CarrierCreate, Partial<Omit<CarrierCreate, 'code'>>>('carriers')

export const printMethodsApi = crud<PrintMethod, PrintMethodCreate, PrintMethodUpdate>('print-methods')

export const processesApi = {
  ...crud<Process, ProcessCreate, ProcessUpdate>('processes'),
  reorder: (codes: string[]) => api.post<Process[]>(`${P}/processes/reorder`, { codes } satisfies ProcessReorderRequest),
}

export const equipmentApi = crud<Equipment, EquipmentCreate, EquipmentUpdate>('equipment')

export const routingsApi = {
  ...crud<Routing, RoutingCreate, RoutingUpdate>('routings'),
  replaceSteps: (id: number, steps: RoutingStepInput[]) => api.put<Routing>(`${P}/routings/${id}/steps`, { steps } satisfies RoutingStepsPut),
  resolve: (item_group: string, print_method: string) => api.get<Routing>(`${P}/routings/resolve${qs({ item_group, print_method })}`),
}

export const stationsApi = {
  ...crud<Station, StationCreate, StationUpdate>('stations'),
  create: (body: StationCreate) => api.post<StationCreated>(`${P}/stations`, body),
  rotateKey: (id: string) => api.post<StationKeyRotated>(`${P}/stations/${encodeURIComponent(id)}/rotate-key`),
}

export const usersApi = {
  ...crud<User, UserCreate, UserUpdate>('users'),
  issueCard: (id: number, body: IssueCardRequest = {}) => api.post<IssueCardResponse>(`${P}/users/${id}/issue-card`, body),
  setPin: (id: number, pin: string) => api.post<void>(`${P}/users/${id}/set-pin`, { pin } satisfies SetPinRequest),
  setPassword: (id: number, password: string) => api.post<void>(`${P}/users/${id}/set-password`, { password } satisfies SetPasswordRequest),
}

export const printersApi = crud<Printer, never, never>('printers')

export const codeSettingsApi = {
  get: () => api.get<CodeSettings>(`${P}/settings/codes`),
  put: (body: CodeSettings) => api.put<CodeSettings>(`${P}/settings/codes`, body),
}

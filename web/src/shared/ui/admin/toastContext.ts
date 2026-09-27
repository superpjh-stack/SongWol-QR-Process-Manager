import { createContext, useContext, type ReactNode } from 'react'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'
export type ToastItem = { id: number; kind: ToastKind; message: ReactNode }

export type ToastApi = {
  push: (kind: ToastKind, message: ReactNode, opts?: { durationMs?: number }) => number
  dismiss: (id: number) => void
  success: (message: ReactNode) => number
  error: (message: ReactNode) => number
  info: (message: ReactNode) => number
  warning: (message: ReactNode) => number
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 는 <ToastProvider> 안에서만 쓸 수 있다')
  return ctx
}

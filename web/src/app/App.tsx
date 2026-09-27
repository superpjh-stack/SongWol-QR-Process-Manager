import { useEffect } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { ToastProvider } from '@/shared/ui/admin'
import { ApiError } from '@/shared/api'
import { useAuthStore } from '@/shared/hooks'
import { router } from './router'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx 는 다시 요청해도 같다. 네트워크(0)·5xx 만 1회 재시도
      retry: (count, err) => count < 1 && (!(err instanceof ApiError) || err.status === 0 || err.status >= 500),
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  )
}

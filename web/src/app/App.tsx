import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from '../features/auth/LoginPage'
import { useMe } from '../features/auth/useMe'
import RecentPage from '../features/meta/RecentPage'
import SearchPage from '../features/meta/SearchPage'
import { OverlaysProvider } from '../features/overlays/Overlays'
import Shell from '../features/shell/Shell'
import TrashPage from '../features/trash/TrashPage'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

function FullSkeleton() {
  return (
    <div style={{ padding: 40, maxWidth: 560, margin: '0 auto' }}>
      <div className="sk">
        <div className="skrow"><span className="sq" /><span className="b" style={{ width: '38%' }} /></div>
        <div className="skrow"><span className="sq" /><span className="b" style={{ width: '52%' }} /></div>
        <div className="skrow"><span className="sq" /><span className="b" style={{ width: '30%' }} /></div>
      </div>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) return <FullSkeleton />
  if (me.isError) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** '/' 진입 → 내 작업 공간으로 */
function HomeRedirect() {
  const me = useMe()
  if (me.isPending) return <FullSkeleton />
  if (me.isError) return <Navigate to="/login" replace />
  return <Navigate to={`/browse${me.data.homePath}`} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <OverlaysProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/browse/*"
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            />
            <Route
              path="/trash"
              element={
                <RequireAuth>
                  <TrashPage />
                </RequireAuth>
              }
            />
            <Route
              path="/search"
              element={
                <RequireAuth>
                  <SearchPage />
                </RequireAuth>
              }
            />
            <Route
              path="/recent"
              element={
                <RequireAuth>
                  <RecentPage />
                </RequireAuth>
              }
            />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </OverlaysProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

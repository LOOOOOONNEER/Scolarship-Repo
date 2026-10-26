import { Navigate, Route, Routes } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { SignIn } from './pages/SignIn';
import { Matches } from './pages/Matches';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { Submit } from './pages/Submit';
import { NotFound } from './pages/NotFound';
import { SetupNeeded } from './pages/SetupNeeded';

// Admin screens load only for reviewers, keeping the student app small.
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));
const ReviewQueue = lazy(() => import('./pages/admin/ReviewQueue').then((m) => ({ default: m.ReviewQueue })));
const ReviewCandidate = lazy(() => import('./pages/admin/ReviewCandidate').then((m) => ({ default: m.ReviewCandidate })));
const Sources = lazy(() => import('./pages/admin/Sources').then((m) => ({ default: m.Sources })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

// Admins and volunteer reviewers. The database checks the role again on every request.
function RequireReviewer({ children }: { children: ReactNode }) {
  const { session, loading, isReviewer } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/sign-in" replace />;
  if (!isReviewer) return <NotFound />;
  return <>{children}</>;
}

export function App() {
  if (!isConfigured) {
    return (
      <Layout>
        <SetupNeeded />
      </Layout>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<p className="muted">Loading…</p>}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/matches" element={<RequireAuth><Matches /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/submit" element={<RequireAuth><Submit /></RequireAuth>} />
        <Route path="/admin" element={<RequireReviewer><Admin /></RequireReviewer>} />
        <Route path="/admin/review" element={<RequireReviewer><ReviewQueue /></RequireReviewer>} />
        <Route path="/admin/review/:candidateId" element={<RequireReviewer><ReviewCandidate /></RequireReviewer>} />
        <Route path="/admin/sources" element={<RequireReviewer><Sources /></RequireReviewer>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

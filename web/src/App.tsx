import { Navigate, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Home } from './pages/Home';
import { Browse } from './pages/Browse';
import { SignIn } from './pages/SignIn';
import { Matches } from './pages/Matches';
import { Profile } from './pages/Profile';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';
import { NotFound } from './pages/NotFound';
import { SetupNeeded } from './pages/SetupNeeded';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/sign-in" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { session, loading, isAdmin } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <Navigate to="/sign-in" replace />;
  if (!isAdmin) return <NotFound />;
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
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/matches" element={<RequireAuth><Matches /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/admin" element={<RequireAdmin><Admin /></RequireAdmin>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}

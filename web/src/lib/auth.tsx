import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  isReviewer: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  isAdmin: false,
  isReviewer: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState({ admin: false, reviewer: false, checked: false });

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setRoles({ admin: false, reviewer: false, checked: true });
      return;
    }
    setRoles((r) => ({ ...r, checked: false }));
    // The database enforces every permission; these flags only decide what the menu shows.
    Promise.all([supabase.rpc('is_admin'), supabase.rpc('is_reviewer')]).then(([a, r]) =>
      setRoles({ admin: a.data === true, reviewer: r.data === true, checked: true }),
    );
  }, [session]);

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        loading: loading || (session !== null && !roles.checked),
        isAdmin: roles.admin,
        isReviewer: roles.reviewer,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

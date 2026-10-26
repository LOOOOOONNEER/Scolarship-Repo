import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { InstallPrompt } from './InstallPrompt';

export function Layout({ children }: { children: ReactNode }) {
  const { session, isReviewer, signOut } = useAuth();

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Scholarship Finder home">
          <span className="brand-mark" aria-hidden="true">SF</span>
          <span>Scholarship Finder</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLink to="/browse">Browse</NavLink>
          {session ? (
            <>
              <NavLink to="/matches">My matches</NavLink>
              <NavLink to="/profile">Profile</NavLink>
              <NavLink to="/settings">Privacy</NavLink>
              {isReviewer && <NavLink to="/admin">Admin</NavLink>}
              <button type="button" className="link-button" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <NavLink to="/sign-in">Sign in</NavLink>
          )}
        </nav>
      </header>
      <InstallPrompt />
      <main className="content">{children}</main>
      <footer className="footer">
        <p>
          Always confirm details on the provider's official page before applying. This app lists what
          providers have published; it cannot guarantee that you will receive a scholarship.
        </p>
      </footer>
    </div>
  );
}

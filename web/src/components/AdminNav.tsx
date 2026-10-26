import { NavLink } from 'react-router-dom';

export function AdminNav() {
  return (
    <nav className="subnav" aria-label="Admin">
      <NavLink to="/admin" end>
        Dashboard
      </NavLink>
      <NavLink to="/admin/review">Review queue</NavLink>
      <NavLink to="/admin/sources">Sources</NavLink>
    </nav>
  );
}

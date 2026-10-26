import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <section className="narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Go to the home page</Link>
      </p>
    </section>
  );
}

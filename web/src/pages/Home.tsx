import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function Home() {
  const { session } = useAuth();
  return (
    <section className="hero">
      <p className="eyebrow">Central Luzon · College scholarships</p>
      <h1>Find scholarships you can actually apply for.</h1>
      <p className="lead">
        We check official government, school and foundation pages for scholarship announcements, then show
        you the ones you appear to qualify for, with the reason for each match.
      </p>
      <div className="row">
        <Link className="button" to={session ? '/matches' : '/sign-in'}>
          {session ? 'See my matches' : 'Get started'}
        </Link>
        <Link className="button ghost" to="/browse">
          Browse open scholarships
        </Link>
      </div>
      <ul className="points">
        <li>
          <strong>Checked, not guessed.</strong> Every listing links to the provider's own page and shows when its
          status was last confirmed.
        </li>
        <li>
          <strong>Clear reasons.</strong> Each match says which requirements you meet and what still needs
          checking.
        </li>
        <li>
          <strong>Your answers stay private.</strong> Matching happens inside our database; only you can see your
          profile.
        </li>
      </ul>
    </section>
  );
}

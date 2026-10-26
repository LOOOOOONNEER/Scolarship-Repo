import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { requireClient } from '../lib/supabase';

export function SignIn() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  if (session) return <Navigate to="/matches" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    const { error } = await requireClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/matches` },
    });
    setState(error ? 'error' : 'sent');
  };

  return (
    <section className="narrow">
      <h1>Sign in</h1>
      {state === 'sent' ? (
        <div className="notice">
          <p>
            <strong>Check your email.</strong> We sent a sign-in link to {email.trim()}. Open it on this device.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="form">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="muted small">We'll email you a one-time link. No password needed.</p>
          {state === 'error' && <p className="error">That didn't work. Check the address and try again.</p>}
          <button className="button" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
          </button>
        </form>
      )}
    </section>
  );
}

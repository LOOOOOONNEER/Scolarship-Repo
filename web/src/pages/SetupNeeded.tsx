export function SetupNeeded() {
  return (
    <section className="narrow">
      <h1>Almost there</h1>
      <div className="notice">
        <p>
          This build has no Supabase connection yet. Set <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (in <code>web/.env.local</code> for local development, or in
          your hosting provider's environment settings), then rebuild.
        </p>
      </div>
    </section>
  );
}

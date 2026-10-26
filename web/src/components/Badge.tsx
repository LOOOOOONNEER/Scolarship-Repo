export function Badge({ tone, children }: { tone: 'good' | 'warn' | 'neutral' | 'bad'; children: string }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

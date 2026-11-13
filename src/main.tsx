import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountLegacy } from './legacy';
import { resolveEntry, setupClient, type EntryDecision } from './setup/client';
import { SetupApp } from './setup/SetupApp';

type View =
  | { kind: 'probing' }
  | { kind: 'setup'; decision: Extract<EntryDecision, { view: 'wizard' }> }
  | { kind: 'legacy' };

export function AssetApp() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);
  const [view, setView] = useState<View>({ kind: 'probing' });

  // One short probe before the legacy host: an installation that still needs a
  // claim must not start Vue, and an unreachable setup service must not offer
  // one. The request is aborted on unmount, so a slow answer cannot mount a
  // second shell after teardown.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void resolveEntry(setupClient, { signal: controller.signal }).then((decision) => {
      if (!active) return;
      setView(decision.view === 'wizard' ? { kind: 'setup', decision } : { kind: 'legacy' });
    }).catch(() => { if (active) setView({ kind: 'legacy' }); });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (view.kind !== 'legacy' || !host.current) return;
    return mountLegacy(host.current, setError);
  }, [view.kind]);

  if (error) return <main role="alert"><h1>No se pudo iniciar Hadar IT</h1>
    <p>{error.message}</p><button onClick={() => location.reload()}>Reintentar</button></main>;
  if (view.kind === 'setup') return <SetupApp initialSession={view.decision.session} />;
  return <div id="app" data-react-host ref={host} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
createRoot(root).render(<AssetApp />);

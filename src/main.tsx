import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountLegacy } from './legacy';
import { resolveBoot, setupClient, type EntryDecision } from './setup/client';
import { SetupApp } from './setup/SetupApp';

type View =
  | { kind: 'probing' }
  | { kind: 'setup'; decision: Extract<EntryDecision, { view: 'wizard' }> }
  | { kind: 'legacy' };

type BootCopy = { title: string; body: string; retry: string };
type BootLocale = 'es' | 'en';

// Two fixed lines per language, read before any catalog exists. The boot path
// must not import the wizard translator (it would drag the setup client into a
// failed legacy mount), so the catalog is fetched once and the inline copy
// stays if that fetch fails too. The host's error text is never rendered: it
// can carry upstream paths or tokens.
const BOOT_FALLBACK: Record<BootLocale, BootCopy> = {
  es: {
    title: 'No se pudo iniciar Hadar IT',
    body: 'La aplicación no pudo cargar su interfaz. Recarga la página; si el problema continúa, revisa el estado del servicio.',
    retry: 'Reintentar',
  },
  en: {
    title: 'Hadar IT could not start',
    body: 'The application could not load its interface. Reload the page; if the problem continues, check the service status.',
    retry: 'Retry',
  },
};

function bootLocale(): BootLocale {
  const declared = typeof document === 'undefined' ? '' : document.documentElement.lang;
  return declared.trim().toLowerCase().startsWith('en') ? 'en' : 'es';
}

function BootFailure({ onRetry }: { onRetry: () => void }) {
  const [copy, setCopy] = useState<BootCopy>(() => BOOT_FALLBACK[bootLocale()]);

  useEffect(() => {
    const locale = bootLocale();
    const controller = new AbortController();
    void fetch(new URL(`assets/i18n/${locale}.json`, document.baseURI).href, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null;
      return await response.json() as unknown;
    }).then((data) => {
      if (!data || typeof data !== 'object') return;
      const catalog = data as Record<string, unknown>;
      const pick = (key: string, fallback: string) =>
        (typeof catalog[key] === 'string' ? catalog[key] as string : fallback);
      setCopy({
        title: pick('ui.setup.boot.title', BOOT_FALLBACK[locale].title),
        body: pick('ui.setup.boot.body', BOOT_FALLBACK[locale].body),
        retry: pick('ui.setup.boot.retry', BOOT_FALLBACK[locale].retry),
      });
    }).catch(() => { /* the inline copy stays */ });
    return () => controller.abort();
  }, []);

  return (
    <main className="login setup" role="alert" data-boot-failure>
      <div className="login__panel">
        <div className="login__form-wrap">
          <h1>{copy.title}</h1>
          <p className="setup__lead">{copy.body}</p>
          <button className="btn btn--primary login-submit" type="button" onClick={onRetry}>
            {copy.retry}
          </button>
        </div>
      </div>
    </main>
  );
}

export function AssetApp() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);
  const [view, setView] = useState<View>({ kind: 'probing' });

  // One short probe before the legacy host: an installation that still needs a
  // claim must not start Vue, and an unreachable setup service must not offer
  // one. The app's own status is asked first, so a finished installation goes
  // to its login even when the setup service is already gone. The request is
  // aborted on unmount, so a slow answer cannot mount a second shell after
  // teardown.
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void resolveBoot(setupClient, { signal: controller.signal }).then((decision) => {
      if (!active) return;
      setView(decision.view === 'wizard' ? { kind: 'setup', decision } : { kind: 'legacy' });
    }).catch(() => { if (active) setView({ kind: 'legacy' }); });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (view.kind !== 'legacy' || !host.current) return;
    return mountLegacy(host.current, setError);
  }, [view.kind]);

  if (error) {
    // The stack stays in the console for an operator; the page shows copy the
    // catalog owns. Never print error.message: it can name internal paths.
    console.error('Hadar IT failed to start', error);
    return <BootFailure onRetry={() => location.reload()} />;
  }
  if (view.kind === 'setup') return <SetupApp initialSession={view.decision.session} />;
  return <div id="app" data-react-host ref={host} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
createRoot(root).render(<AssetApp />);

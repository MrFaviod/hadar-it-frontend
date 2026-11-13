import original from '../index.html?raw';

type LegacyApp = { unmount(): void };
declare global {
  interface Window {
    AssetReactHost?: boolean;
    AssetLoaderGroups?: Record<string, string[]>;
    mountAssetApp(target?: Element | string): LegacyApp;
  }
}

let parsed: Document | undefined;
function originalDocument(): Document {
  return parsed ??= new DOMParser().parseFromString(original, 'text/html');
}

let ready: Promise<void> | undefined;
function loadRuntime(): Promise<void> {
  return ready ??= (async () => {
    window.AssetReactHost = true;
    const scripts = [...originalDocument().body.querySelectorAll<HTMLScriptElement>('script[src]')];
    // FR-02: the canonical entry keeps the full ordered list as the static
    // compatibility path. The React host loads only the blocking shell here;
    // operational bundles are declared by data-domain and fetched on demand
    // through assets/js/loader.js in document order.
    const bootstrap: HTMLScriptElement[] = [];
    const groups: Record<string, string[]> = {};
    for (const element of scripts) {
      const src = element.getAttribute('src')!;
      const domain = element.getAttribute('data-domain');
      if (domain) (groups[domain] ||= []).push(src);
      else bootstrap.push(element);
    }
    window.AssetLoaderGroups = groups;
    // async=false keeps execution in document order while downloads run in parallel.
    await Promise.all(bootstrap.map((element) => new Promise<void>((resolve, reject) => {
      const script = window.document.createElement('script');
      script.async = false;
      script.src = new URL(element.getAttribute('src')!, new URL(import.meta.env.BASE_URL, location.href)).href;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${script.src}`));
      window.document.head.append(script);
    })));
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
}

// React owns the host; the existing renderer exclusively owns its descendants.
export function mountLegacy(host: HTMLElement, onError: (error: Error) => void): () => void {
  let disposed = false;
  let app: LegacyApp | undefined;
  void loadRuntime().then(() => {
    if (disposed) return;
    const template = originalDocument().getElementById('app');
    if (!template) throw new Error('OpenDesign template is missing');
    host.innerHTML = template.innerHTML;
    host.setAttribute('v-cloak', '');
    app = window.mountAssetApp(host);
  }).catch(error => { if (!disposed) onError(error instanceof Error ? error : new Error(String(error))); });
  return () => {
    disposed = true;
    app?.unmount();
    host.replaceChildren();
  };
}

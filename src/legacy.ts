import original from '../index.html?raw';

type LegacyApp = { unmount(): void };
declare global {
  interface Window {
    AssetReactHost?: boolean;
    mountAssetApp(target?: Element | string): LegacyApp;
  }
}

let ready: Promise<void> | undefined;
function loadRuntime(): Promise<void> {
  return ready ??= (async () => {
    window.AssetReactHost = true;
    const document = new DOMParser().parseFromString(original, 'text/html');
    for (const element of document.body.querySelectorAll<HTMLScriptElement>('script[src]')) {
      await new Promise<void>((resolve, reject) => {
        const script = window.document.createElement('script');
        script.src = new URL(element.getAttribute('src')!, new URL(import.meta.env.BASE_URL, location.href)).href;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Could not load ${script.src}`));
        window.document.head.append(script);
      });
    }
  })();
}

// React owns the host; the existing renderer exclusively owns its descendants.
export function mountLegacy(host: HTMLElement, onError: (error: Error) => void): () => void {
  let disposed = false;
  let app: LegacyApp | undefined;
  void loadRuntime().then(() => {
    if (disposed) return;
    const template = new DOMParser().parseFromString(original, 'text/html').getElementById('app');
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

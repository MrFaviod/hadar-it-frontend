import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { mountLegacy } from './legacy';

export function AssetApp() {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (host.current) return mountLegacy(host.current, setError);
  }, []);
  if (error) return <main role="alert"><h1>No se pudo iniciar Hadar IT</h1>
    <p>{error.message}</p><button onClick={() => location.reload()}>Reintentar</button></main>;
  return <div id="app" data-react-host ref={host} />;
}

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
createRoot(root).render(<AssetApp />);

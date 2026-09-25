import { useEffect, useState } from 'react';
import { api } from '../api.js';

let cached;

/** Organisation logo uploaded by the admin, or a neutral placeholder. */
export default function Logo({ size = 64 }) {
  const [url, setUrl] = useState(cached);
  useEffect(() => {
    if (cached !== undefined) return;
    api('/public/settings')
      .then((d) => {
        cached = d.logoUrl;
        setUrl(d.logoUrl);
      })
      .catch(() => setUrl(null));
  }, []);
  if (url) return <img className="logo" src={url} alt="Logo" style={{ maxHeight: size }} />;
  return (
    <div className="logo-placeholder" style={{ width: size, height: size }} aria-hidden="true">
      PS
    </div>
  );
}

export function resetLogoCache() {
  cached = undefined;
}

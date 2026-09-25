import { useState } from 'react';
import { api } from '../../api.js';
import Logo, { resetLogoCache } from '../Logo.jsx';

export default function SettingsAdmin() {
  const [msg, setMsg] = useState(null);
  const [version, setVersion] = useState(0);

  function refresh(text, ok = true) {
    resetLogoCache();
    setVersion((v) => v + 1);
    setMsg({ ok, text });
  }

  function onFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setMsg({ ok: false, text: 'Logo must be under 1 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await api('/admin/logo', { method: 'POST', body: { dataUrl: reader.result } });
        refresh('Logo updated.');
      } catch (err) {
        setMsg({ ok: false, text: err.message });
      }
    };
    reader.readAsDataURL(file);
  }

  async function removeLogo() {
    await api('/admin/logo', { method: 'DELETE' });
    refresh('Logo removed.');
  }

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="card stack">
        <h2>Login page logo</h2>
        <div key={version}><Logo size={96} /></div>
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onFile} />
        <p className="muted small">PNG, JPEG, GIF or WebP, up to 1 MB. Shown on the login page and in the header.</p>
        <div><button type="button" className="btn btn-ghost btn-sm" onClick={removeLogo}>Remove logo</button></div>
        {msg && <div className={`alert ${msg.ok ? 'alert-ok' : 'alert-error'}`}>{msg.text}</div>}
      </div>
    </div>
  );
}

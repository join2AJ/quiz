import { useLang } from '../context/LanguageContext.jsx';

export default function LanguageToggle() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-toggle" role="group" aria-label="Language / भाषा">
      <button type="button" className={lang === 'en' ? 'active' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
        EN
      </button>
      <button type="button" className={lang === 'hi' ? 'active' : ''} aria-pressed={lang === 'hi'} onClick={() => setLang('hi')}>
        HI
      </button>
    </div>
  );
}

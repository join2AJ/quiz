import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../context/LanguageContext.jsx';
import LanguageToggle from './LanguageToggle.jsx';
import Logo from './Logo.jsx';

export default function TopBar({ children, showLang = true }) {
  const { user, logout } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <Logo size={32} />
        <span className="brand-name">{t('appName')}</span>
      </Link>
      <div className="topbar-right">
        {children}
        {showLang && <LanguageToggle />}
        {user && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
          >
            {t('logout')}
          </button>
        )}
      </div>
    </header>
  );
}

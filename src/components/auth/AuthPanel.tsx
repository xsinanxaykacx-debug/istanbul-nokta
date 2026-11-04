import { X } from 'lucide-react';
import type { FormEvent } from 'react';

type AuthMode = 'login' | 'signup';

type AuthPanelProps = {
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  busy: boolean;
  onGoogleSignIn: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  hasSession: boolean;
  onClose: () => void;
};

export default function AuthPanel({
  authMode,
  setAuthMode,
  busy,
  onGoogleSignIn,
  onSubmit,
  email,
  setEmail,
  password,
  setPassword,
  hasSession,
  onClose,
}: AuthPanelProps) {
  return (
    <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="auth-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">{authMode === 'login' ? 'TEKRAR HOŞ GELDİN' : 'TOPLULUĞA KATIL'}</p>
            <h2>{authMode === 'login' ? 'Giriş yap' : 'Hesap oluştur'}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Kapat"><X size={18}/></button>
        </div>
        <button type="button" className="auth-provider-button" onClick={() => void onGoogleSignIn()} disabled={busy}>
          <span className="auth-google-mark">G</span>Google ile devam et
        </button>
        <div className="auth-divider"><span>veya e-posta ile</span></div>
        <form onSubmit={onSubmit} className="auth-form">
          <label className="field-label" htmlFor="email">E-posta</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="ornek@eposta.com"/>
          <label className="field-label" htmlFor="password">Şifre <span>en az 8 karakter</span></label>
          <input id="password" type="password" minLength={8} required autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder="En az 8 karakter"/>
          <button className="primary-button full-width" disabled={busy}>{busy ? 'İşleniyor…' : authMode === 'login' ? 'E-posta ile giriş yap' : 'E-posta ile kayıt ol'}</button>
        </form>
        <button className="text-button" onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}>
          {authMode === 'login' ? 'Hesabın yok mu? Kayıt ol' : 'Zaten hesabın var mı? Giriş yap'}
        </button>
        {!hasSession && <p className="modal-privacy">Kayıt sonrası hesabın otomatik olarak aktifleşir ve hemen kullanmaya başlayabilirsin.</p>}
      </div>
    </div>
  );
}

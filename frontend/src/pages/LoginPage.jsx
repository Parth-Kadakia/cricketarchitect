import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    displayName: '',
    email: '',
    password: ''
  });

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (mode === 'login') {
        await login(form.email, form.password);
      } else {
        await register(form);
      }

      navigate('/');
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-shell">
        <section className="auth-visual-panel">
          <img className="auth-brand-image" src="/images/cricket-architect-auth.jpg" alt="Cricket Architect cover art" />
          <div className="auth-visual-copy">
            <p className="auth-overline">Cricket Architect</p>
            <h2>Build your global franchise from the bottom.</h2>
            <p>Single-player career mode. Choose your city, rise through four leagues, and compete for the world title.</p>
          </div>
        </section>

        <div className="auth-card">
          <h1>Cricket Architect</h1>
          <p>Global T20 Franchise Manager</p>

          <div className="auth-switcher">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Login
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' ? (
              <label>
                Display Name
                <input
                  value={form.displayName}
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  required
                />
              </label>
            ) : null}

            <label>
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={form.password}
                onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                required
              />
            </label>

            {error ? <p className="error-text">{error}</p> : null}

            <button type="submit" className="button" disabled={loading}>
              {loading ? 'Working...' : mode === 'login' ? 'Continue Career' : 'Create Career'}
            </button>

            <small>
              Demo: <strong>demo@globalt20.com</strong> / <strong>Demo@123</strong>
            </small>
          </form>
        </div>
      </div>
    </div>
  );
}

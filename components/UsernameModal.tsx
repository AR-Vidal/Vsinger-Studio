import React, { useState } from 'react';
import { Lock, User, Sparkles } from 'lucide-react';
import { useI18n } from '../context/I18nContext';

export type AuthMode = 'login' | 'register';

interface UsernameModalProps {
  isOpen: boolean;
  onSubmit: (username: string, password: string, mode: AuthMode) => Promise<void>;
}

export const UsernameModal: React.FC<UsernameModalProps> = ({ isOpen, onSubmit }) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError(t('usernameMinLength'));
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError(t('usernameInvalidChars'));
      return;
    }

    if (password.length < 6) {
      setError('密码至少需要 6 位');
      return;
    }

    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setIsLoading(true);
    try {
      await onSubmit(trimmed, password, mode);
    } catch (err) {
      const message = err instanceof Error ? err.message.replace(/^\d+:\s*/, '') : t('failedToSetUsername');
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-zinc-900 rounded-2xl shadow-2xl border border-white/10 overflow-hidden">
        <div className="h-2 bg-[#5483B3]" />

        <div className="p-8">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="vs-gradient-icon w-16 h-16 rounded-full flex items-center justify-center shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-center text-white mb-2">
            {mode === 'login' ? '登录 Vsinger Studio' : '注册新用户'}
          </h2>
          <div className="mb-8" />

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-800 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'}`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className={`rounded-lg py-2 text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-white text-zinc-900' : 'text-zinc-400 hover:text-white'}`}
              >
                注册
              </button>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium text-zinc-300 mb-2">
                用户名
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="w-5 h-5 text-zinc-500" />
                </div>
                <input
                  type="text"
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="输入用户名"
                  className="vs-accent-focus w-full pl-10 pr-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 transition-all"
                  autoFocus
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-zinc-300 mb-2">
                密码
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="w-5 h-5 text-zinc-500" />
                </div>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 6 位"
                  className="vs-accent-focus w-full pl-10 pr-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 transition-all"
                  disabled={isLoading}
                />
              </div>
            </div>

            {mode === 'register' && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-zinc-300 mb-2">
                  确认密码
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-zinc-500" />
                  </div>
                  <input
                    type="password"
                    id="confirmPassword"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    className="vs-accent-focus w-full pl-10 pr-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 transition-all"
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400">{error}</p>
            )}

            <button
              type="submit"
              disabled={isLoading || !username.trim() || !password}
              className="w-full rounded-xl bg-[#C1EBFF] py-3 font-semibold text-[#052659] transition-all hover:bg-[#b4e5fb] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {t('gettingStarted')}
                </span>
              ) : (
                mode === 'login' ? '登录' : '注册并登录'
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-xs text-zinc-500 text-center">
            {t('yourMusicYourWay')}
          </p>
        </div>
      </div>
    </div>
  );
};

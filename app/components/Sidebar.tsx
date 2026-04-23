import React from 'react';
import { Disc, FileMusic, LogIn, LogOut, MicVocal, Settings2, UsersRound } from 'lucide-react';
import { View } from '../types';
import { useI18n } from '../context/I18nContext';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  user?: { username: string; isAdmin?: boolean; avatar_url?: string } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
  isOpen?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  user,
  onLogin,
  onLogout,
  onOpenSettings,
  isOpen = true,
  onToggle,
}) => {
  const { t } = useI18n();

  const navItems: Array<{ view: View; label: string; icon: React.ReactNode }> = [
    { view: 'create', label: t('create'), icon: <Disc size={20} /> },
    { view: 'library', label: t('library'), icon: <FileMusic size={20} /> },
    { view: 'management', label: '管理', icon: <UsersRound size={20} /> },
    { view: 'training', label: '训练', icon: <MicVocal size={20} /> },
  ];

  return (
    <>
      {isOpen && onToggle && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={onToggle} />}

      <div className={`fixed left-0 top-0 z-50 flex h-full flex-col overflow-y-auto border-r border-zinc-200 bg-white py-4 transition-all dark:border-white/10 dark:bg-suno-sidebar md:relative ${isOpen ? 'w-[208px]' : 'w-[76px]'}`}>
        <div className="mb-8 flex items-center justify-between px-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onNavigate('create')} className="vs-gradient-icon flex h-10 w-10 items-center justify-center rounded-full shadow-lg">
              <Disc size={18} />
            </button>
            {isOpen && <span className="gradient-text text-lg font-bold">Vsinger Studio</span>}
          </div>
          {onToggle && (
            <button type="button" onClick={onToggle} className="rounded-xl p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-white/10">
              {isOpen ? '<' : '>'}
            </button>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-2 px-3">
          {navItems.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
              className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition ${
                currentView === item.view
                  ? 'vs-accent-surface vs-accent-text-strong border border-[rgba(84,131,179,0.2)] dark:text-white'
                  : 'text-zinc-500 hover:bg-[rgba(193,235,255,0.28)] hover:text-[#052659] dark:text-zinc-400 dark:hover:bg-[rgba(84,131,179,0.12)] dark:hover:text-[#C1EBFF]'
              } ${isOpen ? 'justify-start' : 'justify-center'}`}
            >
              {item.icon}
              {isOpen && <span>{item.label}</span>}
            </button>
          ))}

          <div className="mt-auto flex flex-col gap-2">
            {user ? (
              <>
                <button type="button" onClick={onOpenSettings} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-zinc-500 transition hover:bg-[rgba(193,235,255,0.28)] hover:text-[#052659] dark:text-zinc-400 dark:hover:bg-[rgba(84,131,179,0.12)] dark:hover:text-[#C1EBFF] ${isOpen ? 'justify-start' : 'justify-center'}`}>
                  <Settings2 size={20} />
                  {isOpen && <span>{t('settings')}</span>}
                </button>
                <button type="button" onClick={onLogout} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-zinc-500 transition hover:bg-[rgba(193,235,255,0.28)] hover:text-[#052659] dark:text-zinc-400 dark:hover:bg-[rgba(84,131,179,0.12)] dark:hover:text-[#C1EBFF] ${isOpen ? 'justify-start' : 'justify-center'}`}>
                  <LogOut size={20} />
                  {isOpen && <span>{t('signOut')}</span>}
                </button>
              </>
            ) : (
              <button type="button" onClick={onLogin} className={`flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-zinc-500 transition hover:bg-[rgba(193,235,255,0.28)] hover:text-[#052659] dark:text-zinc-400 dark:hover:bg-[rgba(84,131,179,0.12)] dark:hover:text-[#C1EBFF] ${isOpen ? 'justify-start' : 'justify-center'}`}>
                <LogIn size={20} />
                {isOpen && <span>{t('signIn')}</span>}
              </button>
            )}
          </div>
        </nav>
      </div>
    </>
  );
};

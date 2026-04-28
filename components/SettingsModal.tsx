import React, { useState } from 'react';
import { X, User as UserIcon, Info, Edit3, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { EditProfileModal } from './EditProfileModal';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToProfile?: (username: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onNavigateToProfile }) => {
  const { user } = useAuth();
  const { t, language } = useI18n();
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

  if (!isOpen || !user) {
    if (isEditProfileOpen && user) {
      return (
        <EditProfileModal
          isOpen={isEditProfileOpen}
          onClose={() => setIsEditProfileOpen(false)}
          onSaved={() => setIsEditProfileOpen(false)}
        />
      );
    }
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-zinc-900"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 p-6 dark:border-white/5">
          <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">{t('settings')}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:bg-zinc-100 dark:hover:bg-white/5"
          >
            <X size={20} className="text-zinc-500" />
          </button>
        </div>

        <div className="space-y-8 p-6">
          <div className="rounded-xl bg-zinc-50 p-6 dark:bg-zinc-800/50">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl font-bold text-white shadow-lg">
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.username} className="h-full w-full object-cover" />
                ) : (
                  user.username[0].toUpperCase()
                )}
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-zinc-900 dark:text-white">@{user.username}</h3>
                <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                  {t('memberSince')} {new Date(user.createdAt).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onClose();
                    setIsEditProfileOpen(true);
                  }}
                  className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
                >
                  <Edit3 size={16} />
                  {t('editProfile')}
                </button>
                <button
                  onClick={() => {
                    onClose();
                    onNavigateToProfile?.(user.username);
                  }}
                  className="flex items-center gap-2 rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-300 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600"
                >
                  <ExternalLink size={16} />
                  {t('viewProfile')}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-white">
              <UserIcon size={20} />
              <h3 className="font-semibold">账号</h3>
            </div>
            <div className="space-y-3 pl-7">
              <div>
                <label className="text-sm text-zinc-500 dark:text-zinc-400">{t('username')}</label>
                <p className="font-medium text-zinc-900 dark:text-white">@{user.username}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2 text-zinc-900 dark:text-white">
              <Info size={20} />
              <h3 className="font-semibold">关于</h3>
            </div>
            <div className="space-y-2 pl-7 text-sm text-zinc-600 dark:text-zinc-400">
              <p>{t('version')} 2.0.0</p>
              <p>ACE-Step UI - 本地 AI 音乐生成平台</p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                基于 ACE-Step 1.5，保留创作、训练、音乐库和虚拟歌手管理能力。
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-zinc-200 p-6 dark:border-white/5">
          <button
            onClick={onClose}
            className="rounded-lg bg-zinc-900 px-6 py-2 font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {t('done')}
          </button>
        </div>
      </div>

      <EditProfileModal
        isOpen={isEditProfileOpen}
        onClose={() => setIsEditProfileOpen(false)}
        onSaved={() => setIsEditProfileOpen(false)}
      />
    </div>
  );
};

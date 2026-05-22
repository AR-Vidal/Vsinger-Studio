import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, Music, Plus, X } from 'lucide-react';
import { Playlist } from '../types';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { playlistsApi } from '../services/api';

interface PlaylistFormProps {
  title: string;
  initialPlaylist?: Playlist | null;
  submitLabel: string;
  onClose: () => void;
  onSubmit: (name: string, description: string, coverUrl?: string) => Promise<void> | void;
}

const PlaylistForm: React.FC<PlaylistFormProps> = ({ title, initialPlaylist, submitLabel, onClose, onSubmit }) => {
  const { token } = useAuth();
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(initialPlaylist?.name || '');
    setDescription(initialPlaylist?.description || '');
    setCoverUrl(initialPlaylist?.coverUrl || initialPlaylist?.cover_url || '');
    setCoverFile(null);
    setCoverPreview('');
    setIsSaving(false);
    setError('');
    if (coverInputRef.current) coverInputRef.current.value = '';
  }, [initialPlaylist]);

  const handleCoverChange = (file?: File) => {
    if (!file) return;
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setError('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;

    setIsSaving(true);
    setError('');
    try {
      let nextCoverUrl = coverUrl;
      if (coverFile) {
        if (!token) throw new Error('Not authenticated');
        const upload = await playlistsApi.uploadCover(coverFile, token);
        nextCoverUrl = upload.url;
      }
      await onSubmit(name.trim(), description.trim(), nextCoverUrl || undefined);
    } catch (err) {
      console.error('Playlist save failed:', err);
      setError(t('coverUploadFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm dark:bg-black/80">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 dark:border-white/10 dark:bg-zinc-900">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{title}</h2>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-2 block text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">
              {t('playlistCover')}
            </label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-black/50"
              >
                {coverPreview || coverUrl ? (
                  <img src={coverPreview || coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Camera size={24} />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => coverInputRef.current?.click()}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                >
                  {t('uploadCover')}
                </button>
                <p className="mt-2 text-xs text-zinc-500">{t('coverFormats')}</p>
              </div>
            </div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={(event) => handleCoverChange(event.target.files?.[0])}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">{t('playlistName')}</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-zinc-900 placeholder-zinc-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-white/10 dark:bg-black/50 dark:text-white dark:placeholder-zinc-600"
              placeholder={t('playlistNamePlaceholder')}
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">{t('playlistDescription')}</label>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="h-24 w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-zinc-900 placeholder-zinc-400 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:border-white/10 dark:bg-black/50 dark:text-white dark:placeholder-zinc-600"
              placeholder={t('descriptionPlaceholder')}
            />
          </div>

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={!name.trim() || isSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-bold text-white shadow-lg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 dark:bg-white dark:text-black"
            >
              {isSaving && <Loader2 size={14} className="animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, coverUrl?: string) => Promise<void> | void;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({ isOpen, onClose, onCreate }) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <PlaylistForm
      title={t('createPlaylist')}
      submitLabel={t('createButton')}
      onClose={onClose}
      onSubmit={async (name, description, coverUrl) => {
        await onCreate(name, description, coverUrl);
        onClose();
      }}
    />
  );
};

interface AddToPlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  playlists: Playlist[];
  onSelect: (playlistId: string) => void;
  onCreateNew?: () => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({ isOpen, onClose, playlists, onSelect, onCreateNew }) => {
  const { t } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 dark:bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl w-full max-w-sm p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white">{t('addToPlaylist')}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-900 dark:hover:text-white">
            <X size={20} />
          </button>
        </div>

        <button
          onClick={onCreateNew}
          className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group mb-3 border border-dashed border-zinc-300 dark:border-white/20 hover:border-zinc-400 dark:hover:border-white/40"
        >
          <div className="w-10 h-10 bg-zinc-100 dark:bg-zinc-800/50 rounded flex items-center justify-center text-zinc-600 dark:text-white/70 group-hover:text-zinc-900 dark:group-hover:text-white">
            <Plus size={20} />
          </div>
          <div className="text-left">
            <div className="font-semibold text-zinc-700 dark:text-white/90 group-hover:text-zinc-900 dark:group-hover:text-white">{t('createNewPlaylist')}</div>
          </div>
        </button>

        <div className="h-px bg-zinc-100 dark:bg-white/10 my-2"></div>

        <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
          {playlists.length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-sm italic">
              {t('noExistingPlaylists')}
            </div>
          ) : (
            playlists.map(playlist => {
              const coverUrl = playlist.coverUrl || playlist.cover_url;
              return (
                <button
                  key={playlist.id}
                  onClick={() => {
                    onSelect(playlist.id);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group"
                >
                  <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-white flex-shrink-0 overflow-hidden">
                    {coverUrl ? (
                      <img src={coverUrl} className="w-full h-full object-cover" alt="" />
                    ) : (
                      <Music size={18} />
                    )}
                  </div>
                  <div className="text-left overflow-hidden">
                    <div className="font-medium text-zinc-900 dark:text-white truncate">{playlist.name}</div>
                    <div className="text-xs text-zinc-500">{playlist.song_count || playlist.songIds?.length || 0} {t('songs')}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

interface EditPlaylistModalProps {
  isOpen: boolean;
  playlist: Playlist | null;
  onClose: () => void;
  onSave: (playlistId: string, name: string, description: string, coverUrl?: string) => Promise<void> | void;
}

export const EditPlaylistModal: React.FC<EditPlaylistModalProps> = ({ isOpen, playlist, onClose, onSave }) => {
  const { t } = useI18n();
  if (!isOpen || !playlist) return null;

  return (
    <PlaylistForm
      title={t('editPlaylist')}
      initialPlaylist={playlist}
      submitLabel={t('save')}
      onClose={onClose}
      onSubmit={async (name, description, coverUrl) => {
        await onSave(playlist.id, name, description, coverUrl);
      }}
    />
  );
};

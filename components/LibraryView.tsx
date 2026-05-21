import React, { useMemo, useState } from 'react';
import { Heart, MoreHorizontal, Play, Plus, Search } from 'lucide-react';
import { Playlist, Song } from '../types';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { AlbumCover } from './AlbumCover';
import { SongDropdownMenu } from './SongDropdownMenu';

interface ReferenceTrack {
  id: string;
  filename: string;
  storage_key: string;
  duration: number | null;
  file_size_bytes: number | null;
  tags: string[] | null;
  created_at: string;
  audio_url: string;
}

interface LibraryViewProps {
  allSongs: Song[];
  likedSongs: Song[];
  playlists: Playlist[];
  referenceTracks: ReferenceTrack[];
  onPlaySong: (song: Song, list?: Song[]) => void;
  onCreatePlaylist: () => void;
  onSelectPlaylist: (playlist: Playlist) => void;
  onAddToPlaylist: (song: Song) => void;
  onOpenVideo?: (song: Song) => void;
  onReusePrompt?: (song: Song) => void;
  onDeleteSong?: (song: Song) => void;
  onDeleteReferenceTrack?: (trackId: string) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  allSongs,
  likedSongs,
  playlists,
  onPlaySong,
  onCreatePlaylist,
  onSelectPlaylist,
  onAddToPlaylist,
  onOpenVideo,
  onReusePrompt,
  onDeleteSong,
}) => {
  const { t } = useI18n();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'all' | 'liked' | 'playlists'>('all');
  const [query, setQuery] = useState('');
  const [menuSong, setMenuSong] = useState<Song | null>(null);

  const filteredAllSongs = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return allSongs;
    return allSongs.filter((song) =>
      song.title.toLowerCase().includes(lower) ||
      (song.singerName || '').toLowerCase().includes(lower),
    );
  }, [allSongs, query]);

  const filteredLikedSongs = useMemo(() => {
    const lower = query.trim().toLowerCase();
    if (!lower) return likedSongs;
    return likedSongs.filter((song) =>
      song.title.toLowerCase().includes(lower) ||
      (song.singerName || '').toLowerCase().includes(lower),
    );
  }, [likedSongs, query]);

  const songsToShow = activeTab === 'all' ? filteredAllSongs : filteredLikedSongs;

  return (
    <>
      <div className="flex-1 overflow-y-auto bg-white p-6 pb-32 dark:bg-black lg:p-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">{t('yourLibrary')}</h1>
            </div>
            <button onClick={onCreatePlaylist} className="inline-flex items-center gap-2 rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white dark:bg-zinc-800">
              <Plus size={16} />
              {t('newPlaylist')}
            </button>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex gap-2">
              {[
                ['all', '全部歌曲'],
                ['liked', t('likedSongs')],
                ['playlists', t('playlists')],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setActiveTab(value as 'all' | 'liked' | 'playlists')}
                  className={`rounded-full px-4 py-2 text-sm font-medium ${
                    activeTab === value
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab !== 'playlists' && (
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-3.5 h-4 w-4 text-zinc-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-10 pr-4 text-sm outline-none dark:border-white/10 dark:bg-white/5 dark:text-white"
                  placeholder="搜索歌曲或歌手"
                />
              </div>
            )}
          </div>

          {activeTab === 'playlists' ? (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onSelectPlaylist(playlist)}
                  className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-lg dark:border-white/10 dark:bg-white/[0.03]"
                >
                  <div className="aspect-square overflow-hidden rounded-2xl bg-zinc-100 dark:bg-white/5">
                    {playlist.coverUrl ? (
                      <img src={playlist.coverUrl} alt={playlist.name} className="h-full w-full object-cover" />
                    ) : (
                      <AlbumCover seed={playlist.id || playlist.name} size="full" className="h-full w-full" />
                    )}
                  </div>
                  <div className="mt-3 font-semibold text-zinc-900 dark:text-white">{playlist.name}</div>
                  <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{playlist.description || t('byYou')}</div>
                </button>
              ))}
            </div>
          ) : songsToShow.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-300 px-6 py-12 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
              当前分类下没有匹配结果。
            </div>
          ) : (
            <div className="space-y-2">
              {songsToShow.map((song) => (
                <div
                  key={song.id}
                  className="group flex items-center gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                >
                  <button type="button" onClick={() => onPlaySong(song, songsToShow)} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
                    <Play size={16} fill="currentColor" />
                  </button>

                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-zinc-100 dark:bg-white/5">
                    {song.coverUrl ? (
                      <img src={song.coverUrl} alt={song.title} className="h-full w-full object-cover" />
                    ) : (
                      <AlbumCover seed={song.id || song.title} size="full" className="h-full w-full" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-zinc-900 dark:text-white">{song.title}</div>
                    <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {song.singerName || '未记录歌手快照'}
                    </div>
                  </div>

                  <div className="hidden text-xs text-zinc-500 dark:text-zinc-400 md:block">{song.duration}</div>
                  {activeTab === 'liked' && <Heart size={16} className="text-rose-500" fill="currentColor" />}

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setMenuSong((prev) => (prev?.id === song.id ? null : song))}
                      className="rounded-full p-2 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    <SongDropdownMenu
                      song={song}
                      isOpen={menuSong?.id === song.id}
                      onClose={() => setMenuSong(null)}
                      isOwner={user ? song.userId === user.id : false}
                      onCreateVideo={() => onOpenVideo?.(song)}
                      onReusePrompt={() => onReusePrompt?.(song)}
                      onAddToPlaylist={() => onAddToPlaylist(song)}
                      onDelete={() => onDeleteSong?.(song)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </>
  );
};

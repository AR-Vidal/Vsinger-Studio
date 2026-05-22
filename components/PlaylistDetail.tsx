import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock, Edit2, Music, Play, Trash2 } from 'lucide-react';
import { playlistsApi } from '../services/api';
import { Playlist, Song } from '../types';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { normalizeSongs } from '../utils/songNormalizer';

interface PlaylistDetailProps {
    playlistId: string;
    currentPlaylist?: Playlist;
    onBack: () => void;
    onPlaySong: (song: Song, list?: Song[]) => void;
    onSelect: (song: Song) => void;
    onNavigateToProfile: (username: string) => void;
    onEditPlaylist: (playlist: Playlist) => void;
    onDeletePlaylist: (playlist: Playlist) => void;
}

const getSongArtistName = (song: Song): string => (
    song.singerName || song.singerNameSnapshot || '虚拟歌手'
);

export const PlaylistDetail: React.FC<PlaylistDetailProps> = ({
    playlistId,
    currentPlaylist,
    onBack,
    onPlaySong,
    onSelect,
    onNavigateToProfile,
    onEditPlaylist,
    onDeletePlaylist,
}) => {
    const { user: currentUser, token } = useAuth();
    const { t } = useI18n();
    const [playlist, setPlaylist] = useState<(Playlist & { creator_avatar?: string }) | null>(null);
    const [songs, setSongs] = useState<Array<Song & { addedAt?: string }>>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        void loadPlaylist();
    }, [playlistId]);

    useEffect(() => {
        if (!currentPlaylist || currentPlaylist.id !== playlistId) return;
        setPlaylist(prev => prev ? { ...prev, ...currentPlaylist } : { ...currentPlaylist });
    }, [currentPlaylist, playlistId]);

    const loadPlaylist = async () => {
        setLoading(true);
        try {
            const res = await playlistsApi.getPlaylist(playlistId, token);
            setPlaylist(res.playlist as any);
            const normalizedSongs = normalizeSongs(res.songs).map((song, index) => ({
                ...song,
                addedAt: res.songs[index]?.added_at,
            }));
            setSongs(normalizedSongs);
        } catch (error) {
            console.error('Failed to load playlist:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveSong = async (songId: string) => {
        if (!token || !playlist) return;
        try {
            await playlistsApi.removeSong(playlist.id, songId, token);
            setSongs(prev => prev.filter(song => song.id !== songId));
        } catch (error) {
            console.error('Failed to remove song:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center bg-white">
                <div className="flex items-center gap-2 text-zinc-500">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                    {t('loadingPlaylist')}
                </div>
            </div>
        );
    }

    if (!playlist) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-white">
                <div className="text-zinc-500">{t('playlistNotFound')}</div>
                <button onClick={onBack} className="rounded-lg bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-800">
                    {t('goBack')}
                </button>
            </div>
        );
    }

    const isOwner = currentUser?.id === playlist.user_id;
    const totalDuration = songs.reduce((acc, song) => acc + (song.durationSeconds || 0), 0);

    return (
        <div className="flex h-full w-full flex-col overflow-hidden bg-white text-zinc-900">
            <div className="flex-shrink-0 border-b border-zinc-200 bg-white p-4 pt-12 md:flex md:items-end md:gap-8 md:p-8">
                <div className="mx-auto flex h-32 w-32 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-zinc-100 shadow-xl md:mx-0 md:h-52 md:w-52">
                    {playlist.coverUrl || playlist.cover_url ? (
                        <img src={playlist.coverUrl || playlist.cover_url} alt={playlist.name} className="h-full w-full object-cover" />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center bg-zinc-100">
                            <Music size={64} className="text-zinc-300" />
                        </div>
                    )}
                </div>

                <div className="mt-4 flex-1 space-y-3 text-center md:mt-0 md:text-left">
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-500">{t('playlist')}</span>
                    <h1 className="text-2xl font-bold leading-none tracking-tight text-zinc-900 md:text-5xl lg:text-7xl">
                        {playlist.name}
                    </h1>
                    {playlist.description && (
                        <p className="hidden max-w-2xl text-sm text-zinc-600 md:block">{playlist.description}</p>
                    )}
                    <div className="flex flex-wrap items-center justify-center gap-2 text-sm font-medium text-zinc-700 md:justify-start">
                        {playlist.creator && (
                            <div
                                className="flex cursor-pointer items-center gap-2 hover:underline"
                                onClick={() => onNavigateToProfile(playlist.creator!)}
                            >
                                {(playlist as any).creator_avatar ? (
                                    <img src={(playlist as any).creator_avatar} alt={playlist.creator} className="h-6 w-6 rounded-full object-cover" />
                                ) : (
                                    <div className="h-6 w-6 rounded-full bg-zinc-300" />
                                )}
                                <span>{playlist.creator}</span>
                            </div>
                        )}
                        <span className="h-1 w-1 rounded-full bg-zinc-300" />
                        <span>{songs.length} {t('songs')}</span>
                        {totalDuration > 0 && (
                            <>
                                <span className="hidden h-1 w-1 rounded-full bg-zinc-300 md:block" />
                                <span className="hidden text-zinc-500 md:block">{Math.floor(totalDuration / 60)} {t('min')}</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 border-b border-zinc-200 bg-white px-4 py-3 md:px-8 md:py-4">
                <button
                    onClick={() => songs.length > 0 && onPlaySong(songs[0], songs)}
                    className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-black shadow-lg transition-transform hover:scale-105 md:h-14 md:w-14"
                    title={t('play')}
                >
                    <Play size={24} fill="currentColor" className="ml-1" />
                </button>

                {isOwner && (
                    <>
                        <button
                            onClick={() => onEditPlaylist(playlist)}
                            className="p-2 text-zinc-500 transition-colors hover:text-zinc-900"
                            title={t('editPlaylist')}
                        >
                            <Edit2 size={20} />
                        </button>
                        <button
                            onClick={() => onDeletePlaylist(playlist)}
                            className="p-2 text-zinc-500 transition-colors hover:text-red-600"
                            title={t('deletePlaylist')}
                        >
                            <Trash2 size={20} />
                        </button>
                    </>
                )}

                <div className="flex-1" />
                <div className="text-xs text-zinc-500 md:text-sm">
                    {playlist.isPublic ?? playlist.is_public ? t('public') : t('private')}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-white">
                <div className="px-2 py-2 pb-24 md:px-8 md:py-4 lg:pb-32">
                    <div className="sticky top-0 z-10 mb-2 hidden grid-cols-[16px_4fr_3fr_2fr_minmax(120px,1fr)] gap-4 border-b border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-500 md:grid">
                        <span>#</span>
                        <span>{t('title')}</span>
                        <span>{t('artist')}</span>
                        <span>{t('dateAdded')}</span>
                        <span className="text-right"><Clock size={16} className="inline" /></span>
                    </div>

                    <div className="space-y-1">
                        {songs.map((song, index) => (
                            <div
                                key={song.id}
                                className="group flex cursor-pointer items-center gap-3 rounded-md px-2 py-3 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 md:grid md:grid-cols-[16px_4fr_3fr_2fr_minmax(120px,1fr)] md:gap-4 md:px-4"
                                onClick={() => {
                                    onSelect(song);
                                    onPlaySong(song, songs);
                                }}
                            >
                                <span className="hidden md:block">{index + 1}</span>
                                <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
                                    <div className="group/img relative h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-100 md:h-10 md:w-10">
                                        <img src={song.coverUrl} alt="" className="h-full w-full object-cover" />
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onPlaySong(song, songs);
                                            }}
                                            className="absolute inset-0 flex items-center justify-center bg-black/50 text-white md:hidden md:group-hover/img:flex"
                                            title={t('play')}
                                        >
                                            <Play size={16} fill="white" />
                                        </button>
                                    </div>
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate font-medium text-zinc-900">{song.title}</span>
                                        <span className="truncate text-xs text-zinc-500">
                                            {getSongArtistName(song)} <span className="md:hidden"> · {song.duration || '0:00'}</span>
                                        </span>
                                    </div>
                                </div>

                                <span className="hidden truncate hover:underline md:block">{getSongArtistName(song)}</span>
                                <span className="hidden md:block">{song.addedAt ? new Date(song.addedAt).toLocaleDateString() : t('justNow')}</span>
                                <div className="hidden items-center justify-end gap-4 md:flex">
                                    <span className="font-mono text-xs">{song.duration || '0:00'}</span>
                                    {isOwner && (
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void handleRemoveSong(song.id);
                                            }}
                                            className="text-zinc-500 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                                            title={t('delete')}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>

                                {isOwner && (
                                    <button
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            void handleRemoveSong(song.id);
                                        }}
                                        className="p-2 text-zinc-500 hover:text-red-600 md:hidden"
                                        title={t('delete')}
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <button
                onClick={onBack}
                className="absolute left-6 top-6 z-50 flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow transition-colors hover:bg-zinc-100"
                title={t('goBack')}
            >
                <ArrowLeft size={18} />
            </button>
        </div>
    );
};

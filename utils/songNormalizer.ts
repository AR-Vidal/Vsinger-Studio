import { getAudioUrl } from '../services/api';
import { Song } from '../types';

const parseDate = (value: unknown): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
};

const parseTags = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      return value.split(',').map(tag => tag.trim()).filter(Boolean);
    }
  }
  return [];
};

const parseGenerationParams = (value: unknown): unknown => {
  if (!value) return undefined;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

const parseDurationSeconds = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    if (/^\d+:\d{1,2}$/.test(value)) {
      const [minutes, seconds] = value.split(':').map(Number);
      return minutes * 60 + seconds;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};

const formatDuration = (seconds?: number): string => {
  if (!seconds || seconds <= 0) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

export const normalizeSong = (row: any): Song => {
  const id = String(row?.id ?? '');
  const title = String(row?.title || (row?.isGenerating ? 'Creating...' : 'Untitled'));
  const style = String(row?.style || '');
  const lyrics = String(row?.lyrics || '');
  const durationSeconds = parseDurationSeconds(row?.durationSeconds ?? row?.duration_seconds ?? row?.duration);
  const audioUrl = getAudioUrl(row?.audioUrl ?? row?.audio_url, id);
  const coverUrl = String(row?.coverUrl || row?.cover_url || '');
  const createdAt = parseDate(row?.createdAt ?? row?.created_at);

  return {
    id,
    title,
    lyrics,
    style,
    coverUrl: coverUrl || `https://picsum.photos/seed/${id || title}/400/400`,
    duration: typeof row?.duration === 'string' && row.duration.includes(':')
      ? row.duration
      : formatDuration(durationSeconds),
    durationSeconds,
    createdAt,
    tags: parseTags(row?.tags),
    audioUrl,
    isGenerating: Boolean(row?.isGenerating),
    queuePosition: row?.queuePosition,
    progress: row?.progress,
    stage: row?.stage,
    generationParams: parseGenerationParams(row?.generationParams ?? row?.generation_params),
    isPublic: row?.isPublic ?? row?.is_public,
    likeCount: Number(row?.likeCount ?? row?.like_count ?? 0) || 0,
    viewCount: Number(row?.viewCount ?? row?.view_count ?? 0) || 0,
    userId: row?.userId ?? row?.user_id,
    creator: row?.creator,
    creator_avatar: row?.creator_avatar,
    ditModel: row?.ditModel ?? row?.dit_model,
    singerId: row?.singerId ?? row?.singer_id ?? null,
    singerName: row?.singerName ?? row?.singer_name ?? row?.singer_name_snapshot ?? null,
    singerNameSnapshot: row?.singerNameSnapshot ?? row?.singer_name_snapshot ?? null,
    hasSinger: Boolean(row?.hasSinger ?? row?.has_singer),
  };
};

export const normalizeSongs = (rows: any[] | undefined | null): Song[] => (
  Array.isArray(rows) ? rows.map(normalizeSong) : []
);

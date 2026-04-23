import { randomUUID } from 'crypto';
import path from 'path';
import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { pool } from '../db/pool.js';
import { clearSingerVoice, getLoraState } from '../services/lora-manager.js';
import { getStorageProvider } from '../services/storage/factory.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.'));
    }
  },
});

interface SingerRow {
  id: string;
  user_id: string;
  name: string;
  style_tags: string | null;
  default_language: string | null;
  gender: string | null;
  persona_prompt: string | null;
  notes: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  adapter_path?: string | null;
  bound_at?: string | null;
  binding_updated_at?: string | null;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item).trim()).filter(Boolean)
      : [];
  } catch {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeStyleTags(value: unknown): string[] {
  return parseJsonArray(value);
}

function normalizeSingerGender(value: unknown): 'unspecified' | 'female' | 'male' {
  if (typeof value !== 'string') {
    return 'unspecified';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'female' || normalized === 'male') {
    return normalized;
  }

  return 'unspecified';
}

function serializeSinger(row: SingerRow) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    styleTags: parseJsonArray(row.style_tags),
    defaultLanguage: row.default_language || 'zh',
    gender: normalizeSingerGender(row.gender),
    personaPrompt: row.persona_prompt || '',
    notes: row.notes || '',
    avatarUrl: row.avatar_url || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasVoiceBinding: Boolean(row.adapter_path),
    bindingStatus: row.adapter_path ? 'bound' : 'unbound',
    boundAt: row.bound_at || null,
    bindingUpdatedAt: row.binding_updated_at || null,
  };
}

async function getOwnedSinger(userId: string, singerId: string): Promise<SingerRow | null> {
  const result = await pool.query(
    `SELECT vs.*, svb.adapter_path, svb.bound_at, svb.updated_at AS binding_updated_at
     FROM virtual_singers vs
     LEFT JOIN singer_voice_binding svb ON svb.singer_id = vs.id
     WHERE vs.id = ? AND vs.user_id = ?`,
    [singerId, userId],
  );

  return (result.rows[0] as SingerRow | undefined) ?? null;
}

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT vs.*, svb.adapter_path, svb.bound_at, svb.updated_at AS binding_updated_at
       FROM virtual_singers vs
       LEFT JOIN singer_voice_binding svb ON svb.singer_id = vs.id
       WHERE vs.user_id = ?
       ORDER BY vs.updated_at DESC, vs.created_at DESC`,
      [req.user!.id],
    );

    res.json({
      singers: result.rows.map((row) => serializeSinger(row as SingerRow)),
    });
  } catch (error) {
    console.error('[Singers] List error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load singers' });
  }
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'Singer name is required' });
      return;
    }

    await pool.query(
      `INSERT INTO virtual_singers (
        user_id,
        name,
        style_tags,
        default_language,
        gender,
        persona_prompt,
        notes,
        avatar_url,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        req.user!.id,
        name,
        JSON.stringify(normalizeStyleTags(req.body?.styleTags)),
        typeof req.body?.defaultLanguage === 'string' && req.body.defaultLanguage.trim()
          ? req.body.defaultLanguage.trim()
          : 'zh',
        normalizeSingerGender(req.body?.gender),
        typeof req.body?.personaPrompt === 'string' ? req.body.personaPrompt.trim() : '',
        typeof req.body?.notes === 'string' ? req.body.notes.trim() : '',
        typeof req.body?.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '',
      ],
    );

    const created = await pool.query(
      `SELECT vs.*, svb.adapter_path, svb.bound_at, svb.updated_at AS binding_updated_at
       FROM virtual_singers vs
       LEFT JOIN singer_voice_binding svb ON svb.singer_id = vs.id
       WHERE vs.user_id = ?
       ORDER BY vs.created_at DESC
       LIMIT 1`,
      [req.user!.id],
    );

    res.status(201).json({
      singer: serializeSinger(created.rows[0] as SingerRow),
    });
  } catch (error) {
    console.error('[Singers] Create error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create singer' });
  }
});

router.post('/avatar', authMiddleware, upload.single('avatar'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const userId = req.user!.id;
    const ext = path.extname(req.file.originalname) || '.jpg';
    const key = `users/${userId}/singers/${randomUUID()}${ext}`;

    const storage = getStorageProvider();
    await storage.upload(key, req.file.buffer, req.file.mimetype);
    const url = storage.getPublicUrl(key);

    res.json({ url });
  } catch (error) {
    console.error('[Singers] Avatar upload error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to upload singer avatar', details: errorMessage });
  }
});

router.patch('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singer = await getOwnedSinger(req.user!.id, req.params.id);
    if (!singer) {
      res.status(404).json({ error: 'Singer not found' });
      return;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (req.body?.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) {
        res.status(400).json({ error: 'Singer name is required' });
        return;
      }
      updates.push('name = ?');
      values.push(name);
    }

    if (req.body?.styleTags !== undefined) {
      updates.push('style_tags = ?');
      values.push(JSON.stringify(normalizeStyleTags(req.body.styleTags)));
    }

    if (req.body?.defaultLanguage !== undefined) {
      updates.push('default_language = ?');
      values.push(typeof req.body.defaultLanguage === 'string' && req.body.defaultLanguage.trim()
        ? req.body.defaultLanguage.trim()
        : 'zh');
    }

    if (req.body?.gender !== undefined) {
      updates.push('gender = ?');
      values.push(normalizeSingerGender(req.body.gender));
    }

    if (req.body?.personaPrompt !== undefined) {
      updates.push('persona_prompt = ?');
      values.push(typeof req.body.personaPrompt === 'string' ? req.body.personaPrompt.trim() : '');
    }

    if (req.body?.notes !== undefined) {
      updates.push('notes = ?');
      values.push(typeof req.body.notes === 'string' ? req.body.notes.trim() : '');
    }

    if (req.body?.avatarUrl !== undefined) {
      updates.push('avatar_url = ?');
      values.push(typeof req.body.avatarUrl === 'string' ? req.body.avatarUrl.trim() : '');
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No changes provided' });
      return;
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.params.id, req.user!.id);

    await pool.query(
      `UPDATE virtual_singers
       SET ${updates.join(', ')}
       WHERE id = ? AND user_id = ?`,
      values,
    );

    const updated = await getOwnedSinger(req.user!.id, req.params.id);
    res.json({ singer: serializeSinger(updated as SingerRow) });
  } catch (error) {
    console.error('[Singers] Update error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update singer' });
  }
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const client = await pool.connect();

  try {
    const singer = await getOwnedSinger(req.user!.id, req.params.id);
    if (!singer) {
      res.status(404).json({ error: 'Singer not found' });
      return;
    }

    const loraState = getLoraState();
    if (singer.adapter_path && loraState.path === singer.adapter_path) {
      try {
        await clearSingerVoice();
      } catch (error) {
        console.warn('[Singers] Failed to clear active voice before delete:', error);
      }
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE songs
       SET singer_name_snapshot = COALESCE(singer_name_snapshot, ?),
           singer_id = NULL,
           updated_at = datetime('now')
       WHERE singer_id = ?`,
      [singer.name, singer.id],
    );
    await client.query('DELETE FROM singer_voice_binding WHERE singer_id = ?', [singer.id]);
    await client.query('DELETE FROM virtual_singers WHERE id = ? AND user_id = ?', [singer.id, req.user!.id]);
    await client.query('COMMIT');

    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Singers] Delete error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete singer' });
  } finally {
    client.release();
  }
});

export default router;

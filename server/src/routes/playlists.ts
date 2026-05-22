import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool.js';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
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
    }
});

async function resolveAccessibleAudioUrl(audioUrl: string | null, isPublic: boolean): Promise<string | null> {
    if (!audioUrl) return null;
    if (audioUrl.startsWith('s3://')) {
        const storageKey = audioUrl.replace('s3://', '');
        const storage = getStorageProvider();
        return isPublic ? storage.getPublicUrl(storageKey) : storage.getUrl(storageKey, 3600);
    }
    return audioUrl;
}

// Upload playlist cover image
router.post('/cover', authMiddleware, upload.single('cover'), async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        const ext = path.extname(req.file.originalname) || '.jpg';
        const key = `users/${req.user!.id}/playlists/${uuidv4()}${ext}`;
        const storage = getStorageProvider();
        await storage.upload(key, req.file.buffer, req.file.mimetype);
        const url = storage.getPublicUrl(key);

        res.json({ url });
    } catch (error) {
        console.error('Playlist cover upload error:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.status(500).json({ error: 'Failed to upload playlist cover', details: errorMessage });
    }
});

// Create playlist
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { name, description, isPublic, coverUrl } = req.body;

        if (!name) {
            res.status(400).json({ error: 'Name is required' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO playlists (user_id, name, description, is_public, cover_url)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *`,
            [req.user!.id, name, description, isPublic || false, coverUrl]
        );

        res.status(201).json({ playlist: result.rows[0] });
    } catch (error) {
        console.error('Create playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get my playlists
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await pool.query(
            `SELECT p.*, COUNT(ps.song_id) as song_count
             FROM playlists p
             LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
             WHERE p.user_id = $1
             GROUP BY p.id
             ORDER BY p.created_at DESC`,
            [req.user!.id]
        );

        res.json({ playlists: result.rows });
    } catch (error) {
        console.error('Get playlists error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get playlist by ID
router.get('/:id', optionalAuthMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const playlistResult = await pool.query(
            `SELECT p.*, u.username as creator, u.avatar_url as creator_avatar
             FROM playlists p
             JOIN users u ON p.user_id = u.id
             WHERE p.id = $1`,
            [req.params.id]
        );

        if (playlistResult.rows.length === 0) {
            res.status(404).json({ error: 'Playlist not found' });
            return;
        }

        const playlist = playlistResult.rows[0];

        // Access control
        if (!playlist.is_public && (!req.user || req.user.id !== playlist.user_id)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }

        // Get songs
        const songsResult = await pool.query(
            `SELECT s.id, s.title, s.lyrics, s.style, s.cover_url, s.audio_url, s.duration,
                    s.user_id, s.is_public, u.username as creator,
                    s.singer_id, s.singer_name_snapshot,
                    COALESCE(vs.name, s.singer_name_snapshot) AS singer_name,
                    CASE WHEN COALESCE(vs.name, s.singer_name_snapshot) IS NOT NULL THEN 1 ELSE 0 END AS has_singer,
                    ps.added_at, ps.position
             FROM playlist_songs ps
             JOIN songs s ON ps.song_id = s.id
             JOIN users u ON s.user_id = u.id
             LEFT JOIN virtual_singers vs ON s.singer_id = vs.id
             WHERE ps.playlist_id = $1
             ORDER BY ps.position ASC`,
            [req.params.id]
        );

        const songs = await Promise.all(
            songsResult.rows.map(async (row) => ({
                ...row,
                audio_url: await resolveAccessibleAudioUrl(row.audio_url, row.is_public),
            }))
        );

        res.json({
            playlist,
            songs
        });
    } catch (error) {
        console.error('Get playlist details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add song to playlist
router.post('/:id/songs', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { songId } = req.body;

        // Verify playlist ownership
        const playlistCheck = await pool.query('SELECT user_id FROM playlists WHERE id = $1', [req.params.id]);
        if (playlistCheck.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
        if (playlistCheck.rows[0].user_id !== req.user!.id) return res.status(403).json({ error: 'Access denied' });

        // Get max position
        const positionResult = await pool.query(
            'SELECT MAX(position) as max_pos FROM playlist_songs WHERE playlist_id = $1',
            [req.params.id]
        );
        const position = (positionResult.rows[0].max_pos || 0) + 1;

        await pool.query(
            `INSERT INTO playlist_songs (playlist_id, song_id, position)
             VALUES ($1, $2, $3)
             ON CONFLICT (playlist_id, song_id) DO NOTHING`,
            [req.params.id, songId, position]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Add song to playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Remove song from playlist
router.delete('/:id/songs/:songId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Verify playlist ownership
        const playlistCheck = await pool.query('SELECT user_id FROM playlists WHERE id = $1', [req.params.id]);
        if (playlistCheck.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
        if (playlistCheck.rows[0].user_id !== req.user!.id) return res.status(403).json({ error: 'Access denied' });

        await pool.query(
            'DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2',
            [req.params.id, req.params.songId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Remove song from playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update playlist
router.patch('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Verify playlist ownership
        const playlistCheck = await pool.query('SELECT user_id FROM playlists WHERE id = $1', [req.params.id]);
        if (playlistCheck.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
        if (playlistCheck.rows[0].user_id !== req.user!.id) return res.status(403).json({ error: 'Access denied' });

        const { name, description, isPublic, coverUrl } = req.body;
        const updates: string[] = [];
        const values: unknown[] = [];
        let paramCount = 1;

        if (name !== undefined) { updates.push(`name = $${paramCount}`); values.push(name); paramCount++; }
        if (description !== undefined) { updates.push(`description = $${paramCount}`); values.push(description); paramCount++; }
        if (isPublic !== undefined) { updates.push(`is_public = $${paramCount}`); values.push(isPublic); paramCount++; }
        if (coverUrl !== undefined) { updates.push(`cover_url = $${paramCount}`); values.push(coverUrl); paramCount++; }

        if (updates.length > 0) {
            updates.push(`updated_at = CURRENT_TIMESTAMP`);
            values.push(req.params.id);
            await pool.query(
                `UPDATE playlists SET ${updates.join(', ')} WHERE id = $${paramCount}`,
                values
            );
        }

        const updated = await pool.query('SELECT * FROM playlists WHERE id = $1', [req.params.id]);
        res.json({ playlist: updated.rows[0] });
    } catch (error) {
        console.error('Update playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete playlist
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
    try {
        // Verify playlist ownership
        const playlistCheck = await pool.query('SELECT user_id FROM playlists WHERE id = $1', [req.params.id]);
        if (playlistCheck.rows.length === 0) return res.status(404).json({ error: 'Playlist not found' });
        if (playlistCheck.rows[0].user_id !== req.user!.id) return res.status(403).json({ error: 'Access denied' });

        await pool.query('DELETE FROM playlists WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete playlist error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

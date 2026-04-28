import { Router, Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { config } from '../config/index.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../services/password.js';

const jwtOptions = { expiresIn: config.jwt.expiresIn } as SignOptions;

const router = Router();

interface SetupBody {
  username: string;
  password?: string;
}

interface CredentialsBody {
  username: string;
  password: string;
}

function issueAccessToken(payload: { id: string; username: string }): string {
  return jwt.sign(payload, config.jwt.secret, jwtOptions);
}

function sanitizeUsername(username: unknown): string {
  if (typeof username !== 'string') return '';
  return username
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 50);
}

function serializeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    bio: user.bio,
    avatar_url: user.avatar_url,
    banner_url: user.banner_url,
    isAdmin: Boolean(user.is_admin),
    createdAt: user.created_at,
  };
}

async function findUserByUsername(username: string) {
  const result = await pool.query(
    'SELECT id, username, password_hash, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE username = ?',
    [username]
  );
  return result.rows[0];
}

async function respondWithAuth(user: any, res: Response, status = 200): Promise<void> {
  const token = issueAccessToken({
    id: user.id,
    username: user.username,
  });

  res.status(status).json({
    user: serializeUser(user),
    token,
  });
}

// Auto-login is disabled now that local users require passwords.
router.get('/auto', async (_req: Request, res: Response) => {
  res.status(401).json({ error: 'Login required' });
});

router.post('/register', async (req: Request<object, object, CredentialsBody>, res: Response) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (username.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      res.status(409).json({ error: 'Username is already taken' });
      return;
    }

    const userId = generateUUID();
    await pool.query(
      `INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [userId, username, hashPassword(password)]
    );

    const user = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [userId]
    );
    await respondWithAuth(user.rows[0], res, 201);
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request<object, object, CredentialsBody>, res: Response) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    await respondWithAuth(user, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Compatibility endpoint: behaves as register when password is supplied.
router.post('/setup', async (req: Request<object, object, SetupBody>, res: Response) => {
  try {
    const username = sanitizeUsername(req.body.username);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (username.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    const existingUser = await findUserByUsername(username);
    if (existingUser) {
      if (!verifyPassword(password, existingUser.password_hash)) {
        res.status(401).json({ error: 'Invalid username or password' });
        return;
      }
      await respondWithAuth(existingUser, res);
      return;
    }

    const userId = generateUUID();
    await pool.query(
      `INSERT INTO users (id, username, password_hash, is_admin, created_at, updated_at)
       VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))`,
      [userId, username, hashPassword(password)]
    );

    const newUser = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [userId]
    );
    await respondWithAuth(newUser.rows[0], res);
  } catch (error) {
    console.error('Auth setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: serializeUser(user),
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update username
router.patch('/username', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    const sanitizedUsername = sanitizeUsername(username);

    if (sanitizedUsername.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }

    // Check if username is taken by another user
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [sanitizedUsername, req.user!.id]
    );

    if (existingUser.rows.length > 0) {
      res.status(409).json({ error: 'Username is already taken' });
      return;
    }

    // Update username
    await pool.query(
      `UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`,
      [sanitizedUsername, req.user!.id]
    );

    // Get updated user
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    const user = result.rows[0];

    // Issue new token with updated username
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.json({
      user: serializeUser(user),
      token,
    });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (no-op for local app, just for API compatibility)
router.post('/logout', async (_req: Request, res: Response) => {
  res.json({ success: true });
});

// Refresh token (for API compatibility - just returns current user if token valid)
router.post('/refresh', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.json({
      user: serializeUser(user),
      token,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

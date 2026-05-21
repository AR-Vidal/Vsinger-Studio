import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { getGradioClient } from '../services/gradio-client.js';
import { config } from '../config/index.js';
import { resolvePythonPath } from '../services/acestep.js';
import { pool } from '../db/pool.js';
import { clearSingerVoice, getLoraState } from '../services/lora-manager.js';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const ACESTEP_API_TIMEOUT_MS = 30000;

type TrainingRunStatus = {
  running: boolean;
  startedAt: string | null;
  updatedAt: string | null;
  progress: string;
  log: string;
  metrics: unknown;
  error: string | null;
};

let trainingRunStatus: TrainingRunStatus = {
  running: false,
  startedAt: null,
  updatedAt: null,
  progress: 'Idle',
  log: '',
  metrics: null,
  error: null,
};

let activeTrainingSubmission: { cancel?: () => Promise<void> } | null = null;

function resolveAceStepRelativePath(targetPath: string, aceStepDir: string): string {
  return path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(aceStepDir, targetPath);
}

async function readDatasetFile(datasetPath: string): Promise<{
  metadata: Record<string, unknown>;
  samples: Array<Record<string, unknown>>;
}> {
  const content = await readFile(datasetPath, 'utf-8');
  const normalizedContent = content.replace(/^\uFEFF/, '');
  const parsed = JSON.parse(normalizedContent) as {
    metadata?: Record<string, unknown>;
    samples?: Array<Record<string, unknown>>;
  };

  return {
    metadata: parsed.metadata ?? {},
    samples: Array.isArray(parsed.samples) ? parsed.samples : [],
  };
}

function mapDatasetSample(sample: Record<string, unknown> | undefined, index = 0) {
  if (!sample) {
    return null;
  }

  return {
    index,
    audio: sample.audio_path ?? null,
    filename: sample.filename ?? '',
    caption: sample.caption ?? '',
    genre: sample.genre ?? '',
    promptOverride: sample.prompt_override === 'genre'
      ? 'Genre'
      : sample.prompt_override === 'caption'
        ? 'Caption'
        : 'Use Global Ratio',
    lyrics: sample.lyrics ?? '',
    bpm: sample.bpm ?? null,
    key: sample.keyscale ?? '',
    timeSignature: sample.timesignature ?? '',
    duration: sample.duration ?? 0,
    language: sample.language ?? 'unknown',
    instrumental: sample.is_instrumental ?? true,
    rawLyrics: sample.raw_lyrics ?? '',
    labeled: sample.labeled ?? false,
  };
}

function normalizePromptOverride(value: unknown) {
  return value === 'genre'
    ? 'Genre'
    : value === 'caption'
      ? 'Caption'
      : 'Use Global Ratio';
}

function normalizeGradioAudio(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (value && typeof value === 'object') {
    const fileLike = value as { path?: unknown; url?: unknown };
    if (typeof fileLike.path === 'string' && fileLike.path.trim()) {
      return fileLike.path;
    }
    if (typeof fileLike.url === 'string' && fileLike.url.trim()) {
      return fileLike.url;
    }
  }

  return null;
}

function mapGradioPreviewSample(
  values: unknown[],
  index: number,
  offsets: {
    audio: number;
    filename: number;
    caption: number;
    genre: number;
    promptOverride: number;
    lyrics: number;
    bpm: number;
    key: number;
    timeSignature: number;
    duration: number;
    language: number;
    instrumental: number;
    rawLyrics: number;
  },
) {
  return {
    index,
    audio: normalizeGradioAudio(values[offsets.audio]),
    filename: typeof values[offsets.filename] === 'string' ? values[offsets.filename] : '',
    caption: typeof values[offsets.caption] === 'string' ? values[offsets.caption] : '',
    genre: typeof values[offsets.genre] === 'string' ? values[offsets.genre] : '',
    promptOverride: normalizePromptOverride(values[offsets.promptOverride]),
    lyrics: typeof values[offsets.lyrics] === 'string' ? values[offsets.lyrics] : '',
    bpm: typeof values[offsets.bpm] === 'number' ? values[offsets.bpm] : null,
    key: typeof values[offsets.key] === 'string' ? values[offsets.key] : '',
    timeSignature: typeof values[offsets.timeSignature] === 'string' ? values[offsets.timeSignature] : '',
    duration: typeof values[offsets.duration] === 'number' ? values[offsets.duration] : 0,
    language: typeof values[offsets.language] === 'string' ? values[offsets.language] : 'unknown',
    instrumental: Boolean(values[offsets.instrumental]),
    rawLyrics: typeof values[offsets.rawLyrics] === 'string' ? values[offsets.rawLyrics] : '',
  };
}

function getDatasetName(
  metadata: Record<string, unknown>,
  datasetPath: string,
  fallback = 'my_lora_dataset',
): string {
  return typeof metadata.name === 'string' && metadata.name.trim()
    ? metadata.name.trim()
    : path.basename(datasetPath, '.json') || fallback;
}

function countLabeledSamples(samples: Array<Record<string, unknown>>) {
  return samples.filter((sample) => sample.labeled === true).length;
}

async function loadDatasetIntoGradio(client: Awaited<ReturnType<typeof getGradioClient>>, datasetPath: string) {
  const result = await client.predict('/load_existing_dataset_for_preprocess', [datasetPath]);
  return result.data as unknown[];
}

async function saveDatasetFromGradio(
  client: Awaited<ReturnType<typeof getGradioClient>>,
  savePath: string,
  datasetName: string,
) {
  const result = await client.predict('/save_dataset', [savePath, datasetName]);
  return result.data as unknown[];
}

function isAutoLabelFailureStatus(status: string) {
  return /please scan|no samples|model not initialized|llm not initialized|no dataset/i.test(status);
}

// --- Audio upload via multer disk storage ---
const AUDIO_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.opus'];
const AUDIO_UPLOAD_MAX_FILES = 200;
const AUDIO_UPLOAD_MAX_FILE_SIZE = 100 * 1024 * 1024;

const audioStorage = multer.diskStorage({
  destination: async (_req: Request, _file, cb) => {
    const datasetName = (_req.body?.datasetName as string) || 'default';
    const dest = path.join(config.datasets.uploadsDir, datasetName);
    try {
      await mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err as Error, dest);
    }
  },
  filename: (_req, file, cb) => {
    // Preserve original filename but ensure uniqueness
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext);
    const safeName = base.replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    cb(null, `${safeName}${ext}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: AUDIO_UPLOAD_MAX_FILE_SIZE }, // 100MB per file
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (AUDIO_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Allowed: ${AUDIO_EXTENSIONS.join(', ')}`));
    }
  },
});

function handleAudioUpload(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  audioUpload.array('audio', AUDIO_UPLOAD_MAX_FILES)(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Audio upload failed: each file must be 100MB or smaller.' });
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        res.status(400).json({ error: `Audio upload failed: upload at most ${AUDIO_UPLOAD_MAX_FILES} audio files at once.` });
        return;
      }
      res.status(400).json({ error: `Audio upload failed: ${err.message}` });
      return;
    }

    res.status(400).json({
      error: err instanceof Error ? err.message : 'Audio upload failed',
    });
  });
}

// Get audio duration via ffprobe
function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch {
    return 0;
  }
}

// Resolve ACE-Step base directory
function getAceStepDir(): string {
  const envPath = process.env.ACESTEP_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return path.resolve(config.datasets.dir, '..');
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function resolveWithinAceStep(rawPath: string | undefined, aceStepDir: string): string | null {
  if (!rawPath || !rawPath.trim()) return null;
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(aceStepDir, rawPath);
}

function resolveTensorDirForTraining(rawPath: unknown, aceStepDir: string): string {
  const requested = typeof rawPath === 'string' && rawPath.trim()
    ? rawPath.trim()
    : './datasets/preprocessed_tensors';
  return path.isAbsolute(requested)
    ? path.resolve(requested)
    : path.resolve(aceStepDir, requested);
}

function countPtFiles(tensorDir: string): number {
  if (!existsSync(tensorDir) || !statSync(tensorDir).isDirectory()) {
    return 0;
  }

  return readdirSync(tensorDir).filter((file) => file.toLowerCase().endsWith('.pt')).length;
}

function assertValidTensorDir(tensorDir: string, aceStepDir: string): void {
  if (!isInsideBase(aceStepDir, tensorDir)) {
    throw new Error(`Tensor directory must be inside ACE-Step: ${tensorDir}`);
  }

  if (!existsSync(tensorDir) || !statSync(tensorDir).isDirectory()) {
    throw new Error(`Tensor directory not found: ${tensorDir}`);
  }

  const ptCount = countPtFiles(tensorDir);
  if (ptCount === 0) {
    throw new Error(`No .pt tensor files found in ${tensorDir}`);
  }
}

function isInsideBase(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsOverlap(pathA: string, pathB: string): boolean {
  return (
    pathA === pathB ||
    pathA.startsWith(`${pathB}${path.sep}`) ||
    pathB.startsWith(`${pathA}${path.sep}`)
  );
}

async function cleanupReplacedBindingPaths(
  oldPaths: Array<string | null | undefined>,
  newPaths: Array<string | null | undefined>,
  aceStepDir: string,
): Promise<void> {
  const normalizedNewPaths = newPaths
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => path.resolve(candidate));

  for (const oldPath of oldPaths) {
    if (!oldPath) continue;

    const resolvedOldPath = path.resolve(oldPath);
    if (!isInsideBase(aceStepDir, resolvedOldPath)) {
      console.warn('[Training] Skip cleanup outside ACE-Step directory:', resolvedOldPath);
      continue;
    }

    if (normalizedNewPaths.some((newPath) => pathsOverlap(resolvedOldPath, newPath))) {
      continue;
    }

    if (!existsSync(resolvedOldPath)) continue;
    await rm(resolvedOldPath, { recursive: true, force: true });
  }
}

// ================== NEW ROUTES ==================

// POST /api/training/upload-audio — Upload audio files for a dataset
router.post('/upload-audio', authMiddleware, handleAudioUpload, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No audio files uploaded' });
      return;
    }

    const datasetName = (req.body?.datasetName as string) || 'default';
    const uploadDir = path.join(config.datasets.uploadsDir, datasetName);

    res.json({
      files: files.map(f => ({
        filename: f.filename,
        originalName: f.originalname,
        size: f.size,
        path: f.path,
      })),
      uploadDir,
      count: files.length,
    });
  } catch (error) {
    console.error('[Training] Upload audio error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Upload failed' });
  }
});

// POST /api/training/build-dataset — Scan audio directory + create dataset JSON
router.post('/build-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      datasetName = 'my_lora_dataset',
      customTag = '',
      tagPosition = 'prepend',
      allInstrumental = true,
    } = req.body;

    const audioDir = path.join(config.datasets.uploadsDir, datasetName);
    if (!existsSync(audioDir)) {
      res.status(400).json({ error: `Audio directory not found: uploads/${datasetName}` });
      return;
    }

    // Scan for audio files
    const entries = readdirSync(audioDir);
    const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (audioFiles.length === 0) {
      res.status(400).json({ error: 'No audio files found in directory' });
      return;
    }

    // Build samples in Gradio's exact format
    const samples = audioFiles.map(filename => {
      const audioPath = path.join(audioDir, filename);
      const duration = getAudioDuration(audioPath);
      const baseName = path.basename(filename, path.extname(filename));

      // Check for companion .txt lyrics file
      let rawLyrics = '';
      const lyricsPath = path.join(audioDir, `${baseName}.txt`);
      if (existsSync(lyricsPath)) {
        try {
          rawLyrics = readFileSync(lyricsPath, 'utf-8').trim();
        } catch { /* ignore */ }
      }

      const isInstrumental = allInstrumental || !rawLyrics;

      return {
        id: randomUUID().slice(0, 8),
        audio_path: audioPath,
        filename,
        caption: '',
        genre: '',
        lyrics: isInstrumental ? '[Instrumental]' : rawLyrics,
        raw_lyrics: rawLyrics,
        formatted_lyrics: '',
        bpm: null as number | null,
        keyscale: '',
        timesignature: '',
        duration,
        language: isInstrumental ? 'instrumental' : 'unknown',
        is_instrumental: isInstrumental,
        custom_tag: customTag,
        labeled: false,
        prompt_override: null as string | null,
      };
    });

    // Build dataset JSON
    const dataset = {
      metadata: {
        name: datasetName,
        custom_tag: customTag,
        tag_position: tagPosition,
        created_at: new Date().toISOString(),
        num_samples: samples.length,
        all_instrumental: allInstrumental,
        genre_ratio: 0,
      },
      samples,
    };

    // Save JSON to datasets dir
    await mkdir(config.datasets.dir, { recursive: true });
    const jsonPath = path.join(config.datasets.dir, `${datasetName}.json`);
    await writeFile(jsonPath, JSON.stringify(dataset, null, 2), 'utf-8');

    // Now load into Gradio state via the existing endpoint
    try {
      const client = await getGradioClient();
      const result = await client.predict('/load_existing_dataset_for_preprocess', [jsonPath]);
      const data = result.data as unknown[];

      res.json({
        status: data[0],
        dataframe: data[1],
        sampleCount: samples.length,
        sample: {
          index: data[2],
          audio: data[3],
          filename: data[4],
          caption: data[5],
          genre: data[6],
          promptOverride: data[7],
          lyrics: data[8],
          bpm: data[9],
          key: data[10],
          timeSignature: data[11],
          duration: data[12],
          language: data[13],
          instrumental: data[14],
          rawLyrics: data[15],
        },
        settings: {
          datasetName: data[16],
          customTag: data[17],
          tagPosition: data[18],
          allInstrumental: data[19],
          genreRatio: data[20],
        },
        datasetPath: jsonPath,
      });
    } catch (gradioError) {
      // Gradio may not be running — still return dataset info
      console.warn('[Training] Gradio load failed, returning dataset JSON only:', gradioError);
      res.json({
        status: `Dataset saved (${samples.length} samples). Gradio not available for live preview.`,
        dataframe: null,
        sampleCount: samples.length,
        sample: samples.length > 0 ? {
          index: 0,
          audio: null,
          filename: samples[0].filename,
          caption: samples[0].caption,
          genre: samples[0].genre,
          promptOverride: null,
          lyrics: samples[0].lyrics,
          bpm: samples[0].bpm,
          key: samples[0].keyscale,
          timeSignature: samples[0].timesignature,
          duration: samples[0].duration,
          language: samples[0].language,
          instrumental: samples[0].is_instrumental,
          rawLyrics: samples[0].raw_lyrics,
        } : null,
        settings: {
          datasetName,
          customTag,
          tagPosition,
          allInstrumental,
          genreRatio: 0,
        },
        datasetPath: jsonPath,
      });
    }
  } catch (error) {
    console.error('[Training] Build dataset error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build dataset' });
  }
});

// GET /api/training/audio — Proxy audio files from datasets directory
router.get('/audio', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let filePath: string;
    const aceStepDir = getAceStepDir();

    if (req.query.path) {
      filePath = req.query.path as string;
    } else if (req.query.file) {
      // Relative path within datasets dir
      filePath = path.join(config.datasets.dir, req.query.file as string);
    } else {
      res.status(400).json({ error: 'path or file parameter required' });
      return;
    }

    // Path traversal protection
    const resolved = path.resolve(filePath);
    if (resolved.includes('..') || !resolved.startsWith(aceStepDir)) {
      res.status(403).json({ error: 'Access denied: path outside ACE-Step directory' });
      return;
    }

    if (!existsSync(resolved)) {
      res.status(404).json({ error: 'Audio file not found' });
      return;
    }

    // Determine content type
    const ext = path.extname(resolved).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.flac': 'audio/flac',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
    };

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    res.sendFile(resolved);
  } catch (error) {
    console.error('[Training] Audio proxy error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to serve audio' });
  }
});

// POST /api/training/preprocess — Spawn Python preprocessing script
router.post('/preprocess', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { datasetPath, outputDir } = req.body;
    if (!datasetPath) {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }

    const aceStepDir = getAceStepDir();
    const scriptPath = path.resolve(__dirname, '../../scripts/preprocess_dataset.py');
    const pythonPath = resolvePythonPath(aceStepDir);
    const resolvedDatasetPath = path.isAbsolute(datasetPath)
      ? datasetPath
      : path.resolve(aceStepDir, datasetPath);
    const resolvedOutput = outputDir
      ? (path.isAbsolute(outputDir) ? outputDir : path.resolve(aceStepDir, outputDir))
      : path.join(config.datasets.dir, 'preprocessed_tensors');

    // Ensure output dir exists
    await mkdir(resolvedOutput, { recursive: true });

    // Spawn Python process
    const child = spawn(pythonPath, [
      scriptPath,
      '--dataset', resolvedDatasetPath,
      '--output', resolvedOutput,
      '--json',
    ], {
      cwd: aceStepDir,
      env: {
        ...process.env,
        ACESTEP_PATH: aceStepDir,
        ACESTEP_OFFLOAD_TO_CPU: process.env.ACESTEP_OFFLOAD_TO_CPU ?? 'true',
        ACESTEP_OFFLOAD_DIT_TO_CPU: process.env.ACESTEP_OFFLOAD_DIT_TO_CPU ?? 'true',
        ACESTEP_USE_FLASH_ATTENTION: process.env.ACESTEP_USE_FLASH_ATTENTION ?? 'false',
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim()) {
          console.error('[Training][preprocess]', line);
        }
      }
    });

    const parseLastJsonLine = (text: string): Record<string, unknown> | null => {
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line.startsWith('{')) continue;
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Ignore non-JSON lines and keep scanning upward.
        }
      }

      return null;
    };

    child.on('close', (code: number | null) => {
      const parsedResult = parseLastJsonLine(stdout) ?? parseLastJsonLine(stderr);
      if (code === 0) {
        // Try to parse JSON output
        try {
          const result = parsedResult ?? JSON.parse(stdout.trim().split('\n').pop() || '{}');
          res.json({ status: 'Preprocessing complete', ...result });
        } catch {
          res.json({ status: 'Preprocessing complete', output: stdout.trim() });
        }
      } else {
        const message =
          typeof parsedResult?.message === 'string' && parsedResult.message.trim()
            ? parsedResult.message.trim()
            : (stderr.trim() || stdout.trim() || `Process exited with code ${code ?? 'unknown'}`);

        console.error('[Training] Preprocess failed', {
          code,
          datasetPath: resolvedDatasetPath,
          outputDir: resolvedOutput,
          message,
        });

        res.status(500).json({
          error: message,
          code,
          stderr: stderr.trim().slice(-4000),
          stdout: stdout.trim().slice(-4000),
        });
      }
    });

    child.on('error', (err: Error) => {
      res.status(500).json({ error: `Failed to spawn process: ${err.message}` });
    });
  } catch (error) {
    console.error('[Training] Preprocess error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Preprocessing failed' });
  }
});

// POST /api/training/scan-directory — Scan a directory for audio files (Node.js implementation)
router.post('/scan-directory', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      audioDir,
      datasetName = 'my_lora_dataset',
      customTag = '',
      tagPosition = 'prepend',
      allInstrumental = true,
    } = req.body;

    if (!audioDir || typeof audioDir !== 'string') {
      res.status(400).json({ error: 'audioDir is required' });
      return;
    }

    // Resolve path — if relative, resolve from ACE-Step dir
    const aceStepDir = getAceStepDir();
    const resolvedDir = path.isAbsolute(audioDir)
      ? audioDir
      : path.resolve(aceStepDir, audioDir);

    if (!existsSync(resolvedDir)) {
      res.status(400).json({ error: `Directory not found: ${audioDir}` });
      return;
    }

    // Scan for audio files
    const entries = readdirSync(resolvedDir);
    const audioFiles = entries.filter(f => AUDIO_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    if (audioFiles.length === 0) {
      res.status(400).json({ error: 'No audio files found in directory' });
      return;
    }

    // Build table data matching Gradio's format: [#, Filename, Duration, Lyrics, Labeled, BPM, Key, Caption]
    const tableHeaders = ['#', 'Filename', 'Duration', 'Lyrics', 'Labeled', 'BPM', 'Key', 'Caption'];
    const tableData = audioFiles.map((filename, i) => {
      const audioPath = path.join(resolvedDir, filename);
      const duration = getAudioDuration(audioPath);
      const baseName = path.basename(filename, path.extname(filename));

      // Check for companion .txt lyrics file
      let lyrics = allInstrumental ? '[Instrumental]' : '';
      const lyricsPath = path.join(resolvedDir, `${baseName}.txt`);
      if (existsSync(lyricsPath)) {
        try {
          lyrics = readFileSync(lyricsPath, 'utf-8').trim().slice(0, 50) + '...';
        } catch { /* ignore */ }
      }

      return [i + 1, filename, `${duration}s`, lyrics, '❌', '', '', ''];
    });

    res.json({
      status: `Found ${audioFiles.length} audio files`,
      dataframe: {
        headers: tableHeaders,
        data: tableData,
      },
      sampleCount: audioFiles.length,
      audioDir: resolvedDir,
    });
  } catch (error) {
    console.error('[Training] Scan directory error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to scan directory' });
  }
});

// POST /api/training/auto-label — Auto-label dataset samples
// NOTE: Auto-labeling requires the DIT model + LLM to be loaded in Gradio.
// This endpoint attempts to call the Gradio handler. If the Gradio app does not
// expose auto_label_all as a named API, this will fail and the user should use
// the Gradio UI directly.
router.post('/auto-label', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      datasetPath,
      skipMetas = false,
      formatLyrics = false,
      transcribeLyrics = false,
      onlyUnlabeled = false,
    } = req.body;

    if (!datasetPath || typeof datasetPath !== 'string') {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }

    const aceStepDir = getAceStepDir();
    const resolvedDatasetPath = resolveAceStepRelativePath(datasetPath, aceStepDir);
    const dataset = await readDatasetFile(resolvedDatasetPath);
    const client = await getGradioClient();

    await loadDatasetIntoGradio(client, resolvedDatasetPath);

    const result = await client.predict('/lambda_71', [
      skipMetas,
      formatLyrics,
      transcribeLyrics,
      onlyUnlabeled,
    ]);
    const data = result.data as unknown[];
    const status = typeof data[1] === 'string' ? data[1] : 'Auto-label finished.';

    if (!isAutoLabelFailureStatus(status)) {
      await saveDatasetFromGradio(client, resolvedDatasetPath, getDatasetName(dataset.metadata, resolvedDatasetPath));
    }

    const refreshedDataset = await readDatasetFile(resolvedDatasetPath);

    res.json({
      status,
      labeledCount: countLabeledSamples(refreshedDataset.samples),
      sampleCount: refreshedDataset.samples.length,
    });
  } catch (error) {
    console.error('[Training] Auto-label error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Auto-label failed' });
  }
});

// POST /api/training/init-model — Initialize or change model for training
// NOTE: Model initialization requires the Gradio app. This endpoint attempts to
// call the init_service_wrapper. Since it's a lambda, this may not be accessible.
router.post('/init-model', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      checkpoint,
      configPath,
      device = 'auto',
      initLlm = false,
      lmModelPath = '',
      backend = 'pt',
      useFlashAttention = false,
      offloadToCpu = false,
      offloadDitToCpu = false,
      compileModel = false,
      quantization = false,
    } = req.body;

    const client = await getGradioClient();
    try {
      // Try calling by function name (may work if Gradio auto-names it)
      const result = await client.predict('/init_service_wrapper', [
        checkpoint ?? '',
        configPath ?? '',
        device,
        initLlm,
        lmModelPath,
        backend,
        useFlashAttention,
        offloadToCpu,
        offloadDitToCpu,
        compileModel,
        quantization,
      ]);
      const data = result.data as unknown[];
      res.json({
        status: data[0],
        modelReady: !!data[1],
      });
    } catch (gradioError) {
      // Lambda endpoints aren't named — suggest using Gradio UI
      res.status(501).json({
        error: 'Model initialization requires the Gradio UI.',
        hint: 'Initialize the model in the ACE-Step Gradio UI service configuration section, then return here for training.',
      });
    }
  } catch (error) {
    console.error('[Training] Init model error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Model init failed' });
  }
});

// GET /api/training/checkpoints — List available model checkpoints
router.get('/checkpoints', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const aceStepDir = getAceStepDir();
    const checkpointDir = path.join(aceStepDir, 'checkpoints');
    if (!existsSync(checkpointDir)) {
      res.json({ checkpoints: [], configs: [] });
      return;
    }

    // List checkpoint directories
    const entries = readdirSync(checkpointDir);
    const checkpoints = entries.filter(e => {
      const fullPath = path.join(checkpointDir, e);
      return statSync(fullPath).isDirectory();
    });

    // List config directories (acestep-v15-*)
    const configDirs = entries.filter(e =>
      e.startsWith('acestep-v15') && statSync(path.join(checkpointDir, e)).isDirectory()
    );

    res.json({ checkpoints, configs: configDirs });
  } catch (error) {
    console.error('[Training] List checkpoints error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list checkpoints' });
  }
});

// GET /api/training/lora-checkpoints — List LoRA training checkpoints in output dir
router.get('/lora-checkpoints', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const outputDir = (req.query.dir as string) || './lora_output';
    const aceStepDir = getAceStepDir();
    const resolvedDir = path.isAbsolute(outputDir)
      ? outputDir
      : path.resolve(aceStepDir, outputDir);

    if (!existsSync(resolvedDir)) {
      res.json({ checkpoints: [] });
      return;
    }

    const entries = readdirSync(resolvedDir);
    const checkpointsDir = path.join(resolvedDir, 'checkpoints');
    const checkpoints: string[] = [];

    if (existsSync(checkpointsDir)) {
      const cpEntries = readdirSync(checkpointsDir);
      cpEntries.forEach(e => {
        if (statSync(path.join(checkpointsDir, e)).isDirectory()) {
          checkpoints.push(path.join(checkpointsDir, e));
        }
      });
    }

    // Also check for "final" directory
    const finalDir = path.join(resolvedDir, 'final');
    if (existsSync(finalDir)) {
      checkpoints.push(finalDir);
    }

    res.json({ checkpoints, outputDir: resolvedDir });
  } catch (error) {
    console.error('[Training] List LoRA checkpoints error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list checkpoints' });
  }
});

// ================== EXISTING ROUTES ==================

// POST /api/training/load-dataset — Load an existing dataset JSON for preprocessing
router.post('/load-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { datasetPath } = req.body;
    if (!datasetPath || typeof datasetPath !== 'string') {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }
    // Reject path traversal
    if (datasetPath.includes('..')) {
      res.status(400).json({ error: 'Invalid path' });
      return;
    }

    const aceStepDir = getAceStepDir();
    const resolvedDatasetPath = resolveAceStepRelativePath(datasetPath, aceStepDir);
    const client = await getGradioClient();
    const result = await loadDatasetIntoGradio(client, resolvedDatasetPath);
    const dataset = await readDatasetFile(resolvedDatasetPath);
    const labeledCount = countLabeledSamples(dataset.samples);
    const loadStatus = typeof result[0] === 'string' ? result[0] : 'Dataset loaded.';
    const firstSample = result.length >= 16
      ? mapGradioPreviewSample(result, Number(result[2] ?? 0), {
        audio: 3,
        filename: 4,
        caption: 5,
        genre: 6,
        promptOverride: 7,
        lyrics: 8,
        bpm: 9,
        key: 10,
        timeSignature: 11,
        duration: 12,
        language: 13,
        instrumental: 14,
        rawLyrics: 15,
      })
      : mapDatasetSample(dataset.samples[0], 0);

    res.json({
      status: `${loadStatus}\nSamples: ${dataset.samples.length} (${labeledCount} labeled)`,
      dataframe: result[1] ?? [],
      sampleCount: dataset.samples.length,
      sample: firstSample,
      settings: {
        datasetName: getDatasetName(dataset.metadata, resolvedDatasetPath),
        customTag: dataset.metadata.custom_tag ?? '',
        tagPosition: dataset.metadata.tag_position ?? 'prepend',
        allInstrumental: dataset.metadata.all_instrumental ?? false,
        genreRatio: dataset.metadata.genre_ratio ?? 0,
      },
    });
  } catch (error) {
    console.error('[Training] Load dataset error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load dataset' });
  }
});

// GET /api/training/sample-preview — Get preview data for a specific sample
router.get('/sample-preview', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const idx = parseInt(req.query.idx as string) || 0;
    const client = await getGradioClient();
    const result = await client.predict('/get_sample_preview', [idx]);
    const data = result.data as unknown[];
    res.json(mapGradioPreviewSample(data, idx, {
      audio: 0,
      filename: 1,
      caption: 2,
      genre: 3,
      promptOverride: 4,
      lyrics: 5,
      bpm: 6,
      key: 7,
      timeSignature: 8,
      duration: 9,
      language: 10,
      instrumental: 11,
      rawLyrics: 12,
    }));
  } catch (error) {
    console.error('[Training] Sample preview error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get sample preview' });
  }
});

// POST /api/training/save-sample — Save edits to a dataset sample
router.post('/save-sample', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      sampleIdx,
      datasetPath,
      caption,
      genre,
      promptOverride,
      lyrics,
      bpm,
      key,
      timeSignature,
      language,
      instrumental,
    } = req.body;

    if (!datasetPath || typeof datasetPath !== 'string') {
      res.status(400).json({ error: 'datasetPath is required' });
      return;
    }

    const aceStepDir = getAceStepDir();
    const resolvedDatasetPath = resolveAceStepRelativePath(datasetPath, aceStepDir);
    const dataset = await readDatasetFile(resolvedDatasetPath);
    const client = await getGradioClient();

    await loadDatasetIntoGradio(client, resolvedDatasetPath);

    const updateResult = await client.predict('/save_sample_edit', [
      sampleIdx ?? 0,
      caption ?? '',
      genre ?? '',
      promptOverride ?? 'Use Global Ratio',
      lyrics ?? '',
      bpm ?? 120,
      key ?? '',
      timeSignature ?? '',
      language ?? 'unknown',
      instrumental ?? true,
    ]);
    const updateData = updateResult.data as unknown[];
    const editStatus = typeof updateData[1] === 'string' ? updateData[1] : 'Sample updated.';

    await saveDatasetFromGradio(client, resolvedDatasetPath, getDatasetName(dataset.metadata, resolvedDatasetPath));

    res.json({
      dataframe: updateData[0] ?? null,
      status: `${editStatus} Saved to ${resolvedDatasetPath}`,
    });
  } catch (error) {
    console.error('[Training] Save sample error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save sample edit' });
  }
});

// POST /api/training/update-settings — Update dataset global settings
// Settings are applied directly when saving (via REST API), so no Gradio call needed here.
router.post('/update-settings', authMiddleware, (_req: AuthenticatedRequest, res: Response) => {
  res.json({ success: true });
});

// POST /api/training/save-dataset — Save the dataset to a JSON file
router.post('/save-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { savePath, datasetName, customTag, tagPosition, allInstrumental, genreRatio } = req.body;
    void customTag;
    void tagPosition;
    void allInstrumental;
    void genreRatio;

    const aceStepDir = getAceStepDir();
    const rawPath = (savePath ?? `./datasets/${datasetName ?? 'my_lora_dataset'}.json`).trim();
    const resolvedPath = resolveAceStepRelativePath(rawPath, aceStepDir);
    const client = await getGradioClient();
    const data = await saveDatasetFromGradio(
      client,
      resolvedPath,
      typeof datasetName === 'string' && datasetName.trim()
        ? datasetName.trim()
        : path.basename(resolvedPath, '.json'),
    );

    res.json({
      status: typeof data[0] === 'string' ? data[0] : 'Saved',
      path: typeof data[1] === 'string' ? data[1] : resolvedPath,
    });
  } catch (error) {
    console.error('[Training] Save dataset error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save dataset' });
  }
});

// POST /api/training/load-tensors — Load preprocessed tensors for training
router.post('/load-tensors', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tensorDir } = req.body;
    const aceStepDir = getAceStepDir();
    const resolvedTensorDir = resolveTensorDirForTraining(tensorDir, aceStepDir);
    assertValidTensorDir(resolvedTensorDir, aceStepDir);

    const client = await getGradioClient();
    const result = await client.predict('/load_training_dataset', [
      resolvedTensorDir,
    ]);
    const data = result.data as unknown[];

    res.json({
      status: data[0],
      tensorDir: resolvedTensorDir,
      tensorFiles: countPtFiles(resolvedTensorDir),
    });
  } catch (error) {
    console.error('[Training] Load tensors error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load training dataset' });
  }
});

// POST /api/training/start — Start LoRA training
router.post('/start', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (trainingRunStatus.running) {
      res.status(409).json({
        error: 'Training is already running',
        status: trainingRunStatus.progress,
        log: trainingRunStatus.log,
      });
      return;
    }

    const {
      tensorDir, rank, alpha, dropout, learningRate,
      epochs, batchSize, gradientAccumulation, saveEvery,
      shift, seed, outputDir, resumeCheckpoint,
    } = req.body;

    const aceStepDir = getAceStepDir();
    const resolvedTensorDir = resolveTensorDirForTraining(tensorDir, aceStepDir);
    assertValidTensorDir(resolvedTensorDir, aceStepDir);

    const client = await getGradioClient();
    const startedAt = new Date().toISOString();
    trainingRunStatus = {
      running: true,
      startedAt,
      updatedAt: startedAt,
      progress: `Training started from ${resolvedTensorDir}`,
      log: `Tensor files: ${countPtFiles(resolvedTensorDir)}`,
      metrics: null,
      error: null,
    };

    const submission = client.submit('/training_wrapper', [
      resolvedTensorDir,
      rank ?? 64,
      alpha ?? 128,
      dropout ?? 0.1,
      learningRate ?? 0.0003,
      epochs ?? 1000,
      batchSize ?? 1,
      gradientAccumulation ?? 1,
      saveEvery ?? 200,
      shift ?? 3.0,
      seed ?? 42,
      outputDir ?? './lora_output',
      resumeCheckpoint ?? null,
    ]);
    activeTrainingSubmission = submission;

    void (async () => {
      try {
        for await (const message of submission) {
          trainingRunStatus.updatedAt = new Date().toISOString();

          if (message.type === 'data') {
            const data = Array.isArray(message.data) ? message.data as unknown[] : [];
            trainingRunStatus.progress = typeof data[0] === 'string' ? data[0] : trainingRunStatus.progress;
            trainingRunStatus.log = typeof data[1] === 'string' ? data[1] : trainingRunStatus.log;
            trainingRunStatus.metrics = data[2] ?? trainingRunStatus.metrics;
          } else if (message.type === 'status') {
            if (typeof message.message === 'string' && message.message.trim()) {
              trainingRunStatus.progress = message.message;
            }
            if (message.stage === 'error') {
              trainingRunStatus.error = typeof message.message === 'string'
                ? message.message
                : 'Training failed.';
            }
          }
        }
      } catch (error) {
        trainingRunStatus.error = error instanceof Error ? error.message : 'Training failed.';
      } finally {
        trainingRunStatus.running = false;
        trainingRunStatus.updatedAt = new Date().toISOString();
        activeTrainingSubmission = null;
      }
    })();

    res.json({
      status: 'Training started',
      progress: trainingRunStatus.progress,
      running: true,
    });
  } catch (error) {
    trainingRunStatus.running = false;
    trainingRunStatus.error = error instanceof Error ? error.message : 'Failed to start training';
    console.error('[Training] Start training error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start training' });
  }
});

router.get('/status', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  res.json(trainingRunStatus);
});

// POST /api/training/stop — Stop current training
router.post('/stop', authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    if (activeTrainingSubmission?.cancel) {
      await activeTrainingSubmission.cancel();
      activeTrainingSubmission = null;
    }

    const client = await getGradioClient();
    const result = await client.predict('/stop_training', []);
    const data = result.data as unknown[];

    trainingRunStatus.running = false;
    trainingRunStatus.updatedAt = new Date().toISOString();
    trainingRunStatus.progress = typeof data[0] === 'string' ? data[0] : 'Training stop requested.';

    res.json({ status: trainingRunStatus.progress });
  } catch (error) {
    console.error('[Training] Stop training error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to stop training' });
  }
});

// POST /api/training/export — Export trained LoRA weights
router.post('/bind-voice', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const singerId = typeof req.body?.singerId === 'string' ? req.body.singerId.trim() : '';
    const adapterPath = typeof req.body?.adapterPath === 'string' ? req.body.adapterPath.trim() : '';
    const exportPath = typeof req.body?.exportPath === 'string' ? req.body.exportPath.trim() : '';
    const outputDir = typeof req.body?.outputDir === 'string' ? req.body.outputDir.trim() : '';
    const datasetName = typeof req.body?.datasetName === 'string' ? req.body.datasetName.trim() : '';
    const trainingMeta = parseJsonObject(req.body?.trainingMeta);

    if (!singerId) {
      res.status(400).json({ error: 'singerId is required' });
      return;
    }

    if (!adapterPath) {
      res.status(400).json({ error: 'adapterPath is required' });
      return;
    }

    const singerResult = await pool.query(
      'SELECT id, user_id, name FROM virtual_singers WHERE id = ?',
      [singerId],
    );

    if (singerResult.rows.length === 0) {
      res.status(404).json({ error: 'Singer not found' });
      return;
    }

    const singer = singerResult.rows[0] as { id: string; user_id: string; name: string };
    if (singer.user_id !== req.user!.id) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const existingBindingResult = await pool.query(
      `SELECT singer_id, adapter_path, export_path, output_dir, dataset_name, training_meta, bound_at, updated_at
       FROM singer_voice_binding
       WHERE singer_id = ?`,
      [singerId],
    );

    const existingBinding = existingBindingResult.rows[0] as
      | {
          singer_id: string;
          adapter_path: string;
          export_path: string | null;
          output_dir: string | null;
          dataset_name: string | null;
          training_meta: string | null;
          bound_at: string | null;
          updated_at: string | null;
        }
      | undefined;

    const aceStepDir = getAceStepDir();
    const newResolvedPaths = [
      resolveWithinAceStep(adapterPath, aceStepDir),
      resolveWithinAceStep(exportPath || undefined, aceStepDir),
      resolveWithinAceStep(outputDir || undefined, aceStepDir),
    ];

    const loraState = getLoraState();
    if (
      existingBinding?.adapter_path &&
      loraState.path === existingBinding.adapter_path &&
      existingBinding.adapter_path !== adapterPath
    ) {
      await clearSingerVoice();
    }

    await pool.query(
      `INSERT INTO singer_voice_binding (
         singer_id,
         adapter_path,
         export_path,
         output_dir,
         dataset_name,
         training_meta,
         bound_at,
         updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(singer_id) DO UPDATE SET
         adapter_path = excluded.adapter_path,
         export_path = excluded.export_path,
         output_dir = excluded.output_dir,
         dataset_name = excluded.dataset_name,
         training_meta = excluded.training_meta,
         bound_at = datetime('now'),
         updated_at = datetime('now')`,
      [
        singerId,
        adapterPath,
        exportPath || null,
        outputDir || null,
        datasetName || null,
        JSON.stringify(trainingMeta),
      ],
    );

    if (existingBinding) {
      await cleanupReplacedBindingPaths(
        [
          resolveWithinAceStep(existingBinding.adapter_path, aceStepDir),
          resolveWithinAceStep(existingBinding.export_path || undefined, aceStepDir),
          resolveWithinAceStep(existingBinding.output_dir || undefined, aceStepDir),
        ],
        newResolvedPaths,
        aceStepDir,
      );
    }

    const updatedBindingResult = await pool.query(
      `SELECT singer_id, adapter_path, export_path, output_dir, dataset_name, training_meta, bound_at, updated_at
       FROM singer_voice_binding
       WHERE singer_id = ?`,
      [singerId],
    );

    const binding = updatedBindingResult.rows[0] as {
      singer_id: string;
      adapter_path: string;
      export_path: string | null;
      output_dir: string | null;
      dataset_name: string | null;
      training_meta: string | null;
      bound_at: string | null;
      updated_at: string | null;
    };

    res.json({
      success: true,
      replacedExisting: Boolean(existingBinding),
      singerId,
      singerName: singer.name,
      binding: {
        singerId: binding.singer_id,
        adapterPath: binding.adapter_path,
        exportPath: binding.export_path,
        outputDir: binding.output_dir,
        datasetName: binding.dataset_name,
        trainingMeta: parseJsonObject(binding.training_meta),
        boundAt: binding.bound_at,
        updatedAt: binding.updated_at,
      },
    });
  } catch (error) {
    console.error('[Training] Bind voice error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to bind voice' });
  }
});

router.post('/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { exportPath, loraOutputDir } = req.body;

    const client = await getGradioClient();
    const result = await client.predict('/export_lora', [
      exportPath ?? './lora_output/final_lora',
      loraOutputDir ?? './lora_output',
    ]);
    const data = result.data as unknown[];

    res.json({
      status: data[0],
      exportPath: exportPath ?? './lora_output/final_lora',
      loraOutputDir: loraOutputDir ?? './lora_output',
    });
  } catch (error) {
    console.error('[Training] Export LoRA error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to export LoRA' });
  }
});

// POST /api/training/import-dataset — Import train/test split
router.post('/import-dataset', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { datasetType } = req.body;

    const client = await getGradioClient();
    const result = await client.predict('/import_dataset', [
      datasetType ?? 'train',
    ]);
    const data = result.data as unknown[];

    res.json({ status: data[0] });
  } catch (error) {
    console.error('[Training] Import dataset error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to import dataset' });
  }
});

export default router;

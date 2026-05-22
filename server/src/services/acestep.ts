import { writeFile, mkdir, copyFile, rm, readFile } from 'fs/promises';
import { spawn, execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { handle_file } from '@gradio/client';

// Get audio duration using ffprobe
function getAudioDuration(filePath: string): number {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    return isNaN(duration) ? 0 : Math.round(duration);
  } catch (error) {
    console.warn('Failed to get audio duration:', error);
    return 0;
  }
}
import { fileURLToPath } from 'url';
import { config } from '../config/index.js';
import { getGradioClient, resetGradioClient, isGradioAvailable } from './gradio-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_DIR = path.join(__dirname, '../../public/audio');

function normalizeAceStepApiBase(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/gradio_api')
    ? trimmed.slice(0, -'/gradio_api'.length)
    : trimmed;
}

const ACESTEP_API = normalizeAceStepApiBase(config.acestep.apiUrl);

async function postAceStepJsonViaPowerShell<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const tempDir = path.join(__dirname, '../../tmp');
  const tempJsonPath = path.join(
    tempDir,
    `acestep-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
  );
  const tempScriptPath = path.join(
    tempDir,
    `acestep-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`,
  );

  await mkdir(tempDir, { recursive: true });
  await writeFile(tempJsonPath, JSON.stringify(body), 'utf8');
  await writeFile(
    tempScriptPath,
    [
      "param(",
      "  [string]$JsonPath,",
      "  [string]$Url",
      ")",
      "$ErrorActionPreference = 'Stop'",
      "$raw = [System.IO.File]::ReadAllText($JsonPath, [System.Text.Encoding]::UTF8)",
      "$obj = $raw | ConvertFrom-Json",
      "$json = $obj | ConvertTo-Json -Depth 100 -Compress",
      "$resp = Invoke-RestMethod -Uri $Url -Method Post -ContentType 'application/json' -Body $json",
      "$resp | ConvertTo-Json -Depth 50 -Compress",
    ].join('\n'),
    'utf8',
  );

  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        [
          '-NoProfile',
          '-File',
          tempScriptPath,
          '-JsonPath',
          tempJsonPath,
          '-Url',
          `${ACESTEP_API}${endpoint}`,
        ],
        { windowsHide: true },
      );

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }
        reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
      });
    });

    try {
      return JSON.parse(output) as T;
    } catch (error) {
      throw new Error(`PowerShell returned non-JSON output: ${output.slice(0, 500)}`, { cause: error });
    }
  } finally {
    await rm(tempJsonPath, { force: true }).catch(() => undefined);
    await rm(tempScriptPath, { force: true }).catch(() => undefined);
  }
}

async function postAceStepJson<T>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const url = `${ACESTEP_API}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return await response.json() as T;
    }

    const message = await response.text().catch(() => '');
    if (process.platform === 'win32') {
      try {
        return await postAceStepJsonViaPowerShell<T>(endpoint, body);
      } catch (psError) {
        throw new Error(
          `ACE-Step request failed via fetch (${response.status} ${message}) and PowerShell fallback (${(psError as Error).message})`,
        );
      }
    }

    throw new Error(`ACE-Step request failed: ${response.status} ${message}`.trim());
  } catch (error) {
    if (process.platform === 'win32') {
      return await postAceStepJsonViaPowerShell<T>(endpoint, body);
    }
    throw error;
  }
}

// Resolve ACE-Step path (from env or default relative path)
function resolveAceStepPath(): string {
  const envPath = process.env.ACESTEP_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  // Default: sibling directory (server/src/services -> ../../../ACE-Step-1.5 = app/ACE-Step-1.5)
  return path.resolve(__dirname, '../../../ACE-Step-1.5');
}

// Resolve Python path cross-platform (supports venv and portable installations)
export function resolvePythonPath(baseDir: string): string {
  // Allow explicit override via env var
  if (process.env.PYTHON_PATH) {
    return process.env.PYTHON_PATH;
  }

  const isWindows = process.platform === 'win32';
  const pythonExe = isWindows ? 'python.exe' : 'python';

  // Check for portable installation first (python_embeded)
  const portablePath = path.join(baseDir, 'python_embeded', pythonExe);
  if (existsSync(portablePath)) {
    return portablePath;
  }

  // Check common venv directory names (Pinokio uses 'env', others use '.venv' or 'venv')
  const venvDirs = ['env', '.venv', 'venv'];
  for (const venvDir of venvDirs) {
    const venvPython = isWindows
      ? path.join(baseDir, venvDir, 'Scripts', pythonExe)
      : path.join(baseDir, venvDir, 'bin', 'python');
    if (existsSync(venvPython)) {
      return venvPython;
    }
  }

  // Fallback to first option (will produce a clear error if not found)
  if (isWindows) {
    return path.join(baseDir, 'env', 'Scripts', pythonExe);
  }
  return path.join(baseDir, 'env', 'bin', 'python');
}

const ACESTEP_DIR = resolveAceStepPath();
const SCRIPTS_DIR = path.join(__dirname, '../../scripts');
const PYTHON_SCRIPT = path.join(SCRIPTS_DIR, 'simple_generate.py');

// ---------------------------------------------------------------------------
// Gradio generation: map params to the 51 positional args for /generation_wrapper
// ---------------------------------------------------------------------------

/**
 * Resolve an audio URL (e.g. /audio/file.mp3) to an absolute local file path.
 */
function resolveAudioPath(audioUrl: string): string {
  if (audioUrl.startsWith('/audio/')) {
    return path.join(AUDIO_DIR, audioUrl.replace('/audio/', ''));
  }
  if (audioUrl.startsWith('http')) {
    try {
      const parsed = new URL(audioUrl);
      if (parsed.pathname.startsWith('/audio/')) {
        return path.join(AUDIO_DIR, parsed.pathname.replace('/audio/', ''));
      }
    } catch { /* fall through */ }
  }
  return audioUrl;
}

/**
 * Prepare a local audio file for Gradio upload.
 * Returns a handle_file() wrapper or null if no file.
 */
async function prepareAudioFile(audioUrl: string | undefined): Promise<unknown> {
  if (!audioUrl) return null;

  const filePath = resolveAudioPath(audioUrl);

  try {
    const buffer = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
      '.opus': 'audio/opus', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4',
    };
    const mimeType = mimeMap[ext] || 'audio/mpeg';
    const blob = new Blob([buffer], { type: mimeType });
    return handle_file(blob);
  } catch (error) {
    console.warn(`[Gradio] Failed to read audio file ${filePath}:`, error);
    // Fall back to URL-based reference if file can't be read locally
    if (audioUrl.startsWith('http')) {
      return handle_file(audioUrl);
    }
    return null;
  }
}

/**
 * Build the 50 positional arguments for the Gradio /generation_wrapper endpoint.
 */
async function buildGradioArgs(params: GenerationParams): Promise<unknown[]> {
  const prompt = buildPromptText(params);
  const lyrics = params.instrumental ? '' : (params.lyrics || '');
  const isThinking = params.thinking ?? false;
  const isEnhance = params.enhance ?? false;

  // Prepare audio files (async — reads from disk)
  const referenceAudio = await prepareAudioFile(params.referenceAudioUrl);
  const sourceAudio = await prepareAudioFile(params.sourceAudioUrl);

  // Guard: cover/repaint modes require source audio to be loadable
  const needsSource = params.taskType === 'cover' || params.taskType === 'audio2audio' || params.taskType === 'repaint';
  if (needsSource && params.sourceAudioUrl && sourceAudio === null) {
    throw new Error(`Source audio file could not be loaded from: ${params.sourceAudioUrl}. Make sure the file was uploaded successfully.`);
  }

  // CoT features are gated by enhance OR thinking (either enables LLM enrichment)
  const useCot = isEnhance || isThinking;

  return [
    prompt,                                                       //  0: Music Caption
    lyrics,                                                       //  1: Lyrics
    params.bpm && params.bpm > 0 ? params.bpm : 0,               //  2: BPM (0 = auto)
    params.keyScale || '',                                        //  3: KeyScale
    params.timeSignature || '',                                   //  4: Time Signature
    params.vocalLanguage || 'en',                                 //  5: Vocal Language
    params.inferenceSteps ?? 8,                                   //  6: DiT Inference Steps
    params.guidanceScale ?? 7.0,                                  //  7: DiT Guidance Scale
    params.randomSeed !== false,                                  //  8: Random Seed
    String(params.seed ?? -1),                                    //  9: Seed
    referenceAudio,                                               // 10: Reference Audio (filepath | null)
    params.duration && params.duration > 0 ? params.duration : -1, // 11: Audio Duration (-1 = auto)
    Math.min(Math.max(params.batchSize ?? 1, 1), 16),            // 12: Batch Size (clamped 1-16)
    sourceAudio,                                                  // 13: Source Audio (filepath | null)
    params.audioCodes || '',                                      // 14: LM Codes Hints
    params.repaintingStart ?? 0.0,                                // 15: Repainting Start
    params.repaintingEnd ?? -1,                                   // 16: Repainting End
    params.instruction || 'Fill the audio semantic mask with the style described in the text prompt.', // 17: Instruction
    params.audioCoverStrength ?? 1.0,                             // 18: Audio Cover Strength
    0.0,                                                          // 19: Cover Noise Strength (ACE-Step v1.5 new param, default 0.0)
    (params.taskType === 'audio2audio' ? 'cover' : params.taskType) || 'text2music', // 20: Task Type
    params.useAdg ?? false,                                       // 21: Use ADG
    params.cfgIntervalStart ?? 0.0,                               // 22: CFG Interval Start
    params.cfgIntervalEnd ?? 1.0,                                 // 23: CFG Interval End
    params.shift ?? 3.0,                                          // 24: Shift
    params.inferMethod || 'ode',                                  // 25: Inference Method
    'euler',                                                      // 26: Sampler Mode
    0.0,                                                          // 27: Velocity Norm Threshold
    0.0,                                                          // 28: Velocity EMA Factor
    params.customTimesteps || '',                                 // 29: Custom Timesteps
    params.audioFormat || 'mp3',                                  // 30: Audio Format
    '128k',                                                       // 31: MP3 Bitrate
    48000,                                                        // 32: MP3 Sample Rate
    params.lmTemperature ?? 0.85,                                 // 33: LM Temperature
    isThinking,                                                   // 34: Think
    params.lmCfgScale ?? 2.0,                                     // 35: LM CFG Scale
    params.lmTopK ?? 0,                                           // 36: LM Top-K
    params.lmTopP ?? 0.9,                                         // 37: LM Top-P
    params.lmNegativePrompt || 'NO USER INPUT',                   // 38: LM Negative Prompt
    useCot ? (params.useCotMetas ?? true) : false,                // 39: CoT Metas
    useCot ? (params.useCotCaption ?? true) : false,              // 40: CaptionRewrite
    useCot ? (params.useCotLanguage ?? true) : false,             // 41: CoT Language
    params.isFormatCaption ?? false,                              // 42: Is Format Caption State
    params.constrainedDecodingDebug ?? false,                     // 43: Constrained Decoding Debug
    params.allowLmBatch ?? true,                                  // 44: ParallelThinking
    params.getScores ?? false,                                    // 45: Auto Score
    params.getLrc ?? false,                                       // 46: Auto LRC (timestamped lyrics)
    params.scoreScale ?? 0.5,                                     // 47: Quality Score Sensitivity (0.01-1.0)
    params.lmBatchChunkSize ?? 8,                                 // 48: LM Batch Chunk Size
    params.trackName || null,                                     // 49: Track Name
    params.completeTrackClasses || [],                            // 50: Track Names
    true,                                                         // 51: Enable Normalization
    -1.0,                                                         // 52: Normalization DB
    0.0,                                                          // 53: Fade In Duration
    0.0,                                                          // 54: Fade Out Duration
    0.0,                                                          // 55: Latent Shift
    1.0,                                                          // 56: Latent Rescale
    'balanced',                                                   // 57: Repaint Mode
    0.5,                                                          // 58: Repaint Strength
    params.autogen ?? false,                                      // 59: AutoGen
    // Note: current_batch_index, total_batches, batch_queue, generation_params_state
    // are hidden Gradio state variables and must NOT be passed via client.predict()
  ];
}

/**
 * Download a Gradio audio result file to local storage.
 * Gradio returns file objects with { url, path, orig_name, ... }.
 * We copy from the server-local path (same machine) or download via URL.
 */
async function downloadGradioAudioFile(
  fileObj: { url?: string; path?: string; orig_name?: string },
  destPath: string,
): Promise<void> {
  await mkdir(path.dirname(destPath), { recursive: true });

  // Prefer direct filesystem copy (both servers on same machine)
  if (fileObj.path && existsSync(fileObj.path)) {
    await copyFile(fileObj.path, destPath);
    return;
  }

  // Fall back to HTTP download via Gradio URL (use temp file for atomicity)
  if (fileObj.url) {
    const response = await fetch(fileObj.url);
    if (!response.ok) {
      throw new Error(`Failed to download Gradio audio: ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error('Downloaded audio file is empty');
    }
    const tmpPath = destPath + '.tmp';
    await writeFile(tmpPath, buffer);
    const { rename } = await import('fs/promises');
    await rename(tmpPath, destPath);
    return;
  }

  throw new Error('Gradio file object has neither path nor url');
}

// ---------------------------------------------------------------------------
// Generation types & interfaces (unchanged public API)
// ---------------------------------------------------------------------------

export interface GenerationParams {
  // Mode
  customMode: boolean;

  // Simple Mode
  songDescription?: string;

  // Custom Mode
  lyrics: string;
  style: string;
  title: string;

  // Common
  instrumental: boolean;
  vocalLanguage?: string;

  // Music Parameters
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;

  // Generation Settings
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  enhance?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;

  // LM Parameters
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
  lmBackend?: 'pt' | 'vllm';
  lmModel?: string;

  // Expert Parameters
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  referenceAudioTitle?: string;
  sourceAudioTitle?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
  isFormatCaption?: boolean;

  // Model selection
  ditModel?: string;
  singerGender?: 'female' | 'male' | null;
}

interface GenerationResult {
  audioUrls: string[];
  duration: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  caption?: string;
  lyrics?: string;
  vocalLanguage?: string;
  status: string;
}

interface JobStatus {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  queuePosition?: number;
  etaSeconds?: number;
  progress?: number;
  stage?: string;
  result?: GenerationResult;
  error?: string;
}

interface ActiveJob {
  params: GenerationParams;
  startTime: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  taskId?: string;
  result?: GenerationResult;
  error?: string;
  processPromise?: Promise<void>;
  rawResponse?: unknown;
  queuePosition?: number;
  progress?: number;
  stage?: string;
}

const activeJobs = new Map<string, ActiveJob>();

// Periodic cleanup of old jobs (every 10 minutes, remove jobs older than 1 hour)
setInterval(() => cleanupOldJobs(3600000), 600000);

// Job queue for sequential processing (GPU can only handle one job at a time)
const jobQueue: string[] = [];
let isProcessingQueue = false;

function buildPromptText(params: GenerationParams): string {
  const singerGenderHint = !params.instrumental
    ? (
      params.singerGender === 'female'
        ? 'female vocal lead'
        : params.singerGender === 'male'
          ? 'male vocal lead'
          : null
    )
    : null;

  const parts = [
    params.songDescription?.trim(),
    params.style?.trim(),
    singerGenderHint,
  ].filter((value): value is string => Boolean(value));

  return parts.join(', ') || singerGenderHint || 'pop music';
}

function buildAutoLyricsSampleQuery(params: GenerationParams): string {
  const base = buildPromptText(params).trim();
  const language = params.vocalLanguage || 'zh';

  // Front-load the language directive so the LLM commits to the script
  // before parsing the (often code-mixed) caption text. The metadata FSM
  // only locks the `language` field — lyric body is free-form, so the
  // strongest lever we have is repeated, leading-position instructions.
  //
  // CAUTION: parse_description_hints in ACE-Step does a substring match for
  // "instrumental"/"pure music" and force-flips the request to instrumental.
  // Never use those words here, even when negating them.
  if (language === 'zh') {
    return [
      'Write Mandarin Chinese (Simplified) vocal song lyrics using Hanzi characters only.',
      '必须使用简体中文汉字写歌词。',
      '严禁使用拼音、罗马字、英文字母。',
      'Do NOT output pinyin or romanization. Lyrics must be Hanzi.',
      `主题: ${base}`,
      '人声演唱，需要歌词。',
    ].filter(Boolean).join('\n');
  }

  if (language === 'yue') {
    return [
      'Write Cantonese (粤语) vocal song lyrics using Traditional or Simplified Chinese characters only.',
      '必须使用中文汉字写粤语歌词，严禁拼音和罗马字。',
      `主题: ${base}`,
      '人声演唱，需要歌词。',
    ].filter(Boolean).join('\n');
  }

  const scriptHint = (() => {
    switch (language) {
      case 'en': return 'English vocal lyrics.';
      case 'ja': return 'Japanese vocal lyrics using Kanji/Kana only — no romaji.';
      case 'ko': return 'Korean vocal lyrics using Hangul only — no romanization.';
      default: return `Vocal lyrics in language code "${language}" — use the native script.`;
    }
  })();

  return [scriptHint, `Theme: ${base}`, 'Sung vocal performance with lyrics.'].join('\n');
}

function shouldUseAutoLyricsMode(params: GenerationParams): boolean {
  const taskType = params.taskType || 'text2music';
  return (
    taskType === 'text2music' &&
    !params.instrumental &&
    !params.lyrics?.trim() &&
    !params.referenceAudioUrl &&
    !params.sourceAudioUrl &&
    !params.audioCodes &&
    Boolean(buildPromptText(params))
  );
}

function shouldUseRestGeneration(params: GenerationParams): boolean {
  const taskType = params.taskType || 'text2music';
  return (
    taskType === 'text2music' &&
    !params.referenceAudioUrl &&
    !params.sourceAudioUrl &&
    !params.audioCodes
  );
}

function wantsChineseLyrics(params: GenerationParams): boolean {
  return params.vocalLanguage === 'zh' || params.vocalLanguage === 'yue';
}

function containsHanzi(value: string): boolean {
  return /[\u4e00-\u9fff]/.test(value);
}

function looksLikeRomanizedLyrics(value: string): boolean {
  const stripped = value.replace(/\[[^\]]*\]/g, '').trim();
  return /[a-zA-Z]/.test(stripped) && !containsHanzi(stripped);
}

function validateChineseLyrics(lyrics: string, context: string): void {
  if (!lyrics.trim()) {
    throw new Error(`${context} did not return lyrics. Please retry or provide Chinese lyrics manually.`);
  }
  if (!containsHanzi(lyrics) || looksLikeRomanizedLyrics(lyrics)) {
    throw new Error(`${context} returned pinyin/romanized lyrics instead of Chinese Hanzi. Please retry or provide Chinese lyrics manually.`);
  }
}

function isMissingCreateSampleEndpoint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Not Found') || message.includes('404');
}

function buildQueryResultAudioUrl(file: string | undefined, fallbackUrl?: string): string {
  if (file) return file;
  if (fallbackUrl?.startsWith('http')) return fallbackUrl;
  if (fallbackUrl) {
    return `${ACESTEP_API}${fallbackUrl.startsWith('/') ? fallbackUrl : `/${fallbackUrl}`}`;
  }
  throw new Error('ACE-Step returned an audio item without a usable file path or URL');
}

interface AceStepQueryResultItem {
  file?: string;
  url?: string;
  status?: number;
  prompt?: string;
  caption?: string;
  lyrics?: string;
  bpm?: number;
  duration?: number;
  keyscale?: string;
  timesignature?: string;
  cot_caption?: string;
  cot_lyrics?: string;
  vocal_language?: string;
  metas?: {
    bpm?: number;
    duration?: number;
    keyscale?: string;
    timesignature?: string;
    caption?: string;
    lyrics?: string;
    vocal_language?: string;
  };
}

function getResultPrompt(item?: AceStepQueryResultItem): string {
  return item?.caption?.trim() || item?.cot_caption?.trim() || item?.metas?.caption?.trim() || item?.prompt?.trim() || '';
}

function getResultLyrics(item?: AceStepQueryResultItem): string {
  return item?.lyrics?.trim() || item?.cot_lyrics?.trim() || item?.metas?.lyrics?.trim() || '';
}

function getResultDuration(item?: AceStepQueryResultItem): number | undefined {
  return item?.duration || item?.metas?.duration;
}

function getResultBpm(item?: AceStepQueryResultItem): number | undefined {
  return item?.bpm || item?.metas?.bpm;
}

function getResultKeyScale(item?: AceStepQueryResultItem): string | undefined {
  return item?.keyscale || item?.metas?.keyscale;
}

function getResultTimeSignature(item?: AceStepQueryResultItem): string | undefined {
  return item?.timesignature || item?.metas?.timesignature;
}

interface AceStepCreateSampleResponse {
  data?: {
    caption?: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    keyscale?: string;
    key_scale?: string;
    timesignature?: string;
    time_signature?: string;
    vocal_language?: string;
  };
  error?: string | null;
}

async function createAutoLyricsSample(params: GenerationParams, query: string): Promise<{
  caption: string;
  lyrics: string;
  bpm?: number;
  duration?: number;
  keyScale?: string;
  timeSignature?: string;
  vocalLanguage?: string;
}> {
  const payload = await postAceStepJson<AceStepCreateSampleResponse>('/v1/create_sample', {
    query,
    instrumental: false,
    vocal_language: params.vocalLanguage || 'zh',
    temperature: params.lmTemperature ?? 0.8,
  });

  if (payload.error) {
    throw new Error(payload.error);
  }

  const data = payload.data;
  if (!data) {
    throw new Error('ACE-Step create_sample did not return data');
  }

  return {
    caption: data.caption?.trim() || '',
    lyrics: data.lyrics?.trim() || '',
    bpm: data.bpm,
    duration: data.duration,
    keyScale: data.keyscale || data.key_scale,
    timeSignature: data.timesignature || data.time_signature,
    vocalLanguage: data.vocal_language,
  };
}

async function prepareAutoLyricsInputs(params: GenerationParams): Promise<{
  prompt: string;
  lyrics: string;
  sampleQuery?: string;
  generatedCaption?: string;
  generatedBpm?: number;
  generatedDuration?: number;
  generatedKeyScale?: string;
  generatedTimeSignature?: string;
  generatedVocalLanguage?: string;
}> {
  const sampleQuery = buildAutoLyricsSampleQuery(params);
  let sample = await createAutoLyricsSample(params, sampleQuery);

  if (wantsChineseLyrics(params)) {
    try {
      validateChineseLyrics(sample.lyrics, 'ACE-Step create_sample');
    } catch (firstError) {
      const retryQuery = [
        sampleQuery,
        '',
        'Return ONLY Chinese Hanzi lyrics. Do not use pinyin, roman letters, English words, or romaji in the lyrics.',
        '歌词必须全部使用中文汉字。禁止拼音、罗马字、英文单词。',
      ].join('\n');
      sample = await createAutoLyricsSample(params, retryQuery);
      try {
        validateChineseLyrics(sample.lyrics, 'ACE-Step create_sample retry');
      } catch {
        throw firstError;
      }
    }
  }

  return {
    prompt: sample.caption || buildPromptText(params),
    lyrics: sample.lyrics,
    sampleQuery,
    generatedCaption: sample.caption,
    generatedBpm: sample.bpm,
    generatedDuration: sample.duration,
    generatedKeyScale: sample.keyScale,
    generatedTimeSignature: sample.timeSignature,
    generatedVocalLanguage: sample.vocalLanguage,
  };
}

// Health check - verify Gradio app is reachable
export async function checkSpaceHealth(): Promise<boolean> {
  return isGradioAvailable();
}

// ---------------------------------------------------------------------------
// Model switching — call /v1/init to change the active DiT model
// ---------------------------------------------------------------------------

async function getActiveModel(): Promise<string | null> {
  try {
    const res = await fetch(`${ACESTEP_API}/v1/models`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const models = data?.data?.models || data?.models || [];
    return models[0]?.name || null;
  } catch {
    return null;
  }
}

async function switchModelIfNeeded(ditModel: string): Promise<void> {
  const activeModel = await getActiveModel();
  if (activeModel === ditModel) return; // already loaded, no-op

  console.log(`[Model] Switching from '${activeModel ?? 'unknown'}' to '${ditModel}'`);
  const res = await fetch(`${ACESTEP_API}/v1/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ditModel, init_llm: false }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Model switch to '${ditModel}' failed: ${res.status} ${err}`);
  }
  console.log(`[Model] Switched to '${ditModel}'`);
}

// Discover endpoints (for compatibility)
export async function discoverEndpoints(): Promise<unknown> {
  return { provider: 'acestep-gradio', endpoint: ACESTEP_API };
}

// Reset client — forces Gradio reconnection on next request
export function resetClient(): void {
  resetGradioClient();
}

// ---------------------------------------------------------------------------
// Job queue
// ---------------------------------------------------------------------------

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (jobQueue.length > 0) {
    const jobId = jobQueue[0];
    const job = activeJobs.get(jobId);

    if (job && job.status === 'queued') {
      try {
        await processGeneration(jobId, job.params, job);
      } catch (error) {
        console.error(`Queue processing error for ${jobId}:`, error);
      }
    }

    // Remove from queue after processing (whether success or failure)
    jobQueue.shift();

    // Update queue positions for remaining jobs
    jobQueue.forEach((id, index) => {
      const queuedJob = activeJobs.get(id);
      if (queuedJob) {
        queuedJob.queuePosition = index + 1;
      }
    });
  }

  isProcessingQueue = false;
}

// Submit generation job to queue
export async function generateMusicViaAPI(params: GenerationParams): Promise<{ jobId: string }> {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const job: ActiveJob = {
    params,
    startTime: Date.now(),
    status: 'queued',
    queuePosition: jobQueue.length + 1,
  };

  activeJobs.set(jobId, job);
  jobQueue.push(jobId);

  console.log(`Job ${jobId}: Queued at position ${job.queuePosition}`);

  // Start processing the queue (will be a no-op if already processing)
  processQueue().catch(err => console.error('Queue processing error:', err));

  return { jobId };
}

async function processGenerationViaRest(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  if (params.ditModel) {
    job.stage = `Loading model ${params.ditModel}...`;
    await switchModelIfNeeded(params.ditModel);
  }

  const useAutoLyricsMode = shouldUseAutoLyricsMode(params);
  let useSampleMode = false;
  let fallbackSampleQuery = '';
  let preparedAutoLyrics: Awaited<ReturnType<typeof prepareAutoLyricsInputs>> | null = null;
  if (useAutoLyricsMode) {
    try {
      preparedAutoLyrics = await prepareAutoLyricsInputs(params);
    } catch (error) {
      if (!isMissingCreateSampleEndpoint(error)) {
        throw error;
      }
      console.warn('ACE-Step /v1/create_sample is unavailable; using release_task sample_mode fallback.');
      useSampleMode = true;
      fallbackSampleQuery = buildAutoLyricsSampleQuery(params);
    }
  }
  const prompt = preparedAutoLyrics?.prompt || buildPromptText(params);
  const lyrics = params.instrumental ? '[Instrumental]' : (preparedAutoLyrics?.lyrics || params.lyrics || '');

  const requestBody: Record<string, unknown> = {
    prompt: useSampleMode ? '' : prompt,
    lyrics,
    sample_mode: useSampleMode,
    sample_query: useSampleMode ? fallbackSampleQuery : undefined,
    duration: (params.duration && params.duration > 0 ? params.duration : undefined) || preparedAutoLyrics?.generatedDuration,
    bpm: (params.bpm && params.bpm > 0 ? params.bpm : undefined) || preparedAutoLyrics?.generatedBpm,
    key_scale: params.keyScale || preparedAutoLyrics?.generatedKeyScale || undefined,
    time_signature: params.timeSignature || preparedAutoLyrics?.generatedTimeSignature || undefined,
    vocal_language: preparedAutoLyrics?.generatedVocalLanguage || params.vocalLanguage || 'zh',
    inference_steps: params.inferenceSteps ?? 8,
    guidance_scale: params.guidanceScale ?? 7.0,
    batch_size: Math.min(Math.max(params.batchSize ?? 1, 1), 8),
    use_random_seed: params.randomSeed !== false,
    seed: params.seed ?? -1,
    audio_format: params.audioFormat || 'mp3',
    lm_temperature: params.lmTemperature ?? 0.8,
    lm_cfg_scale: params.lmCfgScale ?? 2.2,
    lm_top_k: params.lmTopK ?? 0,
    lm_top_p: params.lmTopP ?? 0.92,
    lm_negative_prompt: params.lmNegativePrompt || 'NO USER INPUT',
    thinking: params.thinking ?? false,
  };

  Object.keys(requestBody).forEach((key) => {
    if (requestBody[key] === undefined) delete requestBody[key];
  });

  job.stage = useAutoLyricsMode
    ? 'Generating lyrics and music via ACE-Step service...'
    : 'Generating music via ACE-Step service...';

  const releasePayload = await postAceStepJson<{
    data?: { task_id?: string };
    error?: string | null;
  }>('/release_task', requestBody);

  if (releasePayload.error) {
    throw new Error(releasePayload.error);
  }

  const taskId = releasePayload.data?.task_id;
  if (!taskId) {
    throw new Error('ACE-Step REST generation did not return a task id');
  }

  const queryPayload = await postAceStepJson<{
    data?: Array<{ task_id?: string; status?: number; result?: string }>;
    error?: string | null;
  }>('/query_result', { task_id_list: [taskId] });

  if (queryPayload.error) {
    throw new Error(queryPayload.error);
  }

  const taskResult = Array.isArray(queryPayload.data) ? queryPayload.data[0] : undefined;
  if (!taskResult || taskResult.status !== 1 || !taskResult.result) {
    throw new Error('ACE-Step did not return a completed generation result');
  }

  let resultItems: AceStepQueryResultItem[] = [];
  try {
    resultItems = JSON.parse(taskResult.result) as AceStepQueryResultItem[];
  } catch {
    throw new Error('ACE-Step returned an unreadable generation result payload');
  }

  if (!Array.isArray(resultItems) || resultItems.length === 0) {
    throw new Error('ACE-Step returned an empty generation result set');
  }

  const audioUrls: string[] = [];
  let actualDuration = 0;
  const audioFormat = params.audioFormat ?? 'mp3';

  for (const item of resultItems) {
    const source = buildQueryResultAudioUrl(item.file, item.url);
    const ext = source.includes('.flac') ? '.flac' : source.includes('.wav') ? '.wav' : `.${audioFormat}`;
    const filename = `${jobId}_${audioUrls.length}${ext}`;
    const destPath = path.join(AUDIO_DIR, filename);

    await mkdir(path.dirname(destPath), { recursive: true });
    const response = await getAudioStream(source);
    if (!response.ok) {
      throw new Error(`Failed to download ACE-Step audio result: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destPath, buffer);

    if (audioUrls.length === 0) {
      actualDuration = getAudioDuration(destPath);
    }

    audioUrls.push(`/audio/${filename}`);
  }

  const primary = resultItems[0];
  const primaryDuration = getResultDuration(primary);
  const generatedCaption = getResultPrompt(primary);
  const generatedLyrics = getResultLyrics(primary) || preparedAutoLyrics?.lyrics || '';
  if (useAutoLyricsMode && wantsChineseLyrics(params)) {
    validateChineseLyrics(generatedLyrics, 'ACE-Step generation result');
  }
  const finalDuration = actualDuration > 0
    ? actualDuration
    : (
      (primaryDuration && primaryDuration > 0 ? Math.round(primaryDuration) : 0) ||
      (params.duration || 0)
    );

  job.status = 'succeeded';
  job.result = {
    audioUrls,
    duration: finalDuration,
    bpm: getResultBpm(primary) || params.bpm,
    keyScale: getResultKeyScale(primary) || params.keyScale,
    timeSignature: getResultTimeSignature(primary) || params.timeSignature,
    caption: generatedCaption || preparedAutoLyrics?.generatedCaption || buildPromptText(params),
    lyrics: generatedLyrics || lyrics,
    vocalLanguage: preparedAutoLyrics?.generatedVocalLanguage || primary?.vocal_language || primary?.metas?.vocal_language || params.vocalLanguage,
    status: 'succeeded',
  };
  job.rawResponse = {
    releasePayload,
    queryPayload,
    mode: useAutoLyricsMode ? 'auto_lyrics_rest' : 'rest',
    sampleQuery: preparedAutoLyrics?.sampleQuery || fallbackSampleQuery || undefined,
  };
  console.log(`Job ${jobId}: Completed via ACE-Step REST with ${audioUrls.length} audio files`);
}

// ---------------------------------------------------------------------------
// processGeneration — Gradio primary, Python spawn fallback
// ---------------------------------------------------------------------------

async function processGeneration(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  job.status = 'running';
  job.stage = 'Starting generation...';

  // Guard: cover/audio2audio requires a source or audio codes
  if ((params.taskType === 'cover' || params.taskType === 'audio2audio') && !params.sourceAudioUrl && !params.audioCodes) {
    job.status = 'failed';
    job.error = `task_type='${params.taskType}' requires a source audio or audio codes`;
    return;
  }

  if (shouldUseRestGeneration(params)) {
    try {
      await processGenerationViaRest(jobId, params, job);
      return;
    } catch (error) {
      if (shouldUseAutoLyricsMode(params) && wantsChineseLyrics(params)) {
        console.error(`Job ${jobId}: Chinese auto-lyrics generation failed`, error);
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Chinese auto-lyrics generation failed';
        return;
      }
      console.error(`Job ${jobId}: ACE-Step REST generation failed, falling back to Gradio/Python`, error);
    }
  }

  // Try Gradio first
  const gradioUp = await isGradioAvailable();
  if (gradioUp) {
    try {
      await processGenerationViaGradio(jobId, params, job);
      return;
    } catch (error) {
      console.error(`Job ${jobId}: Gradio generation failed, trying Python spawn fallback`, error);
      // Fall through to Python spawn
    }
  }

  // Fallback: Python spawn
  await processGenerationViaPython(jobId, params, job);
}

async function processGenerationViaGradio(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  // Switch DiT model if a specific one was requested
  if (params.ditModel) {
    job.stage = `Loading model ${params.ditModel}...`;
    await switchModelIfNeeded(params.ditModel);
  }

  const client = await getGradioClient();
  const args = await buildGradioArgs(params);

  const prompt = buildPromptText(params);

  console.log(`Job ${jobId}: Using Gradio /generation_wrapper`, {
    prompt: prompt.slice(0, 50),
    duration: params.duration,
    batchSize: params.batchSize,
  });

  job.stage = 'Generating music via Gradio...';

  // predict() blocks until generation is complete
  const result = await client.predict('/generation_wrapper', args);
  const data = result.data as unknown[];

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Gradio returned unexpected data format: ${typeof data}`);
  }

  // Extract audio files from the result
  // Outputs 0-7: individual audio samples (filepath objects)
  // Output 8: "All Generated Files" as list[filepath]
  // Output 9: "Generation Details" (string)
  // Output 10: "Generation Status" (string)
  // Output 11: "Seed" (string)
  const allFiles = data[8]; // list of file objects
  const genDetails = data[9] as string | undefined;
  const genStatus = data[10] as string | undefined;

  // Collect audio file objects — prefer the "All Generated Files" list
  let audioFileObjects: Array<{ url?: string; path?: string; orig_name?: string }> = [];

  if (Array.isArray(allFiles) && allFiles.length > 0) {
    audioFileObjects = allFiles.filter(
      (f: any) => f && (f.path || f.url) && isAudioFile(f.orig_name || f.path || '')
    );
  }

  // Fallback: check individual sample outputs (indices 0-7)
  if (audioFileObjects.length === 0) {
    for (let i = 0; i < 8; i++) {
      const fileObj = data[i] as any;
      if (fileObj && (fileObj.path || fileObj.url)) {
        audioFileObjects.push(fileObj);
      }
    }
  }

  if (audioFileObjects.length === 0) {
    throw new Error(`Gradio generation returned no audio files. Status: ${genStatus || 'unknown'}. Details: ${genDetails || 'none'}`);
  }

  // Download audio files to local storage
  const audioUrls: string[] = [];
  let actualDuration = 0;
  const audioFormat = params.audioFormat ?? 'mp3';

  for (const fileObj of audioFileObjects) {
    const origName = fileObj.orig_name || fileObj.path || '';
    const ext = origName.includes('.flac') ? '.flac' : `.${audioFormat}`;
    const filename = `${jobId}_${audioUrls.length}${ext}`;
    const destPath = path.join(AUDIO_DIR, filename);

    await downloadGradioAudioFile(fileObj, destPath);

    if (audioUrls.length === 0) {
      actualDuration = getAudioDuration(destPath);
    }

    audioUrls.push(`/audio/${filename}`);
  }

  // Parse metadata from generation details if available
  const metas = parseGenerationDetails(genDetails);

  const finalDuration = actualDuration > 0
    ? actualDuration
    : (metas.duration || params.duration || 0);

  job.status = 'succeeded';
  job.result = {
    audioUrls,
    duration: finalDuration,
    bpm: metas.bpm || params.bpm,
    keyScale: metas.keyScale || params.keyScale,
    timeSignature: metas.timeSignature || params.timeSignature,
    caption: prompt,
    lyrics: params.instrumental ? '[Instrumental]' : (params.lyrics || ''),
    vocalLanguage: params.vocalLanguage,
    status: 'succeeded',
  };
  job.rawResponse = { genDetails, genStatus };
  console.log(`Job ${jobId}: Completed via Gradio with ${audioUrls.length} audio files`);
}

function isAudioFile(name: string): boolean {
  return /\.(mp3|flac|wav|ogg|m4a)$/i.test(name);
}

function parseGenerationDetails(details: string | undefined): {
  bpm?: number;
  duration?: number;
  keyScale?: string;
  timeSignature?: string;
} {
  if (!details) return {};
  try {
    // Generation details may contain key-value pairs
    const bpmMatch = details.match(/BPM:\s*(\d+)/i);
    const durationMatch = details.match(/Duration:\s*([\d.]+)/i);
    const keyMatch = details.match(/Key:\s*([A-G][#b]?\s*(?:major|minor))/i);
    const timeMatch = details.match(/Time Signature:\s*(\d+\/\d+)/i);
    return {
      bpm: bpmMatch ? parseInt(bpmMatch[1]) : undefined,
      duration: durationMatch ? parseFloat(durationMatch[1]) : undefined,
      keyScale: keyMatch ? keyMatch[1] : undefined,
      timeSignature: timeMatch ? timeMatch[1] : undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Python spawn fallback (kept from original for offline/fallback use)
// ---------------------------------------------------------------------------

async function processGenerationViaPython(
  jobId: string,
  params: GenerationParams,
  job: ActiveJob,
): Promise<void> {
  const prompt = buildPromptText(params);
  const autoLyricsQuery = shouldUseAutoLyricsMode(params) ? buildAutoLyricsSampleQuery(params) : '';
  const lyrics = params.instrumental ? '' : (params.lyrics || '');

  console.log(`Job ${jobId}: Using Python spawn (Gradio not available)`, {
    prompt: prompt.slice(0, 50),
    lyricsPreview: lyrics.slice(0, 50),
    duration: params.duration,
    batchSize: params.batchSize,
  });

  try {
    const jobOutputDir = path.join(ACESTEP_DIR, 'output', jobId);
    await mkdir(jobOutputDir, { recursive: true });

    const durationToSend = params.duration && params.duration > 0 ? params.duration : 60;
    const args = [
      '--prompt', prompt,
      '--duration', String(durationToSend),
      '--batch-size', String(params.batchSize ?? 1),
      '--infer-steps', String(params.inferenceSteps ?? 8),
      '--guidance-scale', String(params.guidanceScale ?? 10.0),
      '--audio-format', params.audioFormat ?? 'mp3',
      '--output-dir', jobOutputDir,
      '--json',
    ];

    if (lyrics) args.push('--lyrics', lyrics);
    if (params.instrumental) args.push('--instrumental');
    if (params.bpm && params.bpm > 0) args.push('--bpm', String(params.bpm));
    if (params.keyScale) args.push('--key-scale', params.keyScale);
    if (params.timeSignature) args.push('--time-signature', params.timeSignature);
    if (params.vocalLanguage) args.push('--vocal-language', params.vocalLanguage);
    if (params.seed !== undefined && params.seed >= 0 && !params.randomSeed) args.push('--seed', String(params.seed));
    if (params.shift !== undefined) args.push('--shift', String(params.shift));
    const resolvedTaskType = params.taskType === 'audio2audio' ? 'cover' : params.taskType;
    if (resolvedTaskType && resolvedTaskType !== 'text2music') args.push('--task-type', resolvedTaskType);

    if (params.referenceAudioUrl) {
      args.push('--reference-audio', resolveAudioPath(params.referenceAudioUrl));
    }
    if (params.sourceAudioUrl) {
      args.push('--src-audio', resolveAudioPath(params.sourceAudioUrl));
    }
    if (params.audioCodes) args.push('--audio-codes', params.audioCodes);
    if (params.repaintingStart !== undefined && params.repaintingStart > 0) args.push('--repainting-start', String(params.repaintingStart));
    if (params.repaintingEnd !== undefined && params.repaintingEnd > 0) args.push('--repainting-end', String(params.repaintingEnd));
    if (params.taskType === 'cover' || params.taskType === 'repaint' || params.sourceAudioUrl) {
      args.push('--audio-cover-strength', String(params.audioCoverStrength ?? 1.0));
    } else if (params.audioCoverStrength !== undefined && params.audioCoverStrength !== 1.0) {
      args.push('--audio-cover-strength', String(params.audioCoverStrength));
    }
    if (params.instruction) args.push('--instruction', params.instruction);
    if (params.thinking) args.push('--thinking');
    if (params.lmTemperature !== undefined) args.push('--lm-temperature', String(params.lmTemperature));
    if (params.lmCfgScale !== undefined) args.push('--lm-cfg-scale', String(params.lmCfgScale));
    if (params.lmTopK !== undefined && params.lmTopK > 0) args.push('--lm-top-k', String(params.lmTopK));
    if (params.lmTopP !== undefined) args.push('--lm-top-p', String(params.lmTopP));
    if (params.lmNegativePrompt) args.push('--lm-negative-prompt', params.lmNegativePrompt);
    let sampleQueryFile = '';
    if (autoLyricsQuery) {
      sampleQueryFile = path.join(jobOutputDir, '_sample_query.json');
      await writeFile(sampleQueryFile, JSON.stringify({ sample_query: autoLyricsQuery }), 'utf-8');
      args.push('--sample-query-file', sampleQueryFile);
    }
    if (params.lmBackend) args.push('--lm-backend', params.lmBackend);
    if (params.lmModel) args.push('--lm-model-path', params.lmModel);
    if (params.useCotMetas === false) args.push('--no-cot-metas');
    if (params.useCotCaption === false) args.push('--no-cot-caption');
    if (params.useCotLanguage === false) args.push('--no-cot-language');
    if (params.useAdg) args.push('--use-adg');
    if (params.cfgIntervalStart !== undefined && params.cfgIntervalStart > 0) args.push('--cfg-interval-start', String(params.cfgIntervalStart));
    if (params.cfgIntervalEnd !== undefined && params.cfgIntervalEnd < 1.0) args.push('--cfg-interval-end', String(params.cfgIntervalEnd));

    const result = await runPythonGeneration(args);

    if (!result.success) {
      throw new Error(result.error || 'Generation failed');
    }

    if (!result.audio_paths || result.audio_paths.length === 0) {
      throw new Error('No audio files generated');
    }

    const audioUrls: string[] = [];
    let actualDuration = 0;
    for (const srcPath of result.audio_paths) {
      const ext = srcPath.includes('.flac') ? '.flac' : '.mp3';
      const filename = `${jobId}_${audioUrls.length}${ext}`;
      const destPath = path.join(AUDIO_DIR, filename);

      await mkdir(AUDIO_DIR, { recursive: true });
      await copyFile(srcPath, destPath);

      if (audioUrls.length === 0) {
        actualDuration = getAudioDuration(destPath);
      }

      audioUrls.push(`/audio/${filename}`);
    }

    try {
      await rm(jobOutputDir, { recursive: true, force: true });
    } catch (cleanupError) {
      console.warn(`Job ${jobId}: Failed to cleanup output dir`, cleanupError);
    }

    const finalDuration = actualDuration > 0
      ? actualDuration
      : (
        (result.duration && result.duration > 0 ? result.duration : 0) ||
        (params.duration && params.duration > 0 ? params.duration : 0)
      );

    job.status = 'succeeded';
    job.result = {
      audioUrls,
      duration: finalDuration,
      bpm: result.bpm || params.bpm,
      keyScale: result.key_scale || params.keyScale,
      timeSignature: result.time_signature || params.timeSignature,
      caption: result.caption || prompt,
      lyrics: params.instrumental ? '[Instrumental]' : (result.lyrics || params.lyrics || ''),
      vocalLanguage: result.vocal_language || params.vocalLanguage,
      status: 'succeeded',
    };
    job.rawResponse = result;
    console.log(`Job ${jobId}: Completed via Python in ${result.elapsed_seconds?.toFixed(1)}s with ${audioUrls.length} audio files`);

  } catch (error) {
    console.error(`Job ${jobId}: Generation failed`, error);
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : 'Generation failed';

    try {
      const jobOutputDir = path.join(ACESTEP_DIR, 'output', jobId);
      await rm(jobOutputDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

interface PythonResult {
  success: boolean;
  audio_paths?: string[];
  elapsed_seconds?: number;
  caption?: string;
  lyrics?: string;
  duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  vocal_language?: string;
  error?: string;
}

function runPythonGeneration(scriptArgs: string[], timeoutMs = 600000): Promise<PythonResult> {
  return new Promise((resolve) => {
    const pythonPath = resolvePythonPath(ACESTEP_DIR);
    const args = [PYTHON_SCRIPT, ...scriptArgs];

    const proc = spawn(pythonPath, args, {
      cwd: ACESTEP_DIR,
      env: {
        ...process.env,
        ACESTEP_PATH: ACESTEP_DIR,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    // Kill process after timeout (default 10 minutes)
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
      resolve({ success: false, error: `Generation timed out after ${timeoutMs / 1000}s` });
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`[ACE-Step] ${line}`);
        }
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ success: false, error: stderr || `Process exited with code ${code}` });
        return;
      }

      const lines = stdout.split('\n').filter(l => l.trim());
      const jsonLine = lines.find(l => l.startsWith('{'));

      if (!jsonLine) {
        resolve({ success: false, error: 'No JSON output from generation script' });
        return;
      }

      try {
        const result = JSON.parse(jsonLine);
        resolve(result);
      } catch {
        resolve({ success: false, error: 'Invalid JSON from generation script' });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Job status (simplified — no more REST polling for progress)
// ---------------------------------------------------------------------------

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  const job = activeJobs.get(jobId);

  if (!job) {
    return {
      status: 'failed',
      error: 'Job not found',
    };
  }

  if (job.status === 'succeeded' && job.result) {
    return {
      status: 'succeeded',
      result: job.result,
    };
  }

  if (job.status === 'failed') {
    return {
      status: 'failed',
      error: job.error || 'Generation failed',
    };
  }

  const elapsed = Math.floor((Date.now() - job.startTime) / 1000);

  if (job.status === 'queued') {
    return {
      status: job.status,
      queuePosition: job.queuePosition,
      etaSeconds: (job.queuePosition || 1) * 180,
    };
  }

  // Running — Gradio handles its own queue, we just report estimated time
  return {
    status: job.status,
    etaSeconds: Math.max(0, 180 - elapsed),
    progress: job.progress,
    stage: job.stage,
  };
}

// Get raw response for debugging
export function getJobRawResponse(jobId: string): unknown | null {
  const job = activeJobs.get(jobId);
  return job?.rawResponse || null;
}

// ---------------------------------------------------------------------------
// Audio helpers (unchanged)
// ---------------------------------------------------------------------------

export async function getAudioStream(audioPath: string): Promise<Response> {
  if (audioPath.startsWith('http')) {
    return fetch(audioPath);
  }

  if (audioPath.startsWith('/audio/')) {
    const localPath = path.join(AUDIO_DIR, audioPath.replace('/audio/', ''));
    try {
      const buffer = await readFile(localPath);
      const ext = localPath.endsWith('.flac') ? 'flac' : 'mpeg';
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': `audio/${ext}` }
      });
    } catch (err) {
      console.error('Failed to read local audio file:', localPath, err);
      return new Response(null, { status: 404 });
    }
  }

  // Absolute path — try reading directly from disk (Gradio output files)
  if (audioPath.startsWith('/')) {
    try {
      const buffer = await readFile(audioPath);
      const ext = audioPath.endsWith('.flac') ? 'flac' : audioPath.endsWith('.wav') ? 'wav' : 'mpeg';
      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': `audio/${ext}` }
      });
    } catch {
      // Fall through to Gradio API
    }
  }

  const url = `${ACESTEP_API}/v1/audio?path=${encodeURIComponent(audioPath)}`;
  console.log('Fetching audio from:', url);
  return fetch(url);
}

export async function downloadAudio(remoteUrl: string, songId: string): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });

  const response = await getAudioStream(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const ext = remoteUrl.includes('.flac') ? '.flac' : '.mp3';
  const filename = `${songId}${ext}`;
  const filepath = path.join(AUDIO_DIR, filename);

  await writeFile(filepath, Buffer.from(buffer));
  console.log(`Downloaded audio to ${filepath}`);

  return `/audio/${filename}`;
}

export async function downloadAudioToBuffer(remoteUrl: string): Promise<{ buffer: Buffer; size: number }> {
  const response = await getAudioStream(remoteUrl);
  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  return { buffer, size: buffer.length };
}

export function cleanupJob(jobId: string): void {
  activeJobs.delete(jobId);
}

export function cleanupOldJobs(maxAgeMs: number = 3600000): void {
  const now = Date.now();
  for (const [jobId, job] of activeJobs) {
    if (now - job.startTime > maxAgeMs) {
      activeJobs.delete(jobId);
    }
  }
}

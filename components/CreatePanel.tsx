import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Sparkles, Upload, UserRound } from 'lucide-react';
import { getSingerGenderLabel } from '../constants/genders';
import { LANGUAGE_OPTIONS } from '../constants/languages';
import { MAIN_STYLES } from '../data/genres';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../context/I18nContext';
import { generateApi } from '../services/api';
import { GenerationParams, Song, VirtualSinger } from '../types';

interface CreatePanelProps {
  onGenerate: (params: GenerationParams) => void;
  isGenerating: boolean;
  initialData?: { song: Song; timestamp: number } | null;
  createdSongs?: Song[];
  pendingAudioSelection?: { target: 'reference' | 'source'; url: string; title?: string } | null;
  onAudioSelectionApplied?: () => void;
  singers: VirtualSinger[];
  onNavigateToManagement: () => void;
}

const inputClassName =
  'vs-accent-focus w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition dark:border-white/10 dark:bg-black/20 dark:text-white';

function inferCustomMode(input: {
  lyrics: string;
  title: string;
  referenceAudioUrl: string;
  sourceAudioUrl: string;
  taskType: string;
}) {
  return Boolean(
    input.lyrics.trim() ||
      input.title.trim() ||
      input.referenceAudioUrl.trim() ||
      input.sourceAudioUrl.trim() ||
      input.taskType !== 'text2music',
  );
}

export const CreatePanel: React.FC<CreatePanelProps> = ({
  onGenerate,
  isGenerating,
  initialData,
  pendingAudioSelection,
  onAudioSelectionApplied,
  singers,
  onNavigateToManagement,
}) => {
  const { token, isAuthenticated } = useAuth();
  const { t } = useI18n();

  const [songDescription, setSongDescription] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [vocalLanguage, setVocalLanguage] = useState('zh');
  const [selectedSingerId, setSelectedSingerId] = useState('');
  const [duration, setDuration] = useState(60);
  const [bpm, setBpm] = useState(0);
  const [keyScale, setKeyScale] = useState('');
  const [timeSignature, setTimeSignature] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [referenceAudioUrl, setReferenceAudioUrl] = useState('');
  const [referenceAudioTitle, setReferenceAudioTitle] = useState('');
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [sourceAudioTitle, setSourceAudioTitle] = useState('');
  const [taskType, setTaskType] = useState('text2music');
  const [inferenceSteps, setInferenceSteps] = useState(8);
  const [guidanceScale, setGuidanceScale] = useState(7);
  const [batchSize, setBatchSize] = useState(1);
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'flac'>('mp3');
  const [inferMethod, setInferMethod] = useState<'ode' | 'sde'>('ode');
  const [shift, setShift] = useState(3);
  const [thinking, setThinking] = useState(false);
  const [randomSeed, setRandomSeed] = useState(true);
  const [seed, setSeed] = useState(-1);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('ace-model') || 'acestep-v15-turbo-shift3',
  );
  const [error, setError] = useState('');
  const [uploadingTarget, setUploadingTarget] = useState<'reference' | 'source' | null>(null);

  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);

  const styleSuggestions = useMemo(
    () => [...MAIN_STYLES].sort(() => Math.random() - 0.5).slice(0, 8),
    [showAdvanced],
  );
  const selectedSinger = singers.find((singer) => singer.id === selectedSingerId) || null;

  useEffect(() => {
    localStorage.setItem('ace-model', selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    if (!pendingAudioSelection) return;

    if (pendingAudioSelection.target === 'reference') {
      setReferenceAudioUrl(pendingAudioSelection.url);
      setReferenceAudioTitle(pendingAudioSelection.title || '');
    } else {
      setSourceAudioUrl(pendingAudioSelection.url);
      setSourceAudioTitle(pendingAudioSelection.title || '');
      setTaskType('cover');
      setShowAdvanced(true);
    }

    onAudioSelectionApplied?.();
  }, [pendingAudioSelection, onAudioSelectionApplied]);

  useEffect(() => {
    const params = initialData?.song?.generationParams;
    if (!params) return;

    setSongDescription(params.songDescription || '');
    setStyle(params.style || '');
    setTitle(params.title || '');
    setLyrics(params.lyrics || '');
    setInstrumental(Boolean(params.instrumental));
    setVocalLanguage(params.vocalLanguage || 'zh');
    setSelectedSingerId(params.instrumental ? '' : params.singerId || '');
    setDuration(params.duration || 60);
    setBpm(params.bpm || 0);
    setKeyScale(params.keyScale || '');
    setTimeSignature(params.timeSignature || '');
    setReferenceAudioUrl(params.referenceAudioUrl || '');
    setReferenceAudioTitle(params.referenceAudioTitle || '');
    setSourceAudioUrl(params.sourceAudioUrl || '');
    setSourceAudioTitle(params.sourceAudioTitle || '');
    setTaskType(params.taskType || 'text2music');
    setShowAdvanced(
      inferCustomMode({
        lyrics: params.lyrics || '',
        title: params.title || '',
        referenceAudioUrl: params.referenceAudioUrl || '',
        sourceAudioUrl: params.sourceAudioUrl || '',
        taskType: params.taskType || 'text2music',
      }),
    );
  }, [initialData?.timestamp]);

  useEffect(() => {
    if (instrumental) {
      setSelectedSingerId('');
    }
  }, [instrumental]);

  const addStyleTag = (tag: string) => {
    setStyle((prev) => (prev ? `${prev}, ${tag}` : tag));
  };

  const uploadAudio = async (file: File, target: 'reference' | 'source') => {
    if (!token) {
      setError(t('loginToGenerate'));
      return;
    }

    setUploadingTarget(target);
    setError('');

    try {
      const result = await generateApi.uploadAudio(file, token);
      const titleFromName = file.name.replace(/\.[^.]+$/, '');

      if (target === 'reference') {
        setReferenceAudioUrl(result.url);
        setReferenceAudioTitle(titleFromName);
      } else {
        setSourceAudioUrl(result.url);
        setSourceAudioTitle(titleFromName);
        setTaskType('cover');
        setShowAdvanced(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '音频上传失败');
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleGenerate = () => {
    setError('');

    const hasCreativeInput = Boolean(
      songDescription.trim() ||
        style.trim() ||
        lyrics.trim() ||
        title.trim() ||
        referenceAudioUrl.trim() ||
        sourceAudioUrl.trim(),
    );

    if (!hasCreativeInput) {
      setError('请先填写歌曲描述、风格、歌词、标题，或上传参考音频。');
      return;
    }

    if (!instrumental && !selectedSingerId) {
      setError('生成人声前请先选择一位已绑定音色的虚拟歌手。');
      return;
    }

    if (!instrumental && selectedSinger && !selectedSinger.hasVoiceBinding) {
      setError('当前歌手尚未绑定音色，请先在管理或训练页完成绑定。');
      return;
    }

    onGenerate({
      customMode: inferCustomMode({ lyrics, title, referenceAudioUrl, sourceAudioUrl, taskType }),
      songDescription: songDescription.trim(),
      prompt: songDescription.trim(),
      lyrics: lyrics.trim(),
      style: style.trim(),
      title: title.trim(),
      instrumental,
      vocalLanguage,
      bpm,
      keyScale,
      timeSignature,
      duration,
      inferenceSteps,
      guidanceScale,
      batchSize,
      randomSeed,
      seed,
      thinking,
      enhance: false,
      audioFormat,
      inferMethod,
      shift,
      lmTemperature: 0.8,
      lmCfgScale: 2.2,
      lmTopK: 0,
      lmTopP: 0.92,
      lmNegativePrompt: 'NO USER INPUT',
      lmBackend: 'pt',
      taskType,
      referenceAudioUrl: referenceAudioUrl || undefined,
      sourceAudioUrl: sourceAudioUrl || undefined,
      referenceAudioTitle: referenceAudioTitle || undefined,
      sourceAudioTitle: sourceAudioTitle || undefined,
      cfgIntervalStart: 0,
      cfgIntervalEnd: 1,
      useCotMetas: true,
      useCotCaption: true,
      useCotLanguage: true,
      allowLmBatch: true,
      scoreScale: 0.5,
      lmBatchChunkSize: 8,
      completeTrackClasses: [],
      ditModel: selectedModel,
      singerId: instrumental ? null : selectedSingerId || null,
    });
  };

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-suno-panel">
      <div className="flex-1 overflow-y-auto p-5">
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">创作</h2>
          </div>

          <section className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <label className="mb-2 block text-sm font-semibold text-zinc-700 dark:text-zinc-200">
              歌曲描述
            </label>
            <textarea
              value={songDescription}
              onChange={(event) => setSongDescription(event.target.value)}
              className="vs-accent-focus min-h-[112px] w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition dark:border-white/10 dark:bg-black/20 dark:text-white"
              placeholder="例如：温柔女声、带一点梦幻电子感、适合夜晚通勤聆听。"
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  风格标签
                </span>
                <input
                  value={style}
                  onChange={(event) => setStyle(event.target.value)}
                  className={inputClassName}
                  placeholder="如：流行、电子、抒情"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  演唱语言
                </span>
                <select
                  value={vocalLanguage}
                  onChange={(event) => setVocalLanguage(event.target.value)}
                  className={inputClassName}
                >
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {styleSuggestions.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addStyleTag(tag)}
                  className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-200 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15"
                >
                  {tag}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">虚拟歌手</h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  选择人声模式时，需要指定一位已经绑定音色的歌手。
                </p>
              </div>
              <button
                type="button"
                onClick={onNavigateToManagement}
                className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                去管理页
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setInstrumental(false)}
                className={`rounded-full px-3 py-2 text-sm transition ${
                  !instrumental
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15'
                }`}
              >
                人声
              </button>
              <button
                type="button"
                onClick={() => setInstrumental(true)}
                className={`rounded-full px-3 py-2 text-sm transition ${
                  instrumental
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/15'
                }`}
              >
                纯音乐
              </button>
            </div>

            {!instrumental && (
              <div className="vs-accent-soft vs-accent-border mt-3 rounded-2xl border px-4 py-3 text-xs">
                未填写歌词时，会根据歌曲描述自动生成歌词，再套用当前虚拟歌手的音色。
              </div>
            )}

            <div className="mt-3 grid gap-3">
              {singers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                  还没有可用歌手，请先到管理页创建并绑定音色。
                </div>
              ) : (
                singers.map((singer) => {
                  const disabled = instrumental || !singer.hasVoiceBinding;
                  const active = singer.id === selectedSingerId;
                  return (
                    <button
                      key={singer.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => setSelectedSingerId((prev) => (prev === singer.id ? '' : singer.id))}
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? 'vs-accent-border vs-accent-soft border'
                          : 'border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-black/20'
                      } ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-[rgba(84,131,179,0.45)]'}`}
                    >
                      <div className="vs-gradient-icon flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl text-white">
                        {singer.avatarUrl ? (
                          <img
                            src={singer.avatarUrl}
                            alt={singer.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <UserRound size={18} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-zinc-900 dark:text-white">{singer.name}</div>
                        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {[singer.styleTags.join(' / ') || '未设置风格标签', singer.gender !== 'unspecified' ? getSingerGenderLabel(singer.gender) : '']
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          singer.hasVoiceBinding
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'bg-zinc-200 text-zinc-600 dark:bg-white/10 dark:text-zinc-300'
                        }`}
                      >
                        {singer.hasVoiceBinding ? '已绑定音色' : '未绑定音色'}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  目标时长（秒）
                </span>
                <input
                  type="number"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value) || 60)}
                  className={inputClassName}
                  placeholder="例如 60"
                />
                <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
                  默认值 60，表示期望生成约 60 秒的歌曲。
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">BPM</span>
                <input
                  type="number"
                  value={bpm}
                  onChange={(event) => setBpm(Number(event.target.value) || 0)}
                  className={inputClassName}
                  placeholder="0 表示自动"
                />
                <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
                  默认值 0，表示让模型自动推断节奏速度。
                </span>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  调式 / 音阶
                </span>
                <input
                  value={keyScale}
                  onChange={(event) => setKeyScale(event.target.value)}
                  className={inputClassName}
                  placeholder="留空则自动，例如 C major"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">拍号</span>
                <input
                  value={timeSignature}
                  onChange={(event) => setTimeSignature(event.target.value)}
                  className={inputClassName}
                  placeholder="例如 4/4"
                />
              </label>
            </div>
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="flex w-full items-center justify-between"
            >
              <div className="text-left">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white">高级控制</h3>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  包含歌词、标题、参考音频、任务类型和推理参数。
                </p>
              </div>
              {showAdvanced ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">标题</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={inputClassName}
                    placeholder="留空则自动生成标题"
                  />
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">歌词</span>
                  <textarea
                    value={lyrics}
                    onChange={(event) => setLyrics(event.target.value)}
                    className="vs-accent-focus min-h-[140px] w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm outline-none transition dark:border-white/10 dark:bg-black/20 dark:text-white"
                    placeholder="留空时会根据歌曲描述自动生成歌词"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-black/20">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">参考音频</span>
                      <button
                        type="button"
                        onClick={() => referenceInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                      >
                        {uploadingTarget === 'reference' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Upload size={14} />
                        )}
                        上传
                      </button>
                    </div>
                    <input
                      ref={referenceInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadAudio(file, 'reference');
                        event.target.value = '';
                      }}
                    />
                    <div className="mt-3 break-all rounded-2xl bg-white px-3 py-3 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                      {referenceAudioTitle || referenceAudioUrl || '可从音乐库带入，也可手动上传。'}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-white/10 dark:bg-black/20">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-white">源音频</span>
                      <button
                        type="button"
                        onClick={() => sourceInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                      >
                        {uploadingTarget === 'source' ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Upload size={14} />
                        )}
                        上传
                      </button>
                    </div>
                    <input
                      ref={sourceInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void uploadAudio(file, 'source');
                        event.target.value = '';
                      }}
                    />
                    <div className="mt-3 break-all rounded-2xl bg-white px-3 py-3 text-xs text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
                      {sourceAudioTitle || sourceAudioUrl || '用于 cover、audio2audio、局部重绘等流程。'}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      任务类型
                    </span>
                    <select
                      value={taskType}
                      onChange={(event) => setTaskType(event.target.value)}
                      className={inputClassName}
                    >
                      <option value="text2music">文本生曲</option>
                      <option value="cover">翻唱</option>
                      <option value="audio2audio">音频转音频</option>
                      <option value="repaint">局部重绘</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      模型名称
                    </span>
                    <input
                      value={selectedModel}
                      onChange={(event) => setSelectedModel(event.target.value)}
                      className={inputClassName}
                      placeholder="例如 acestep-v15-turbo-shift3"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      推理步数
                    </span>
                    <input
                      type="number"
                      value={inferenceSteps}
                      onChange={(event) => setInferenceSteps(Number(event.target.value) || 8)}
                      className={inputClassName}
                      placeholder="默认 8"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      引导强度
                    </span>
                    <input
                      type="number"
                      step="0.1"
                      value={guidanceScale}
                      onChange={(event) => setGuidanceScale(Number(event.target.value) || 7)}
                      className={inputClassName}
                      placeholder="默认 7"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      批量数
                    </span>
                    <input
                      type="number"
                      min={1}
                      value={batchSize}
                      onChange={(event) => setBatchSize(Number(event.target.value) || 1)}
                      className={inputClassName}
                      placeholder="默认 1"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Shift</span>
                    <input
                      type="number"
                      step="0.1"
                      value={shift}
                      onChange={(event) => setShift(Number(event.target.value) || 3)}
                      className={inputClassName}
                      placeholder="默认 3"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      推理方法
                    </span>
                    <select
                      value={inferMethod}
                      onChange={(event) => setInferMethod(event.target.value as 'ode' | 'sde')}
                      className={inputClassName}
                    >
                      <option value="ode">ode</option>
                      <option value="sde">sde</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      音频格式
                    </span>
                    <select
                      value={audioFormat}
                      onChange={(event) => setAudioFormat(event.target.value as 'mp3' | 'flac')}
                      className={inputClassName}
                    >
                      <option value="mp3">mp3</option>
                      <option value="flac">flac</option>
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={thinking}
                      onChange={(event) => setThinking(event.target.checked)}
                    />
                    启用思考模式
                  </label>
                  <label className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-white/10 dark:bg-black/20 dark:text-zinc-200">
                    <input
                      type="checkbox"
                      checked={randomSeed}
                      onChange={(event) => setRandomSeed(event.target.checked)}
                    />
                    使用随机种子
                  </label>
                </div>

                {!randomSeed && (
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      固定种子
                    </span>
                    <input
                      type="number"
                      value={seed}
                      onChange={(event) => setSeed(Number(event.target.value) || 0)}
                      className={inputClassName}
                      placeholder="输入固定种子，便于复现结果"
                    />
                  </label>
                )}
              </div>
            )}
          </section>

          {error && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
              {error}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-zinc-200 bg-white/95 px-5 py-4 dark:border-white/10 dark:bg-suno-panel/95">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || !isAuthenticated}
          className="vs-gradient-button inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isGenerating ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
          {isGenerating ? t('generating') : '开始创作'}
        </button>
      </div>
    </div>
  );
};

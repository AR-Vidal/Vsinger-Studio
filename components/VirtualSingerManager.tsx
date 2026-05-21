import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Link2, Loader2, Pencil, Plus, Sparkles, Trash2, Upload, UserRound } from 'lucide-react';
import { getLanguageLabel, LANGUAGE_OPTIONS } from '../constants/languages';
import { getSingerGenderLabel, SINGER_GENDER_OPTIONS } from '../constants/genders';
import { VirtualSinger } from '../types';
import { singersApi, trainingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface PendingVoiceBinding {
  adapterPath: string;
  exportPath?: string;
  outputDir?: string;
  datasetName?: string;
  trainingMeta?: Record<string, unknown>;
}

interface VirtualSingerManagerProps {
  singers: VirtualSinger[];
  onSingersChange: (singers: VirtualSinger[]) => void;
  onNavigateToTraining: () => void;
}

const EMPTY_FORM = {
  name: '',
  styleTags: '',
  defaultLanguage: 'zh',
  gender: 'unspecified',
  personaPrompt: '',
  notes: '',
  avatarUrl: '',
};

const inputClassName =
  'vs-accent-focus w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition dark:border-white/10 dark:bg-white/5 dark:text-white';

const singerTableGridClass =
  'grid-cols-[84px_minmax(150px,1fr)_minmax(180px,1.15fr)_112px_72px_96px_136px]';

function readPendingBinding(): PendingVoiceBinding | null {
  try {
    const raw = sessionStorage.getItem('pendingVoiceBinding');
    if (!raw) return null;
    return JSON.parse(raw) as PendingVoiceBinding;
  } catch {
    return null;
  }
}

export const VirtualSingerManager: React.FC<VirtualSingerManagerProps> = ({
  singers,
  onSingersChange,
  onNavigateToTraining,
}) => {
  const { token } = useAuth();

  const [editingSingerId, setEditingSingerId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingBinding, setPendingBinding] = useState<PendingVoiceBinding | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPendingBinding(readPendingBinding());
  }, []);

  const editingSinger = useMemo(
    () => singers.find((singer) => singer.id === editingSingerId) || null,
    [editingSingerId, singers],
  );

  const refreshSingers = async () => {
    if (!token) return;
    const result = await singersApi.list(token);
    onSingersChange(result.singers);
  };

  const resetAvatarSelection = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    if (avatarInputRef.current) {
      avatarInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    setEditingSingerId(null);
    setForm(EMPTY_FORM);
    resetAvatarSelection();
  };

  const handleEdit = (singer: VirtualSinger) => {
    setEditingSingerId(singer.id);
    setForm({
      name: singer.name,
      styleTags: singer.styleTags.join(', '),
      defaultLanguage: singer.defaultLanguage || 'zh',
      gender: singer.gender || 'unspecified',
      personaPrompt: singer.personaPrompt || '',
      notes: singer.notes || '',
      avatarUrl: singer.avatarUrl || '',
    });
    setStatus('');
    resetAvatarSelection();
  };

  const handleDelete = async (singer: VirtualSinger) => {
    if (!token) return;

    const confirmed = window.confirm(`确定删除歌手“${singer.name}”吗？已有歌曲会保留当时保存的歌手名称快照。`);
    if (!confirmed) return;

    try {
      await singersApi.remove(singer.id, token);
      await refreshSingers();
      setStatus(`已删除歌手：${singer.name}`);
      if (editingSingerId === singer.id) {
        resetForm();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '删除歌手失败。');
    }
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      setAvatarPreview(loadEvent.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = () => {
    resetAvatarSelection();
    setForm((prev) => ({ ...prev, avatarUrl: '' }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token) return;

    const payload = {
      name: form.name.trim(),
      styleTags: form.styleTags
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      defaultLanguage: form.defaultLanguage.trim() || 'zh',
      gender: form.gender,
      personaPrompt: form.personaPrompt.trim(),
      notes: form.notes.trim(),
      avatarUrl: form.avatarUrl.trim(),
    };

    if (!payload.name) {
      setStatus('请输入歌手名称。');
      return;
    }

    setSaving(true);
    setStatus('');

    try {
      if (avatarFile) {
        setUploadingAvatar(true);
        const avatarResult = await singersApi.uploadAvatar(avatarFile, token);
        payload.avatarUrl = avatarResult.url;
      }

      const result = editingSingerId
        ? await singersApi.update(editingSingerId, payload, token)
        : await singersApi.create(payload, token);

      await refreshSingers();
      setStatus(editingSingerId ? '歌手信息已更新。' : '歌手已创建。');

      if (!editingSingerId && pendingBinding) {
        await trainingApi.bindVoice(
          {
            singerId: result.singer.id,
            adapterPath: pendingBinding.adapterPath,
            exportPath: pendingBinding.exportPath,
            outputDir: pendingBinding.outputDir,
            datasetName: pendingBinding.datasetName,
            trainingMeta: pendingBinding.trainingMeta,
          },
          token,
        );

        sessionStorage.removeItem('pendingVoiceBinding');
        setPendingBinding(null);
        await refreshSingers();
        setStatus(`已创建歌手并自动绑定音色：${result.singer.name}`);
        onNavigateToTraining();
      }

      resetForm();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '保存歌手信息失败。');
    } finally {
      setSaving(false);
      setUploadingAvatar(false);
    }
  };

  return (
    <div className="scrollbar-hide h-full overflow-y-auto bg-white px-4 py-5 dark:bg-suno-DEFAULT sm:px-6 lg:px-8">
      <div className="w-full max-w-none space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">虚拟歌手管理</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            在这里维护歌手资料，音色训练与绑定流程统一在训练页完成。
          </p>
        </div>

        {pendingBinding && (
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50 px-4 py-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-center gap-2 font-semibold">
              <Link2 size={16} />
              检测到待绑定音色
            </div>
            <p className="mt-2">新建歌手后，当前导出的音色会自动绑定到这个歌手。</p>
            <p className="mt-1 break-all text-xs opacity-80">适配器路径：{pendingBinding.adapterPath}</p>
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,400px)]">
          <section className="min-w-0 rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">歌手列表</h2>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">共 {singers.length} 位歌手</span>
            </div>

            {singers.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-500 dark:border-white/10 dark:text-zinc-400">
                还没有歌手，请先在右侧表单中创建。
              </div>
            ) : (
              <>
                <div className="mt-4 space-y-3 2xl:hidden">
                  {singers.map((singer) => (
                    <article
                      key={singer.id}
                      className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-black/10"
                    >
                      <div className="flex items-start gap-3">
                        <div className="vs-gradient-icon flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl text-white">
                          {singer.avatarUrl ? (
                            <img src={singer.avatarUrl} alt={singer.name} className="h-full w-full object-cover" />
                          ) : (
                            <UserRound size={18} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-semibold text-zinc-900 dark:text-white">
                              {singer.name}
                            </h3>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                singer.hasVoiceBinding
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                                  : 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300'
                              }`}
                            >
                              {singer.hasVoiceBinding ? '已绑定音色' : '未绑定音色'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                            默认语言：{getLanguageLabel(singer.defaultLanguage)} · 性别：{getSingerGenderLabel(singer.gender)}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {singer.styleTags.length > 0 ? (
                          singer.styleTags.map((tag) => (
                            <span
                              key={`${singer.id}-${tag}`}
                              className="rounded-full bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-white/10 dark:text-zinc-200"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-zinc-400">未设置风格标签</span>
                        )}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(singer)}
                          className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-3 py-2 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                        >
                          <Pencil size={14} />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(singer)}
                          className="inline-flex items-center gap-1 rounded-xl border border-rose-200 px-3 py-2 text-xs text-rose-600 transition hover:bg-rose-50 dark:border-rose-400/20 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 size={14} />
                          删除
                        </button>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="mt-4 hidden overflow-hidden rounded-2xl border border-zinc-200 dark:border-white/10 2xl:block">
                  <div
                    className={`grid ${singerTableGridClass} gap-4 bg-zinc-100 px-4 py-3 text-xs font-semibold text-zinc-500 dark:bg-white/5 dark:text-zinc-400`}
                  >
                    <span>头像</span>
                    <span>名称</span>
                    <span>风格标签</span>
                    <span>语言</span>
                    <span>性别</span>
                    <span>绑定状态</span>
                    <span>操作</span>
                  </div>

                  {singers.map((singer) => (
                    <div
                      key={singer.id}
                      className={`grid ${singerTableGridClass} items-center gap-4 border-t border-zinc-200 bg-white px-4 py-4 dark:border-white/10 dark:bg-transparent`}
                    >
                      <div className="flex items-center">
                        <div className="vs-gradient-icon flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl text-white">
                          {singer.avatarUrl ? (
                            <img src={singer.avatarUrl} alt={singer.name} className="h-full w-full object-cover" />
                          ) : (
                            <UserRound size={18} />
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="truncate font-semibold text-zinc-900 dark:text-white">{singer.name}</div>
                      </div>

                      <div className="min-w-0 flex flex-wrap content-center items-center gap-1">
                        {singer.styleTags.length > 0 ? (
                          singer.styleTags.map((tag) => (
                            <span
                              key={`${singer.id}-${tag}`}
                              className="max-w-full whitespace-normal break-words rounded-full bg-zinc-100 px-2 py-1 text-xs leading-snug text-zinc-700 [overflow-wrap:anywhere] dark:bg-white/10 dark:text-zinc-200"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-zinc-400">未设置</span>
                        )}
                      </div>

                      <div className="text-sm text-zinc-700 dark:text-zinc-200">
                        {getLanguageLabel(singer.defaultLanguage)}
                      </div>

                      <div className="text-sm text-zinc-700 dark:text-zinc-200">
                        {getSingerGenderLabel(singer.gender)}
                      </div>

                      <div className="flex items-center">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            singer.hasVoiceBinding
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                              : 'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300'
                          }`}
                        >
                          {singer.hasVoiceBinding ? '已绑定' : '未绑定'}
                        </span>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleEdit(singer)}
                          className="inline-flex min-w-0 items-center gap-1 whitespace-normal break-words rounded-xl border border-zinc-200 px-2.5 py-1.5 text-xs leading-snug text-zinc-700 transition [overflow-wrap:anywhere] hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                        >
                          <Pencil size={14} className="shrink-0" />
                          <span className="min-w-0">编辑</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(singer)}
                          className="inline-flex min-w-0 items-center gap-1 whitespace-normal break-words rounded-xl border border-rose-200 px-2.5 py-1.5 text-xs leading-snug text-rose-600 transition [overflow-wrap:anywhere] hover:bg-rose-50 dark:border-rose-400/20 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 size={14} className="shrink-0" />
                          <span className="min-w-0">删除</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">
                  {editingSinger ? '编辑歌手' : '新建歌手'}
                </h2>
              </div>
              {!editingSinger && (
                <div className="vs-gradient-icon inline-flex h-10 w-10 items-center justify-center rounded-2xl text-white">
                  <Plus size={18} />
                </div>
              )}
            </div>

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">名称</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  className={inputClassName}
                  placeholder="例如：星澜 Echo"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">风格标签</span>
                <input
                  value={form.styleTags}
                  onChange={(event) => setForm((prev) => ({ ...prev, styleTags: event.target.value }))}
                  className={inputClassName}
                  placeholder="流行、电子、抒情"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">默认语言</span>
                <select
                  value={form.defaultLanguage}
                  onChange={(event) => setForm((prev) => ({ ...prev, defaultLanguage: event.target.value }))}
                  className={inputClassName}
                >
                  {LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.value} value={language.value}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">性别</span>
                <select
                  value={form.gender}
                  onChange={(event) => setForm((prev) => ({ ...prev, gender: event.target.value as typeof prev.gender }))}
                  className={inputClassName}
                >
                  {SINGER_GENDER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">角色设定</span>
                <textarea
                  value={form.personaPrompt}
                  onChange={(event) => setForm((prev) => ({ ...prev, personaPrompt: event.target.value }))}
                  className="vs-accent-focus min-h-[96px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition dark:border-white/10 dark:bg-white/5 dark:text-white"
                  placeholder="描述歌手的人设、语气特点和演唱风格。"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200">备注</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                  className="vs-accent-focus min-h-[88px] w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition dark:border-white/10 dark:bg-white/5 dark:text-white"
                  placeholder="可填写舞台定位、限制条件或擅长风格。"
                />
              </label>

              <div className="space-y-2">
                <span className="block text-sm font-medium text-zinc-700 dark:text-zinc-200">头像</span>
                <div className="flex items-center gap-4">
                  <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-full border-2 border-dashed border-zinc-300 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
                    {avatarPreview || form.avatarUrl ? (
                      <img
                        src={avatarPreview || form.avatarUrl}
                        alt={form.name || '歌手头像'}
                        className="h-full w-full object-cover"
                        onError={() => {
                          setAvatarPreview(null);
                          setForm((prev) => ({ ...prev, avatarUrl: '' }));
                        }}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-zinc-400 dark:text-zinc-500">
                        <Camera size={24} />
                      </div>
                    )}
                    {uploadingAvatar && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                        <Loader2 size={20} className="animate-spin text-white" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 space-y-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={handleAvatarChange}
                      className="hidden"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => avatarInputRef.current?.click()}
                        className="inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-white dark:hover:bg-zinc-700"
                      >
                        <Upload size={16} />
                        上传头像
                      </button>
                      {(avatarPreview || form.avatarUrl) && (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        >
                          移除头像
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      支持 JPEG、PNG、WebP、GIF，本地上传后会在保存歌手时一并提交。
                    </p>
                  </div>
                </div>
              </div>

              {status && (
                <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                  {status}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="vs-gradient-button inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pendingBinding && !editingSinger ? <Link2 size={16} /> : <Sparkles size={16} />}
                  {saving
                    ? '保存中...'
                    : pendingBinding && !editingSinger
                      ? '创建并自动绑定'
                      : editingSinger
                        ? '保存修改'
                        : '创建歌手'}
                </button>

                {editingSinger && (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-200 dark:hover:bg-white/10"
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};

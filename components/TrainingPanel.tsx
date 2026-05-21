import React, { useEffect, useMemo, useState } from 'react';
import { Download, FileAudio, Loader2, Play, Save, Settings2, Sparkles, Upload, Wand2 } from 'lucide-react';
import { singersApi, trainingApi } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { VirtualSinger } from '../types';

type Tab = 'dataset' | 'train' | 'export';

interface TrainingPanelProps {
  singers: VirtualSinger[];
  onSingersChange: (singers: VirtualSinger[]) => void;
  onNavigateToManagement: () => void;
}

export const TrainingPanel: React.FC<TrainingPanelProps> = ({
  singers,
  onSingersChange,
  onNavigateToManagement,
}) => {
  const { token } = useAuth();

  const [tab, setTab] = useState<Tab>('dataset');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [datasetName, setDatasetName] = useState('virtual_singer_dataset');
  const [datasetPath, setDatasetPath] = useState('./datasets/virtual_singer_dataset.json');
  const [datasetStatus, setDatasetStatus] = useState('');
  const [sampleCount, setSampleCount] = useState(0);
  const [currentSampleIdx, setCurrentSampleIdx] = useState(0);
  const [currentSample, setCurrentSample] = useState<Record<string, any> | null>(null);
  const [savingSample, setSavingSample] = useState(false);
  const [preprocessOutputDir, setPreprocessOutputDir] = useState('./datasets/preprocessed_tensors');
  const [preprocessStatus, setPreprocessStatus] = useState('');
  const [trainingParams, setTrainingParams] = useState({
    tensorDir: './datasets/preprocessed_tensors',
    rank: 64,
    alpha: 128,
    dropout: 0.1,
    learningRate: 0.0003,
    epochs: 1000,
    batchSize: 1,
    gradientAccumulation: 1,
    saveEvery: 200,
    shift: 3,
    seed: 42,
    outputDir: './lora_output',
  });
  const [trainingStatus, setTrainingStatus] = useState('');
  const [exportPath, setExportPath] = useState('./lora_output/final_lora');
  const [exportOutputDir, setExportOutputDir] = useState('./lora_output');
  const [exportResult, setExportResult] = useState<{ exportPath: string; loraOutputDir: string } | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [selectedSingerId, setSelectedSingerId] = useState('');
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const selectedSinger = useMemo(
    () => singers.find((singer) => singer.id === selectedSingerId) || null,
    [selectedSingerId, singers],
  );

  useEffect(() => {
    if (!token || busyAction !== 'train') return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const status = await trainingApi.getTrainingStatus(token);
        if (cancelled) return;

        const lines = [
          status.progress,
          status.log,
          status.error ? `Error: ${status.error}` : '',
        ].filter(Boolean);
        setTrainingStatus(lines.join('\n\n') || (status.running ? 'Training is running...' : 'Training is idle.'));

        if (!status.running) {
          setBusyAction(null);
          if (!status.error) {
            setTab('export');
          }
        }
      } catch (error) {
        if (!cancelled) {
          setTrainingStatus(error instanceof Error ? error.message : 'Failed to refresh training status.');
        }
      }
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busyAction, token]);

  const refreshSingers = async () => {
    if (!token) return;
    const result = await singersApi.list(token);
    onSingersChange(result.singers);
  };

  const handleUploadAndBuild = async () => {
    if (!token || queuedFiles.length === 0) return;

    setBusyAction('upload');
    setDatasetStatus('正在上传音频并构建数据集...');

    try {
      await trainingApi.uploadAudio(queuedFiles, datasetName, token);
      const result = await trainingApi.buildDataset({
        datasetName,
        allInstrumental: false,
      }, token);

      setDatasetPath(result.datasetPath);
      setSampleCount(result.sampleCount);
      setCurrentSampleIdx(0);
      setCurrentSample(result.sample as Record<string, any>);
      setDatasetStatus(result.status);
      setQueuedFiles([]);
    } catch (error) {
      setDatasetStatus(error instanceof Error ? error.message : '构建数据集失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const loadDataset = async () => {
    if (!token) return;

    setBusyAction('load-dataset');
    setDatasetStatus('正在加载数据集...');

    try {
      const result = await trainingApi.loadDataset(datasetPath, token);
      setSampleCount(result.sampleCount);
      setCurrentSampleIdx(0);
      setCurrentSample(result.sample as Record<string, any>);
      setDatasetStatus(result.status);
    } catch (error) {
      setDatasetStatus(error instanceof Error ? error.message : '加载数据集失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const moveSample = async (nextIndex: number) => {
    if (!token || nextIndex < 0 || nextIndex >= sampleCount) return;
    const sample = await trainingApi.getSamplePreview(nextIndex, token);
    setCurrentSampleIdx(nextIndex);
    setCurrentSample(sample as Record<string, any>);
  };

  const saveSample = async () => {
    if (!token || !currentSample) return;

    setSavingSample(true);

    try {
      const result = await trainingApi.saveSample({
        sampleIdx: currentSampleIdx,
        datasetPath,
        caption: currentSample.caption || '',
        genre: currentSample.genre || '',
        promptOverride: currentSample.promptOverride || 'Use Global Ratio',
        lyrics: currentSample.lyrics || '',
        bpm: currentSample.bpm || 120,
        key: currentSample.key || '',
        timeSignature: currentSample.timeSignature || '',
        language: currentSample.language || 'unknown',
        instrumental: Boolean(currentSample.instrumental),
      }, token);
      setDatasetStatus(result.status);
    } catch (error) {
      setDatasetStatus(error instanceof Error ? error.message : '保存样本失败。');
    } finally {
      setSavingSample(false);
    }
  };

  const autoLabelDataset = async () => {
    if (!token) return;

    setBusyAction('auto-label');
    setDatasetStatus('正在自动标注未标注样本...');

    try {
      const result = await trainingApi.autoLabel({
        datasetPath,
        onlyUnlabeled: true,
      }, token);
      const refreshed = await trainingApi.loadDataset(datasetPath, token);
      setSampleCount(refreshed.sampleCount);
      setCurrentSampleIdx(0);
      setCurrentSample(refreshed.sample as Record<string, any>);
      setDatasetStatus(result.status);
    } catch (error) {
      setDatasetStatus(error instanceof Error ? error.message : '自动标注失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const preprocessDataset = async () => {
    if (!token) return;

    setBusyAction('preprocess');
    setPreprocessStatus('正在预处理数据集...');

    try {
      const result = await trainingApi.preprocess({
        datasetPath,
        outputDir: preprocessOutputDir,
      }, token);
      setPreprocessStatus(result.status);
      setTrainingParams((prev) => ({ ...prev, tensorDir: preprocessOutputDir }));
    } catch (error) {
      setPreprocessStatus(error instanceof Error ? error.message : '预处理失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const startTraining = async () => {
    if (!token) return;

    setBusyAction('train');
    setTrainingStatus('正在启动训练...');

    try {
      const result = await trainingApi.startTraining(trainingParams, token);
      setTrainingStatus(result.progress || result.status || 'Training started.');
    } catch (error) {
      setTrainingStatus(error instanceof Error ? error.message : '训练失败。');
    }
  };

  const exportVoice = async () => {
    if (!token) return;

    setBusyAction('export');
    setExportStatus('正在导出训练音色...');

    try {
      const result = await trainingApi.exportLora({
        exportPath,
        loraOutputDir: exportOutputDir,
      }, token);

      setExportResult({ exportPath: result.exportPath, loraOutputDir: result.loraOutputDir });
      setExportPath(result.exportPath);
      setExportOutputDir(result.loraOutputDir);
      setExportStatus(result.status);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '导出失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const bindVoice = async () => {
    if (!token || !exportResult || !selectedSingerId) return;

    if (selectedSinger?.hasVoiceBinding) {
      const confirmed = window.confirm(
        `歌手“${selectedSinger.name}”已绑定音色，是否用新的训练结果覆盖？`,
      );
      if (!confirmed) return;
    }

    setBusyAction('bind');
    setExportStatus('正在绑定音色到歌手...');

    try {
      const result = await trainingApi.bindVoice({
        singerId: selectedSingerId,
        adapterPath: exportResult.exportPath,
        exportPath: exportResult.exportPath,
        outputDir: exportResult.loraOutputDir,
        datasetName,
        trainingMeta: {
          datasetPath,
          tensorDir: trainingParams.tensorDir,
          outputDir: trainingParams.outputDir,
        },
      }, token);

      await refreshSingers();
      setExportStatus(`已成功绑定到歌手：${result.singerName}。`);
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : '绑定失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const createSingerThenBind = () => {
    if (!exportResult) return;

    sessionStorage.setItem('pendingVoiceBinding', JSON.stringify({
      adapterPath: exportResult.exportPath,
      exportPath: exportResult.exportPath,
      outputDir: exportResult.loraOutputDir,
      datasetName,
      trainingMeta: {
        datasetPath,
        tensorDir: trainingParams.tensorDir,
        outputDir: trainingParams.outputDir,
      },
    }));

    onNavigateToManagement();
  };

  return (
    <div className="h-full overflow-y-auto bg-white p-6 dark:bg-suno-DEFAULT">
      <div className="mx-auto max-w-6xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">虚拟歌手训练</h1>
        </div>

        <div className="flex gap-2">
          {[
            ['dataset', '数据集'],
            ['train', '训练'],
            ['export', '导出与绑定'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value as Tab)}
              className={`rounded-full px-4 py-2 text-sm font-medium ${
                tab === value
                  ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'dataset' && (
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">1. 上传并构建数据集</h2>
              <div className="mt-4 space-y-4">
                <input
                  value={datasetName}
                  onChange={(event) => setDatasetName(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
                  placeholder="数据集名称"
                />
                <label className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-300 bg-white text-sm text-zinc-500 dark:border-white/10 dark:bg-black/20 dark:text-zinc-400">
                  <Upload size={18} />
                  <span className="mt-2">选择训练音频文件</span>
                  <span className="mt-1 text-xs">已加入 {queuedFiles.length} 个文件</span>
                  <input
                    type="file"
                    multiple
                    accept="audio/*"
                    className="hidden"
                    onChange={(event) => setQueuedFiles(Array.from(event.target.files || []))}
                  />
                </label>
                <button
                  type="button"
                  onClick={handleUploadAndBuild}
                  disabled={busyAction === 'upload' || queuedFiles.length === 0}
                  className="vs-gradient-button inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busyAction === 'upload' ? <Loader2 size={16} className="animate-spin" /> : <FileAudio size={16} />}
                  上传并构建
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">2. 预览并编辑样本</h2>
              <div className="mt-4 space-y-4">
                <div className="flex gap-3">
                  <input
                    value={datasetPath}
                    onChange={(event) => setDatasetPath(event.target.value)}
                    className="flex-1 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={loadDataset}
                    disabled={busyAction === 'load-dataset'}
                    className="rounded-2xl border border-zinc-200 px-4 py-3 text-sm dark:border-white/10"
                  >
                    加载
                  </button>
                  <button
                    type="button"
                    onClick={autoLabelDataset}
                    disabled={busyAction === 'auto-label'}
                    className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-3 text-sm dark:border-white/10"
                  >
                    {busyAction === 'auto-label' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    一键自动标注
                  </button>
                </div>

                {currentSample && (
                  <div className="space-y-3 rounded-3xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-black/20">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold text-zinc-900 dark:text-white">
                        样本 {currentSampleIdx + 1} / {sampleCount}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => moveSample(currentSampleIdx - 1)}
                          className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs dark:border-white/10"
                        >
                          上一个
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSample(currentSampleIdx + 1)}
                          className="rounded-xl border border-zinc-200 px-3 py-1.5 text-xs dark:border-white/10"
                        >
                          下一个
                        </button>
                      </div>
                    </div>

                    <input
                      value={currentSample.filename || ''}
                      readOnly
                      className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm opacity-70 dark:border-white/10 dark:bg-white/5 dark:text-white"
                    />
                    <input
                      value={currentSample.caption || ''}
                      onChange={(event) => setCurrentSample((prev) => ({ ...prev, caption: event.target.value }))}
                      className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white"
                      placeholder="描述"
                    />
                    <input
                      value={currentSample.genre || ''}
                      onChange={(event) => setCurrentSample((prev) => ({ ...prev, genre: event.target.value }))}
                      className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white"
                      placeholder="曲风"
                    />
                    <textarea
                      value={currentSample.lyrics || ''}
                      onChange={(event) => setCurrentSample((prev) => ({ ...prev, lyrics: event.target.value }))}
                      className="min-h-[120px] w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white"
                      placeholder="歌词"
                    />
                    <button
                      type="button"
                      onClick={saveSample}
                      disabled={savingSample}
                      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-3 text-sm dark:border-white/10"
                    >
                      {savingSample ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                      保存样本
                    </button>
                  </div>
                )}

                <div className="rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                  {datasetStatus || '数据集处理状态会显示在这里。'}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03] xl:col-span-2">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">3. 预处理</h2>
              <div className="mt-4 flex gap-3">
                <input
                  value={preprocessOutputDir}
                  onChange={(event) => setPreprocessOutputDir(event.target.value)}
                  className="flex-1 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-white/10 dark:bg-black/20 dark:text-white"
                />
                <button
                  type="button"
                  onClick={preprocessDataset}
                  disabled={busyAction === 'preprocess'}
                  className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white dark:bg-white dark:text-zinc-900"
                >
                  {busyAction === 'preprocess' ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                  开始预处理
                </button>
              </div>
              <div className="mt-3 rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                {preprocessStatus || '预处理完成后，可切换到“训练”页签继续。'}
              </div>
            </section>
          </div>
        )}

        {tab === 'train' && (
          <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">训练参数</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <input value={trainingParams.tensorDir} onChange={(event) => setTrainingParams((prev) => ({ ...prev, tensorDir: event.target.value }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white md:col-span-2" placeholder="张量目录" />
                <input type="number" value={trainingParams.rank} onChange={(event) => setTrainingParams((prev) => ({ ...prev, rank: Number(event.target.value) || 64 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="Rank" />
                <input type="number" value={trainingParams.alpha} onChange={(event) => setTrainingParams((prev) => ({ ...prev, alpha: Number(event.target.value) || 128 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="Alpha" />
                <input type="number" step="0.01" value={trainingParams.dropout} onChange={(event) => setTrainingParams((prev) => ({ ...prev, dropout: Number(event.target.value) || 0.1 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="Dropout" />
                <input type="number" step="0.0001" value={trainingParams.learningRate} onChange={(event) => setTrainingParams((prev) => ({ ...prev, learningRate: Number(event.target.value) || 0.0003 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="学习率" />
                <input type="number" value={trainingParams.epochs} onChange={(event) => setTrainingParams((prev) => ({ ...prev, epochs: Number(event.target.value) || 1000 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="训练轮数" />
                <input type="number" value={trainingParams.batchSize} onChange={(event) => setTrainingParams((prev) => ({ ...prev, batchSize: Number(event.target.value) || 1 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="批大小" />
                <input type="number" value={trainingParams.gradientAccumulation} onChange={(event) => setTrainingParams((prev) => ({ ...prev, gradientAccumulation: Number(event.target.value) || 1 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="梯度累积" />
                <input type="number" value={trainingParams.saveEvery} onChange={(event) => setTrainingParams((prev) => ({ ...prev, saveEvery: Number(event.target.value) || 200 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="每隔多少步保存" />
                <input type="number" step="0.1" value={trainingParams.shift} onChange={(event) => setTrainingParams((prev) => ({ ...prev, shift: Number(event.target.value) || 3 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="Shift" />
                <input type="number" value={trainingParams.seed} onChange={(event) => setTrainingParams((prev) => ({ ...prev, seed: Number(event.target.value) || 42 }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="随机种子" />
                <input value={trainingParams.outputDir} onChange={(event) => setTrainingParams((prev) => ({ ...prev, outputDir: event.target.value }))} className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white md:col-span-2" placeholder="输出目录" />
              </div>
              <button
                type="button"
                onClick={startTraining}
                disabled={busyAction === 'train'}
                className="vs-gradient-button mt-4 inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busyAction === 'train' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                开始训练
              </button>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">训练状态</h2>
              <div className="mt-4 rounded-2xl bg-zinc-100 px-4 py-4 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                {trainingStatus || '训练开始后，这里会显示进度或日志。'}
              </div>
            </section>
          </div>
        )}

        {tab === 'export' && (
          <div className="grid gap-6 xl:grid-cols-[1fr_0.95fr]">
            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">导出音色</h2>
              <div className="mt-4 space-y-4">
                <input value={exportPath} onChange={(event) => setExportPath(event.target.value)} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="导出路径" />
                <input value={exportOutputDir} onChange={(event) => setExportOutputDir(event.target.value)} className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" placeholder="LoRA 输出目录" />
                <button
                  type="button"
                  onClick={exportVoice}
                  disabled={busyAction === 'export'}
                  className="vs-gradient-button inline-flex items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busyAction === 'export' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  导出训练结果
                </button>
                <div className="rounded-2xl bg-zinc-100 px-4 py-4 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-200">
                  {exportStatus || '导出完成后，可以绑定到已有歌手，或先去管理页新建歌手再自动绑定。'}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-zinc-50/80 p-5 dark:border-white/10 dark:bg-white/[0.03]">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">绑定到歌手</h2>
              <div className="mt-4 space-y-4">
                <select
                  value={selectedSingerId}
                  onChange={(event) => setSelectedSingerId(event.target.value)}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white"
                >
                  <option value="">选择已有歌手</option>
                  {singers.map((singer) => (
                    <option key={singer.id} value={singer.id}>
                      {singer.name} {singer.hasVoiceBinding ? '（已绑定）' : ''}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={bindVoice}
                  disabled={!exportResult || !selectedSingerId || busyAction === 'bind'}
                  className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
                >
                  {busyAction === 'bind' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  绑定到歌手
                </button>

                <button
                  type="button"
                  onClick={createSingerThenBind}
                  disabled={!exportResult}
                  className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 px-4 py-3 text-sm dark:border-white/10"
                >
                  <Settings2 size={16} />
                  去管理页新建并自动绑定
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

import { getGradioClient } from './gradio-client.js';

export interface LoraState {
  loaded: boolean;
  active: boolean;
  scale: number;
  path: string;
}

let loraState: LoraState = {
  loaded: false,
  active: false,
  scale: 1.0,
  path: '',
};

function readMessage(result: unknown, fallback: string): string {
  const payload = result as { data?: unknown[] };
  const message = payload?.data?.[0];
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export function getLoraState(): LoraState {
  return { ...loraState };
}

export function resetLoraState(): void {
  loraState = {
    loaded: false,
    active: false,
    scale: 1.0,
    path: '',
  };
}

export async function loadLora(loraPath: string): Promise<{ message: string; state: LoraState }> {
  const client = await getGradioClient();
  const result = await client.predict('/load_lora', [loraPath]);
  loraState = {
    ...loraState,
    loaded: true,
    active: true,
    path: loraPath,
  };
  return {
    message: readMessage(result, 'LoRA loaded'),
    state: getLoraState(),
  };
}

export async function unloadLora(): Promise<{ message: string; state: LoraState }> {
  const client = await getGradioClient();
  const result = await client.predict('/unload_lora', []);
  resetLoraState();
  return {
    message: readMessage(result, 'LoRA unloaded'),
    state: getLoraState(),
  };
}

export async function setLoraScale(scale: number): Promise<{ message: string; state: LoraState }> {
  const client = await getGradioClient();
  const result = await client.predict('/set_lora_scale', [scale]);
  loraState = {
    ...loraState,
    scale,
  };
  return {
    message: readMessage(result, 'LoRA scale updated'),
    state: getLoraState(),
  };
}

export async function toggleLora(enabled: boolean): Promise<{ message: string; state: LoraState }> {
  const client = await getGradioClient();
  const result = await client.predict('/set_use_lora', [enabled]);
  loraState = {
    ...loraState,
    active: enabled,
  };
  return {
    message: readMessage(result, enabled ? 'LoRA enabled' : 'LoRA disabled'),
    state: getLoraState(),
  };
}

export async function ensureSingerVoice(adapterPath: string, scale = 1): Promise<LoraState> {
  if (!adapterPath.trim()) {
    throw new Error('Adapter path is required');
  }

  if (loraState.loaded && loraState.path === adapterPath) {
    if (!loraState.active) {
      await toggleLora(true);
    }
    if (loraState.scale !== scale) {
      await setLoraScale(scale);
    }
    return getLoraState();
  }

  if (loraState.loaded && loraState.path !== adapterPath) {
    await unloadLora();
  }

  await loadLora(adapterPath);

  if (scale !== loraState.scale) {
    await setLoraScale(scale);
  }

  if (!loraState.active) {
    await toggleLora(true);
  }

  return getLoraState();
}

export async function clearSingerVoice(): Promise<LoraState> {
  if (!loraState.loaded && !loraState.active) {
    resetLoraState();
    return getLoraState();
  }

  await unloadLora();
  return getLoraState();
}

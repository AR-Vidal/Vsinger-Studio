export const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' },
  { value: 'ja', label: '日文' },
  { value: 'ko', label: '韩文' },
  { value: 'yue', label: '粤语' },
] as const;

export type SupportedLanguageValue = (typeof LANGUAGE_OPTIONS)[number]['value'];

export function getLanguageLabel(value?: string | null): string {
  if (!value) {
    return LANGUAGE_OPTIONS[0].label;
  }

  return LANGUAGE_OPTIONS.find((language) => language.value === value)?.label ?? value;
}

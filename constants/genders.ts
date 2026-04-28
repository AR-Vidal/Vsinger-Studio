export const SINGER_GENDER_OPTIONS = [
  { value: 'unspecified', label: '未设置' },
  { value: 'female', label: '女声' },
  { value: 'male', label: '男声' },
] as const;

export type SingerGenderValue = (typeof SINGER_GENDER_OPTIONS)[number]['value'];

export function getSingerGenderLabel(value?: string | null): string {
  if (!value) {
    return SINGER_GENDER_OPTIONS[0].label;
  }

  return SINGER_GENDER_OPTIONS.find((option) => option.value === value)?.label ?? SINGER_GENDER_OPTIONS[0].label;
}

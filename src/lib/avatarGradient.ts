import type { CSSProperties } from 'react';

const gradients: Record<string, readonly [string, string]> = {
  A: ['#2563eb', '#9333ea'],
  U: ['#16a34a', '#0891b2'],
  S: ['#f97316', '#ec4899'],
  default: ['#0d9488', '#2563eb'],
  variants: ['#7c3aed', '#db2777'],
  warm: ['#ea580c', '#ca8a04'],
  cool: ['#0284c7', '#4f46e5'],
  mint: ['#059669', '#0d9488'],
  rose: ['#e11d48', '#9333ea'],
  ocean: ['#0369a1', '#0f766e'],
  violet: ['#6d28d9', '#2563eb']
};

export function getAvatarGradient(name: string): CSSProperties {
  const initial = name.trim().slice(0, 1).toLocaleUpperCase('tr') || 'Ü';
  const palette = gradients[initial] ?? Object.values(gradients).filter((value): value is readonly [string, string] => Array.isArray(value) && value.length === 2)[initial.codePointAt(0)! % 8];
  return {
    background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
    borderColor: 'rgba(255,255,255,.24)',
    color: '#ffffff'
  };
}

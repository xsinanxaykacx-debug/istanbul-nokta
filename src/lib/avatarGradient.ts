import type { CSSProperties } from 'react';

const featured: Record<string, readonly [string, string]> = {
  A: ['#2563eb', '#9333ea'],
  U: ['#16a34a', '#0891b2'],
  S: ['#f97316', '#ec4899']
};

const palettes: readonly (readonly [string, string])[] = [
  ['#7c3aed', '#db2777'],
  ['#ea580c', '#ca8a04'],
  ['#0284c7', '#4f46e5'],
  ['#059669', '#0d9488'],
  ['#e11d48', '#9333ea'],
  ['#0369a1', '#0f766e'],
  ['#6d28d9', '#2563eb'],
  ['#0f766e', '#2563eb']
];

export function getAvatarGradient(name: string): CSSProperties {
  const initial = name.trim().slice(0, 1).toLocaleUpperCase('tr') || 'Ü';
  const hash = initial.codePointAt(0) ?? 0;
  const palette = featured[initial] ?? palettes[hash % palettes.length];

  return {
    background: `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`,
    borderColor: 'rgba(255,255,255,.24)',
    color: '#ffffff'
  };
}

const BANNED_WORDS = ['amk', 'aq', 'orospu', 'siktir', 'yavşak', 'piç', 'göt', 'sik', 'amına', 'oç', 'yarrak', 'taşak', 'ibne', 'puşt', 'pezevenk', 'kahpe', 'sürtük', 'şerefsiz'];

function normalizeProfanityText(value: string): string {
  return value.toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

export function containsProfanity(text: string): boolean {
  if (!text) return false;
  const normalized = normalizeProfanityText(text);
  return BANNED_WORDS.some(word => normalized.includes(normalizeProfanityText(word)));
}

const MAX_EDGE = 1280;
const MAX_BYTES = 12 * 1024 * 1024;
export async function compressPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: Görsel dosyası seçin.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: Dosya 12 MB sınırını aşıyor.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); throw new Error('Fotoğraf işlenemedi.'); }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('JPEG sıkıştırılamadı.')), 'image/jpeg', 0.78));
}

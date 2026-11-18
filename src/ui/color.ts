// Colores de las clases en la grilla con texto legible (WCAG AA, contraste 4,5:1). Los colores de asignatura los elige
// el usuario o vienen de la paleta, y con texto blanco varios no se leían bien.

const channels = (hex: string) => {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#777777';
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const WHITE = '#ffffff';
const DARK = '#14201b';

/**
 * Fondo y texto para una clase. Usa el color tal cual con texto blanco u oscuro, el que se lea; si ninguno llega a 4,5:1,
 * oscurece un poco el fondo y usa texto blanco.
 */
export function lessonColors(color: string | undefined): { background: string; color: string } {
  const bg = color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#777777';
  if (contrast(WHITE, bg) >= 4.5) return { background: bg, color: WHITE };
  if (contrast(DARK, bg) >= 4.5) return { background: bg, color: DARK };
  let rgb = channels(bg);
  for (let i = 0; i < 20 && contrast(WHITE, toHex(rgb)) < 4.5; i++) rgb = rgb.map((v) => v * 0.94);
  return { background: toHex(rgb), color: WHITE };
}

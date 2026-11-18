import { describe, expect, it } from 'vitest';
import { contrast, lessonColors } from './color';
import { SUBJECT_COLORS } from '../domain/defaults';

describe('colores de las clases', () => {
  it('todo color de la paleta queda con texto legible (4,5:1)', () => {
    for (const c of SUBJECT_COLORS) {
      const { background, color } = lessonColors(c);
      expect(contrast(background, color)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('conserva el color si ya se lee, y acepta colores no válidos', () => {
    expect(lessonColors('#a8463f')).toEqual({ background: '#a8463f', color: '#ffffff' });
    expect(lessonColors('#c99a2e').color).not.toBe('#ffffff');
    expect(contrast(lessonColors('nada').background, lessonColors('nada').color)).toBeGreaterThanOrEqual(4.5);
  });
});

import type { RGBA } from '../shared/types';

const to255 = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);

/** "#635BFF", or "#635BFF 80%" when not fully opaque. */
export function formatColor(c: RGBA): string {
  const hex = '#' + [c.r, c.g, c.b].map((v) => to255(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  return c.a < 0.995 ? `${hex} ${Math.round(c.a * 100)}%` : hex;
}

/**
 * Exact equality at the precision a designer can see and type: 8-bit channels and whole-percent
 * alpha. Figma stores floats, so raw equality would miss colours typed in as the same hex.
 */
export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return (
    to255(a.r) === to255(b.r) &&
    to255(a.g) === to255(b.g) &&
    to255(a.b) === to255(b.b) &&
    Math.round(a.a * 100) === Math.round(b.a * 100)
  );
}

function toLab(c: RGBA): [number, number, number] {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const r = lin(c.r), g = lin(c.g), b = lin(c.b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE. ~2.3 is a "just noticeable difference". Alpha differences are not near-misses. */
export function deltaE(a: RGBA, b: RGBA): number {
  if (Math.round(a.a * 100) !== Math.round(b.a * 100)) return Infinity;
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** A shared bandwidth makes smoothing comparable across providers. */
export function violinBandwidth(values: number[], domain: number): number {
  if (values.length < 2) return domain / 40;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1));
  const quantile = (p: number) => {
    const index = (sorted.length - 1) * p;
    const lo = Math.floor(index);
    return sorted[lo] + (sorted[Math.ceil(index)] - sorted[lo]) * (index - lo);
  };
  const iqrScale = (quantile(0.75) - quantile(0.25)) / 1.34;
  const scale = Math.min(sd || Infinity, iqrScale || Infinity);
  return Math.max(domain / 120, Number.isFinite(scale) ? 0.9 * scale * values.length ** -0.2 : domain / 40);
}

/** Gaussian KDE, reflected at zero so estimated density cannot imply negative time. */
export function violinPath(values: number[], domain: number, bandwidth: number): string | null {
  if (values.length < 3) return null;
  const steps = 180;
  const density = Array.from({ length: steps + 1 }, (_, i) => {
    const x = i / steps * domain;
    const value = values.reduce((sum, v) => sum + Math.exp(-0.5 * ((x - v) / bandwidth) ** 2)
      + Math.exp(-0.5 * ((x + v) / bandwidth) ** 2), 0);
    return { x: i / steps * 800, value };
  });
  const peak = Math.max(...density.map(d => d.value));
  // Omit effectively zero-density tails instead of drawing a colored line
  // across the entire axis. The axis and observed samples stay unchanged.
  const first = Math.max(0, density.findIndex(d => d.value >= peak * 0.001) - 1);
  const last = Math.min(density.length - 1, density.findLastIndex(d => d.value >= peak * 0.001) + 1);
  const points = density.slice(first, last + 1).map(d => ({ x: d.x, halfWidth: d.value / peak * 23 }));
  const top = points.map(d => `${d.x.toFixed(2)},${(32 - d.halfWidth).toFixed(2)}`);
  const bottom = [...points].reverse().map(d => `${d.x.toFixed(2)},${(32 + d.halfWidth).toFixed(2)}`);
  return `M${top.join(' L')} L${bottom.join(' L')} Z`;
}

const COLORS: Record<string, string> = {
  NOTTE: '#4E79A7', BROWSERBASE: '#F28E2B', STEEL: '#E15759',
  HYPERBROWSER: '#76B7B2', KERNEL: '#59A14F', KERNEL_HEADFUL: '#59A14F',
  ANCHORBROWSER: '#EDC948', BROWSER_USE: '#B07AA1', LIGHTPANDA: '#FF9DA7', TILION: '#9C755F',
};
export function proxyProviderColor(provider: string) { return COLORS[provider] ?? '#BAB0AC'; }

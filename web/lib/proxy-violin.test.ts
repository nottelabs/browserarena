import assert from 'node:assert/strict';
import test from 'node:test';
import { violinBandwidth, violinPath } from './proxy-violin';

test('small samples are shown without inventing a density distribution', () => {
  assert.equal(violinPath([], 30_000, 500), null);
  assert.equal(violinPath([1000], 30_000, 500), null);
  assert.equal(violinPath([1000, 2000], 30_000, 500), null);
});

test('density uses the same geometry regardless of time units or sample order', () => {
  const values = [1000, 1500, 2500, 9000, 12_000];
  const msBandwidth = violinBandwidth(values, 30_000);
  const secondsBandwidth = violinBandwidth(values.map(v => v / 1000), 30);
  assert.ok(Math.abs(msBandwidth / 1000 - secondsBandwidth) < 1e-10);
  const path = violinPath(values, 30_000, msBandwidth)!;
  assert.equal(path, violinPath([...values].reverse(), 30_000, msBandwidth));
  assert.equal(path, violinPath(values.map(v => v / 1000), 30, secondsBandwidth));
  assert.ok(!/NaN|Infinity/.test(path));
});

test('identical and zero-duration samples produce a finite bounded estimate', () => {
  const values = [0, 0, 0, 0];
  const bandwidth = violinBandwidth(values, 30_000);
  assert.ok(bandwidth > 0 && Number.isFinite(bandwidth));
  const path = violinPath(values, 30_000, bandwidth)!;
  const coordinates = [...path.matchAll(/([\d.]+),([\d.]+)/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.ok(coordinates.length > 0);
  assert.ok(coordinates.every(([x, y]) => x >= 0 && x <= 800 && y >= 0 && y <= 64));
});

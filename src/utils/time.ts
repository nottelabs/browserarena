export const isoUtcNow = () => new Date().toISOString();
export const nowNs = () => process.hrtime.bigint();
export const msSince = (start: bigint) =>
  Number((process.hrtime.bigint() - start) / 1_000_000n);

/** How long a rendered benchmark stays instant in the browser and on Vercel. */
export const BENCHMARK_CACHE_LIFE = {
  // Repeat clicks and prefetched routes render from the client cache.
  stale: 60 * 60,
  // A published run is picked up on the next request after a minute.
  revalidate: 60,
  expire: 60 * 60 * 24,
};

/**
 * Start pages for the browser throughput benchmark.
 *
 * A fixed pool rather than Special:Random: every provider, both regions, and
 * every day walk the same pages in the same order, so day-to-day differences
 * are the provider's and not Wikipedia's. The pool rotates by date so one
 * day's run does not hammer the same first article from every provider at
 * once. `--articles=random` swaps in the Wikipedia random API for ad-hoc runs.
 */

const WIKI = "https://en.wikipedia.org/wiki/";

/** Broad, stable, link-rich articles that all carry an infobox and a long body. */
export const ARTICLE_POOL: string[] = [
  "Albert_Einstein", "Ada_Lovelace", "Marie_Curie", "Isaac_Newton", "Alan_Turing",
  "Leonardo_da_Vinci", "Charles_Darwin", "Nikola_Tesla", "Galileo_Galilei", "Aristotle",
  "Tokyo", "Paris", "London", "New_York_City", "Berlin",
  "Cairo", "Mumbai", "Sydney", "Toronto", "Mexico_City",
  "Japan", "Brazil", "Canada", "Germany", "India",
  "Kenya", "Norway", "Argentina", "Vietnam", "Morocco",
  "Photosynthesis", "Plate_tectonics", "Black_hole", "DNA", "Evolution",
  "Quantum_mechanics", "Periodic_table", "Volcano", "Electricity", "Gravity",
  "Jazz", "Impressionism", "Renaissance", "Baroque_music", "Hip_hop_music",
  "Chess", "Association_football", "Basketball", "Cricket", "Tennis",
  "Internet", "Computer", "Python_(programming_language)", "Linux", "World_Wide_Web",
  "Coffee", "Chocolate", "Bread", "Rice", "Tea",
  "Amazon_rainforest", "Sahara", "Himalayas", "Great_Barrier_Reef", "Antarctica",
  "Roman_Empire", "French_Revolution", "World_War_II", "Industrial_Revolution", "Silk_Road",
  "Moon", "Mars", "Jupiter", "Sun", "Milky_Way",
  "Elephant", "Honey_bee", "Blue_whale", "Octopus", "Bald_eagle",
  "William_Shakespeare", "Jane_Austen", "Homer", "Gabriel_García_Márquez", "Haruki_Murakami",
  "Bicycle", "Airplane", "Railway", "Automobile", "Ship",
  "Mathematics", "Philosophy", "Economics", "Psychology", "Linguistics",
  "Mount_Everest", "Nile", "Lake_Baikal", "Grand_Canyon", "Iceland",
];

export function articleUrl(title: string): string {
  return `${WIKI}${encodeURIComponent(title).replace(/%2F/g, "/")}`;
}

/** Days since the Unix epoch, in UTC, for the daily rotation offset. */
function dayIndex(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

/**
 * The URL a given loop of a given session starts from. Deterministic in
 * (date, session, loop), identical for every provider that runs that day.
 */
export function fixedArticleUrl(
  date: Date,
  session: number,
  loop: number,
  loops: number,
  pool: string[] = ARTICLE_POOL
): string {
  const offset = dayIndex(date) % pool.length;
  const slot = (offset + session * loops + loop) % pool.length;
  return articleUrl(pool[slot]!);
}

interface RandomResponse {
  query?: { random?: { title: string }[] };
}

/** Wikipedia's random-article API, for ad-hoc runs that want fresh pages. */
export async function fetchRandomArticleUrls(
  count: number,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  const urls: string[] = [];
  while (urls.length < count) {
    const limit = Math.min(count - urls.length, 500);
    const api =
      "https://en.wikipedia.org/w/api.php?action=query&format=json&list=random" +
      `&rnnamespace=0&rnfilterredir=nonredirects&rnlimit=${limit}`;
    const res = await fetchImpl(api, {
      headers: { "User-Agent": "browserarena-browser-throughput (https://browserarena.ai)" },
    });
    if (!res.ok) throw new Error(`Wikipedia random API failed: HTTP ${res.status}`);
    const body = (await res.json()) as RandomResponse;
    const titles = body.query?.random?.map((r) => r.title) ?? [];
    if (titles.length === 0) throw new Error("Wikipedia random API returned no titles");
    for (const t of titles) urls.push(articleUrl(t.replace(/ /g, "_")));
  }
  return urls.slice(0, count);
}

export type ArticleSource = "fixed" | "random";

/** Start page for session slot `session` (0-based, warm-ups first) and loop `loop` (0-based). */
export type UrlForSlot = (session: number, loop: number) => string;

/** Resolves one start URL per (session, loop) up front, shared by every provider in the run. */
export async function resolveArticleUrls(
  source: ArticleSource,
  sessions: number,
  loops: number,
  date: Date = new Date()
): Promise<UrlForSlot> {
  if (source === "random") {
    const pool = await fetchRandomArticleUrls(Math.min(sessions * loops, 500));
    return (session, loop) => pool[(session * loops + loop) % pool.length]!;
  }
  return (session, loop) => fixedArticleUrl(date, session, loop, loops);
}

/**
 * Start pages for the browser throughput benchmark.
 *
 * A fixed pool: every provider, both regions, and every day walk the same
 * pages in the same order, so day-to-day differences are the provider's and
 * not the site's. The pool rotates by date so one day's run does not request
 * the same first page from every provider at once. `--articles=random`
 * shuffles the pool for ad-hoc runs.
 *
 * The pages are the Python 3.12 documentation: static HTML behind a CDN, in a
 * release that only receives security fixes, so the content barely changes.
 */

const DOCS = "https://docs.python.org/3.12/";

/**
 * The 100 largest pages of the library reference, language reference,
 * tutorial and HOWTOs that have one `h1` and at least five cross-references
 * in their body text. Paths are relative to the version root, without `.html`.
 */
export const ARTICLE_POOL: string[] = [
  "howto/argparse", "howto/descriptor", "howto/enum", "howto/functional",
  "howto/logging", "howto/regex", "howto/unicode", "library/argparse",
  "library/ast", "library/calendar", "library/codecs", "library/collections",
  "library/collections.abc", "library/concurrent.futures", "library/configparser", "library/contextlib",
  "library/csv", "library/ctypes", "library/dataclasses", "library/datetime",
  "library/decimal", "library/difflib", "library/dis", "library/doctest",
  "library/enum", "library/ftplib", "library/functools", "library/gettext",
  "library/hashlib", "library/http.client", "library/http.cookiejar", "library/http.server",
  "library/idle", "library/imaplib", "library/importlib", "library/inspect",
  "library/io", "library/ipaddress", "library/itertools", "library/json",
  "library/locale", "library/logging", "library/logging.config", "library/logging.handlers",
  "library/mailbox", "library/math", "library/multiprocessing", "library/nntplib",
  "library/operator", "library/optparse", "library/os", "library/pathlib",
  "library/pdb", "library/pickle", "library/profile", "library/pyexpat",
  "library/random", "library/re", "library/select", "library/shutil",
  "library/signal", "library/smtplib", "library/socket", "library/socketserver",
  "library/sqlite3", "library/ssl", "library/statistics", "library/string",
  "library/subprocess", "library/sys", "library/tarfile", "library/threading",
  "library/time", "library/tkinter", "library/traceback", "library/tracemalloc",
  "library/typing", "library/unittest", "library/unittest.mock", "library/unittest.mock-examples",
  "library/urllib.parse", "library/venv", "library/warnings", "library/weakref",
  "library/winreg", "library/wsgiref", "library/xml.dom", "library/xml.etree.elementtree",
  "library/xmlrpc.client", "library/zipfile", "reference/compound_stmts", "reference/datamodel",
  "reference/expressions", "reference/import", "reference/lexical_analysis", "reference/simple_stmts",
  "tutorial/classes", "tutorial/controlflow", "tutorial/datastructures", "tutorial/errors",
];

export function articleUrl(path: string): string {
  return `${DOCS}${path}.html`;
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

/** A shuffled copy of the pool, repeated as needed, for ad-hoc runs that should not follow the daily order. */
export function randomArticleUrls(count: number, random: () => number = Math.random, pool: string[] = ARTICLE_POOL): string[] {
  const urls: string[] = [];
  while (urls.length < count) {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    for (const path of shuffled) urls.push(articleUrl(path));
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
    const pool = randomArticleUrls(sessions * loops);
    return (session, loop) => pool[(session * loops + loop) % pool.length]!;
  }
  return (session, loop) => fixedArticleUrl(date, session, loop, loops);
}

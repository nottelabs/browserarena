/** Browser WebCrypto requires a secure context; fail before opening paid sessions. */
export function validateProxyGetUrls(url: string, bootstrapUrl: string, countryUrl: string) {
  const target = new URL(url);
  const bootstrap = new URL(bootstrapUrl);
  for (const value of [target, bootstrap, new URL(countryUrl)]) {
    if (!/^https?:$/.test(value.protocol)) throw new Error("Proxy GET URLs must use HTTP or HTTPS");
  }
  if (bootstrap.origin !== target.origin) throw new Error("--bootstrap-url must share the payload's origin");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(bootstrap.hostname);
  if (bootstrap.protocol !== "https:" && !loopback) {
    throw new Error("Proxy GET payload and bootstrap require HTTPS for browser SHA-256 validation (HTTP loopback is allowed for local tests)");
  }
}

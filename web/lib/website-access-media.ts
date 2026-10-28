/** A public evidence bucket root. Same-origin rewrites preserve the site's CSP. */
export function accessMediaOrigin(value: string | undefined): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WEBSITE_ACCESS_MEDIA_ORIGIN must be a public HTTPS URL without credentials, query or fragment");
  }
  return url.href.replace(/\/$/, "");
}

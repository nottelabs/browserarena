/** Strings keep Playwright evaluation independent of transpiler-injected helpers. */
export function countryExpression(url: string, timeoutMs: number): string {
  return `(async () => {
    const response = await fetch(${JSON.stringify(url)}, {
      cache: "no-store", credentials: "omit", redirect: "error",
      signal: AbortSignal.timeout(${timeoutMs})
    });
    if (!response.ok) throw new Error("Country check HTTP " + response.status);
    const body = await response.json();
    if (typeof body.country !== "string" || !/^[a-z]{2}$/i.test(body.country)) {
      throw new Error("Country check must return an ISO country in {country}");
    }
    return {country: body.country.toUpperCase(), bytes: new TextEncoder().encode(JSON.stringify(body)).length};
  })()`;
}

export function getExpression(url: string, timeoutMs: number, expectedBytes: number): string {
  return `(async () => {
    const url = ${JSON.stringify(url)};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ${timeoutMs});
    const result = { first_byte_ms: null, headers_ms: null, get_ms: null,
      bytes_received: 0, http_status: null, protocol: null, transfer_bytes: 0,
      sha256: null, error: null };
    const chunks = [];
    performance.clearResourceTimings();
    const started = performance.now();
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store",
        credentials: "omit", redirect: "error", signal: controller.signal });
      result.headers_ms = performance.now() - started;
      result.http_status = response.status;
      if (!response.body) throw new Error("GET returned no body");
      const reader = response.body.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (result.first_byte_ms === null) result.first_byte_ms = performance.now() - started;
        result.bytes_received += chunk.value.byteLength;
        if (result.bytes_received > ${expectedBytes}) {
          await reader.cancel();
          throw new Error("GET body exceeded expected size");
        }
        chunks.push(chunk.value);
      }
      result.get_ms = performance.now() - started;
      clearTimeout(timer);
      if (response.status !== 200) throw new Error("GET HTTP " + response.status);
      const body = new Uint8Array(result.bytes_received);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
      result.sha256 = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
    } catch (error) {
      result.error = controller.signal.aborted ? "GET timed out" : String(error);
    } finally {
      clearTimeout(timer);
      const entry = performance.getEntriesByName(url).at(-1);
      if (entry) { result.transfer_bytes = entry.transferSize || entry.encodedBodySize || 0;
        result.protocol = entry.nextHopProtocol || null; }
    }
    return result;
  })()`;
}

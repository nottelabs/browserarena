import type { CDPSession, Page } from "playwright-core";
import { sanitizeErrorMessage } from "../../utils/sanitize.js";
import type { ProxyGetRecord } from "./schema.js";

export function collectProxyDiagnostics(cdp: CDPSession, page: Page, urls: string[], phase: () => string,
  diagnostics: NonNullable<ProxyGetRecord["diagnostics"]>) {
  const started = performance.now();
  const endpoint = (value: string) => {
    const url = new URL(value);
    return sanitizeErrorMessage(`${url.origin}${url.pathname}`);
  };
  const allowed = new Set(urls.map(endpoint));
  const requests = new Map<string, typeof diagnostics.network[number]>();
  const headers = (values: Record<string, string | number>) => Object.fromEntries(Object.entries(values)
    .filter(([name]) => ["server", "cf-ray", "x-request-id", "content-type", "content-length", "access-control-allow-origin"].includes(name.toLowerCase()))
    .map(([name, value]) => [name.toLowerCase(), sanitizeErrorMessage(String(value)).slice(0, 500)]));
  cdp.on("Network.requestWillBeSent", event => {
    if (diagnostics.network.length >= 60 || !/^https?:/.test(event.request.url)) return;
    const url = endpoint(event.request.url);
    if (!allowed.has(url)) return;
    const request = { phase: phase(), endpoint: url, elapsed_ms: performance.now() - started };
    requests.set(event.requestId, request);
    diagnostics.network.push(request);
  });
  cdp.on("Network.responseReceived", event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { http_status: event.response.status, protocol: event.response.protocol,
      headers: headers(event.response.headers) });
  });
  // Includes HTTP responses that the browser refuses to expose to fetch (CORS).
  cdp.on("Network.responseReceivedExtraInfo", event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { http_status: event.statusCode,
      headers: { ...request.headers, ...headers(event.headers) } });
  });
  cdp.on("Network.dataReceived", event => {
    const request = requests.get(event.requestId);
    if (request) request.bytes_received = (request.bytes_received ?? 0) + event.dataLength;
  });
  cdp.on("Network.loadingFinished", event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { encoded_bytes: event.encodedDataLength, finished_ms: performance.now() - started });
  });
  cdp.on("Network.loadingFailed", event => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { error: sanitizeErrorMessage(event.errorText), canceled: event.canceled,
      blocked_reason: event.blockedReason, cors_error: event.corsErrorStatus?.corsError, finished_ms: performance.now() - started });
  });
  const recordError = (value: string) => {
    if (diagnostics.browser_errors.length < 20) diagnostics.browser_errors.push({ phase: phase(),
      elapsed_ms: performance.now() - started, message: sanitizeErrorMessage(value).slice(0, 2000) });
  };
  page.on("pageerror", error => recordError(error.message));
  page.on("console", msg => { if (msg.type() === "error") recordError(msg.text()); });
}

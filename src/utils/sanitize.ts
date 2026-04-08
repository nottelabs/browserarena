/**
 * Write-time error message sanitizer.
 *
 * Redacts secrets (API keys, bearer tokens, WebSocket URLs, private IPs, etc.)
 * from error messages before they are written to result files or log files on disk.
 *
 * Unlike the display-time sanitizer in web/lib/data.ts, this preserves the full
 * error message (no truncation) so stack traces remain useful for debugging.
 *
 * Keep the regex patterns in sync with web/lib/data.ts sanitizeFailureText().
 */

const ANSI_ESCAPE_RE = /\u001B\[[0-9;]*m/g;
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._~+\/=:-]+/gi;
const WS_URL_RE = /wss?:\/\/[^\s)"']+/gi;
const SECRET_PARAM_RE =
  /([?&](?:token|key|api[_-]?key|signature|sig|auth)=)[^&\s]+/gi;
const PRIVATE_IP_RE =
  /\b(?:10(?:\.\d{1,3}){3}|127(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})\b/g;
const LONG_HEX_RE = /\b[a-f0-9]{24,}\b/gi;
const HOME_PATH_RE = /\/(?:Users|home)\/[a-zA-Z0-9._-]+\//g;

export function sanitizeErrorMessage(input: string): string {
  return input
    .replace(ANSI_ESCAPE_RE, "")
    .replace(BEARER_TOKEN_RE, "Bearer [redacted]")
    .replace(WS_URL_RE, "[redacted websocket url]")
    .replace(SECRET_PARAM_RE, "$1[redacted]")
    .replace(PRIVATE_IP_RE, "[redacted private ip]")
    .replace(LONG_HEX_RE, "[redacted token]")
    .replace(HOME_PATH_RE, "/[redacted path]/");
}

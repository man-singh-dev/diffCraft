export const REDACTED = '[REDACTED]';

const NAME = String.raw`[A-Za-z0-9_.-]*(?:key|secret|password|passwd|pwd|token)[A-Za-z0-9_]*`;

const TOKEN_PATTERNS: RegExp[] = [
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bhttps:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}\b/g,
  /\bwhsec_[A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgsk_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
];

// `apiKey: "abc"`, `"password": 'x'`, `TOKEN = \`...\``: the quotes stay, the value goes.
const QUOTED_ASSIGNMENT = new RegExp(
  String.raw`(\b${NAME}["']?\s*(?::=|=>|[:=])\s*)(["'\`])(?:(?!\2).)+\2`,
  'gi',
);
// .env and shell style: `API_KEY=abc`, `export DB_PASSWORD=abc`.
const BARE_ASSIGNMENT = new RegExp(
  String.raw`^(\s*(?:export\s+)?[A-Za-z0-9_]*(?:KEY|SECRET|PASSWORD|PASSWD|TOKEN)[A-Za-z0-9_]*\s*=\s*)(?!["'\`])\S.*$`,
  'i',
);
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi;

const PRIVATE_KEY_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;
const PRIVATE_KEY_END = /-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/;

export function redactLine(line: string): string {
  let out = line;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  out = out.replace(QUOTED_ASSIGNMENT, `$1$2${REDACTED}$2`);
  out = out.replace(BARE_ASSIGNMENT, `$1${REDACTED}`);
  out = out.replace(URL_CREDENTIALS, `$1${REDACTED}@`);
  return out;
}

// Lines of one file in order: a private key spans many lines, so everything between BEGIN and END is masked.
export function redactLines(lines: readonly string[]): string[] {
  let inPrivateKey = false;
  return lines.map((line) => {
    if (inPrivateKey) {
      if (PRIVATE_KEY_END.test(line)) inPrivateKey = false;
      return REDACTED;
    }
    if (PRIVATE_KEY_BEGIN.test(line)) {
      inPrivateKey = !PRIVATE_KEY_END.test(line);
      return REDACTED;
    }
    return redactLine(line);
  });
}

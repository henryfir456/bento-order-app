import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const checks = [
  ['email-like value', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ['numeric employee or phone pattern', /(?<!\d)\d{5,}(?!\d)/u],
  ['LINE user ID pattern', /\bU[a-f0-9]{32}\b/iu],
  ['credential pattern', /\b(?:sk-[A-Z0-9]{20,}|gh[pousr]_[A-Z0-9]{20,}|xox[baprs]-[A-Z0-9-]{20,})\b/iu],
  ['non-synthetic bearer token', /Bearer\s+(?!synthetic|test|mock)[A-Z0-9._~+/-]{20,}/iu]
];

const findings = [];
const scanLine = (file, index, line) => {
  for (const [label, pattern] of checks) {
    if (pattern.test(line)) findings.push({ file, line: index + 1, label });
    pattern.lastIndex = 0;
  }
};

const diffMode = process.argv[2] === '--diff-stdin';
const files = diffMode ? [] : process.argv.slice(2);
if (diffMode) {
  process.stdin.setEncoding('utf8');
  let file = 'diff';
  let index = 0;
  for await (const diffLine of process.stdin) {
    if (diffLine.startsWith('+++ b/')) {
      file = diffLine.slice(6);
      index = 0;
    } else if (diffLine.startsWith('+') && !diffLine.startsWith('+++')) {
      scanLine(file, index, diffLine.slice(1));
      index += 1;
    }
  }
} else for (const file of files) {
  const path = resolve(file);
  if (!existsSync(path)) continue;
  const source = readFileSync(path, 'utf8');
  if (source.includes('\u0000')) continue;
  const lines = source.split(/\r?\n/u);
  lines.forEach((line, index) => scanLine(file, index, line));
}

if (findings.length) {
  for (const finding of findings) {
    process.stderr.write(`PII_SCAN BLOCKED: ${finding.file}:${finding.line} (${finding.label})\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`PII_SCAN PASS: scanned ${diffMode ? 'added diff lines' : `${files.length} new text files`}; no configured identity or credential patterns found.\n`);
}

import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildEmployeeMasterReport,
  parseEmployeeMasterText,
  planEmployeeMaster
} from './lib/employee-master.mjs';

const valueAfter = (args, flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || '' : '';
};

export const runEmployeeMasterDryRun = async ({
  inputPath,
  outputPath,
  existingUsersPath = '',
  format = 'auto'
} = {}) => {
  if (!inputPath || !outputPath) throw new Error('--input and --output are required.');
  const sourceText = await readFile(inputPath, 'utf8');
  const sourceFormat = format === 'auto'
    ? (extname(inputPath).toLowerCase() === '.csv' ? 'csv' : 'json')
    : format;
  const parsed = parseEmployeeMasterText(sourceText, {
    format: sourceFormat,
    sourceName: inputPath
  });

  let existingUsers = [];
  if (existingUsersPath) {
    existingUsers = JSON.parse(await readFile(existingUsersPath, 'utf8'));
    if (!Array.isArray(existingUsers)) throw new Error('Existing users snapshot must be an array.');
  }

  const plan = planEmployeeMaster({
    records: parsed.records,
    issues: parsed.issues,
    existingUsers
  });
  const report = buildEmployeeMasterReport({ parsed, plan, sourceName: inputPath });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  });
  return report;
};

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--remote') || args.includes('--execute') || args.includes('--apply')) {
    throw new Error('Employee master preload is a local dry-run only; remote/apply is not supported.');
  }
  return runEmployeeMasterDryRun({
    inputPath: valueAfter(args, '--input'),
    outputPath: valueAfter(args, '--output'),
    existingUsersPath: valueAfter(args, '--existing-users'),
    format: valueAfter(args, '--format') || 'auto'
  });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((report) => {
      console.log(JSON.stringify({
        executable: report.executable,
        counts: report.counts,
        output: process.argv[process.argv.indexOf('--output') + 1] || null,
        remoteMutation: report.remoteMutation
      }, null, 2));
      if (!report.executable) process.exitCode = 2;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

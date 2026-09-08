import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);

export const percentile = (values, percentileValue) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + ((sorted[upper] - sorted[lower]) * (index - lower));
};

export const summarizeSamples = (samples) => {
  const valid = samples.filter((sample) => Number.isFinite(sample.elapsedMs));
  const latencies = valid.map((sample) => sample.elapsedMs);
  const bytes = valid.map((sample) => sample.payloadBytes);
  const errors = samples.filter((sample) => !sample.ok).length;
  const mean = latencies.length
    ? latencies.reduce((total, value) => total + value, 0) / latencies.length
    : null;
  const meanBytes = bytes.length
    ? bytes.reduce((total, value) => total + value, 0) / bytes.length
    : null;

  return {
    count: samples.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    minMs: latencies.length ? Math.min(...latencies) : null,
    maxMs: latencies.length ? Math.max(...latencies) : null,
    meanMs: mean,
    meanPayloadBytes: meanBytes,
    minPayloadBytes: bytes.length ? Math.min(...bytes) : null,
    maxPayloadBytes: bytes.length ? Math.max(...bytes) : null,
    errorCount: errors,
    errorRate: samples.length ? errors / samples.length : null,
    statuses: samples.reduce((result, sample) => {
      const status = String(sample.status);
      result[status] = (result[status] || 0) + 1;
      return result;
    }, {})
  };
};

const value = (number, suffix = '') => (
  number === null || number === undefined ? 'N/A' : `${Number(number).toFixed(2)}${suffix}`
);

const difference = (workerValue, gasValue) => (
  workerValue === null || gasValue === null ? null : workerValue - gasValue
);

export const buildSummary = (result) => {
  const gasWarm = summarizeSamples(result.samples.GAS.warm);
  const workerWarm = summarizeSamples(result.samples.Worker.warm);
  const gasFirst = result.samples.GAS.cold[0] || null;
  const workerFirst = result.samples.Worker.cold[0] || null;

  return {
    gasWarm,
    workerWarm,
    gasFirst,
    workerFirst,
    difference: {
      warmP50Ms: difference(workerWarm.p50Ms, gasWarm.p50Ms),
      warmP95Ms: difference(workerWarm.p95Ms, gasWarm.p95Ms),
      meanMs: difference(workerWarm.meanMs, gasWarm.meanMs),
      firstRequestMs: difference(workerFirst?.elapsedMs ?? null, gasFirst?.elapsedMs ?? null),
      meanPayloadBytes: difference(workerWarm.meanPayloadBytes, gasWarm.meanPayloadBytes),
      errorRate: difference(workerWarm.errorRate, gasWarm.errorRate),
      latencyImprovementPct: gasWarm.meanMs && workerWarm.meanMs
        ? ((gasWarm.meanMs - workerWarm.meanMs) / gasWarm.meanMs) * 100
        : null,
      tailLatencyImprovementPct: gasWarm.p95Ms && workerWarm.p95Ms
        ? ((gasWarm.p95Ms - workerWarm.p95Ms) / gasWarm.p95Ms) * 100
        : null
    }
  };
};

export const renderSummary = (result) => {
  const summary = result.summary || buildSummary(result);
  const { gasWarm, workerWarm, gasFirst, workerFirst, difference: delta } = summary;
  const rows = [
    ['Warm P50', value(gasWarm.p50Ms, ' ms'), value(workerWarm.p50Ms, ' ms'), value(delta.warmP50Ms, ' ms')],
    ['Warm P95', value(gasWarm.p95Ms, ' ms'), value(workerWarm.p95Ms, ' ms'), value(delta.warmP95Ms, ' ms')],
    ['Mean', value(gasWarm.meanMs, ' ms'), value(workerWarm.meanMs, ' ms'), value(delta.meanMs, ' ms')],
    ['First request', value(gasFirst?.elapsedMs, ' ms'), value(workerFirst?.elapsedMs, ' ms'), value(delta.firstRequestMs, ' ms')],
    ['Payload bytes', value(gasWarm.meanPayloadBytes), value(workerWarm.meanPayloadBytes), value(delta.meanPayloadBytes)],
    ['Error rate', value(gasWarm.errorRate === null ? null : gasWarm.errorRate * 100, '%'), value(workerWarm.errorRate === null ? null : workerWarm.errorRate * 100, '%'), value(delta.errorRate === null ? null : delta.errorRate * 100, '%')]
  ];
  const lines = [
    'Benchmark: legacy-poc-bootstrap-parity',
    '| Metric | GAS + Sheets | Legacy POC Worker + D1 | Difference |',
    '| --- | ---: | ---: | ---: |',
    ...rows.map(([metric, gas, worker, deltaValue]) => `| ${metric} | ${gas} | ${worker} | ${deltaValue} |`),
    '',
    `Warm samples: GAS ${gasWarm.count}, Legacy POC Worker ${workerWarm.count}`,
    `Latency improvement (mean): ${value(delta.latencyImprovementPct, '%')}`,
    `Tail latency improvement (P95): ${value(delta.tailLatencyImprovementPct, '%')}`
  ];
  return lines.join('\n');
};

const main = () => {
  const inputPath = process.env.BENCH_JSON_IN || process.argv[2];
  if (!inputPath) {
    throw new Error('Set BENCH_JSON_IN or pass the benchmark JSON path.');
  }
  const resolvedPath = path.resolve(inputPath);
  const result = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  if (!result.summary) result.summary = buildSummary(result);
  const output = process.env.BENCH_REPORT_FORMAT === 'json'
    ? JSON.stringify(result, null, 2)
    : renderSummary(result);
  process.stdout.write(`${output}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();

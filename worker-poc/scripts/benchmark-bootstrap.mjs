import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildSummary, renderSummary } from './benchmark-report.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workerDirectory = path.resolve(scriptDirectory, '..');

const requiredEnv = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const parsePositiveInteger = (name, defaultValue, minimum = 1) => {
  const raw = String(process.env[name] || '').trim();
  const value = raw ? Number(raw) : defaultValue;
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}.`);
  }
  return value;
};

const createBootId = () => `BOOT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const withTimeout = async (operation, timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
};

const parseServerTiming = (header) => {
  if (!header) return null;
  const metrics = {};
  for (const entry of header.split(',')) {
    const parts = entry.trim().split(';');
    const name = parts.shift();
    if (!name) continue;
    const record = {};
    for (const part of parts) {
      const [key, rawValue] = part.split('=', 2);
      if (!key || rawValue === undefined) continue;
      const value = rawValue.replace(/^"|"$/g, '');
      record[key] = Number.isFinite(Number(value)) && key === 'dur' ? Number(value) : value;
    }
    metrics[name] = record;
  }
  return metrics;
};

const responseErrorCode = (body, response, parseError) => {
  if (parseError) return 'INVALID_JSON';
  if (body && typeof body === 'object') return body.error || body.code || (body.success === false ? 'BACKEND_ERROR' : null);
  return response && !response.ok ? `HTTP_${response.status}` : null;
};

const requestJson = async ({ backend, url, init, timeoutMs }) => {
  const startedAt = performance.now();
  let response = null;
  let body = null;
  let payloadBytes = 0;
  let parseError = null;
  let requestError = null;

  try {
    response = await withTimeout((signal) => fetch(url, { ...init, signal }), timeoutMs);
    const text = await response.text();
    payloadBytes = Buffer.byteLength(text, 'utf8');
    try {
      body = JSON.parse(text);
    } catch (error) {
      parseError = error;
    }
  } catch (error) {
    requestError = error;
  }

  const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
  const serverTimingHeader = response?.headers.get('Server-Timing') || '';
  const backendTiming = body?.observability?.timing?.metrics || null;
  const status = response?.status || 0;
  const errorCode = requestError
    ? (requestError.name === 'AbortError' ? 'TIMEOUT' : 'REQUEST_FAILED')
    : responseErrorCode(body, response, parseError);
  const sample = {
    backend,
    elapsedMs,
    payloadBytes,
    contentLength: Number(response?.headers.get('Content-Length')) || null,
    status,
    ok: Boolean(response?.ok && !parseError && body?.success !== false && !body?.error),
    errorCode,
    serverTiming: parseServerTiming(serverTimingHeader),
    backendTiming
  };

  return { sample, body };
};

const workerUrlForScenario = (baseUrl, userId, targetDate, bootId) => {
  const url = new URL(baseUrl);
  url.searchParams.set('userId', userId);
  if (targetDate) url.searchParams.set('targetDate', targetDate);
  else url.searchParams.delete('targetDate');
  url.searchParams.set('bootId', bootId);
  return url;
};

const gasRequest = (gasUrl, accessToken, targetDate, bootId) => ({
  url: gasUrl,
  init: {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      action: 'getBootstrapData',
      accessToken,
      targetDate,
      bootId,
      deferUiData: true
    })
  }
});

const shapeType = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const hasOwn = (value, key) => Boolean(
  value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key)
);

const pushDifference = (differences, path) => {
  if (differences.length < 20 && !differences.includes(path)) differences.push(path);
};

const compareShape = (left, right, currentPath, differences) => {
  const leftType = shapeType(left);
  const rightType = shapeType(right);
  if (leftType !== rightType) {
    pushDifference(differences, currentPath || '$');
    return;
  }
  if (leftType === 'array') {
    if (left.length !== right.length) pushDifference(differences, `${currentPath}.length`);
    const count = Math.min(left.length, right.length);
    for (let index = 0; index < count; index += 1) {
      compareShape(left[index], right[index], `${currentPath}[${index}]`, differences);
    }
    return;
  }
  if (leftType !== 'object') return;

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    compareShape(left[key], right[key], `${currentPath}.${key}`, differences);
  }
};

const primaryShapeProjection = (body) => {
  if (!body || typeof body !== 'object') return null;
  const projection = {
    ...body,
    user: body.user && { ...body.user },
    calendar: body.calendar && { ...body.calendar },
    ordersMap: {}
  };
  if (projection.calendar) projection.calendar.events = {};
  delete projection.bootId;
  delete projection.observability;
  return projection;
};

const compareCollectionCount = (left, right, path, expectedCount, differences) => {
  if (shapeType(left) !== 'object' || shapeType(right) !== 'object') {
    pushDifference(differences, path);
    return false;
  }
  const leftCount = Object.keys(left).length;
  const rightCount = Object.keys(right).length;
  if (leftCount !== rightCount) pushDifference(differences, `${path}.__count__`);
  if (leftCount !== expectedCount || rightCount !== expectedCount) {
    pushDifference(differences, `${path}.__expected_count__`);
  }
  return leftCount === expectedCount && rightCount === expectedCount;
};

const compareEventShapes = (gasEvents, workerEvents, differences) => {
  const requiredKeys = ['order_date', 'vendor', 'mode', 'deadline', 'isExpired', 'lunarLabel'];
  const signature = (event, path) => {
    if (shapeType(event) !== 'object') {
      pushDifference(differences, path);
      return null;
    }
    const types = [];
    for (const key of requiredKeys) {
      if (!hasOwn(event, key)) pushDifference(differences, `${path}.${key}`);
      types.push(`${key}:${shapeType(event[key])}`);
    }
    return types.join('|');
  };

  const gasSignatures = Object.values(gasEvents).map((event) => signature(event, 'calendar.events[*]'));
  const workerSignatures = Object.values(workerEvents).map((event) => signature(event, 'calendar.events[*]'));
  if (JSON.stringify(gasSignatures.sort()) !== JSON.stringify(workerSignatures.sort())) {
    pushDifference(differences, 'calendar.events[*].shape');
  }
};

const compareOrderMapShapes = (gasOrdersMap, workerOrdersMap, differences) => {
  const gasTypes = [...new Set(Object.values(gasOrdersMap).map(shapeType))].sort();
  const workerTypes = [...new Set(Object.values(workerOrdersMap).map(shapeType))].sort();
  if (JSON.stringify(gasTypes) !== JSON.stringify(workerTypes)) {
    pushDifference(differences, 'ordersMap[*].type');
  }
};

const readPath = (body, parts) => {
  let value = body;
  for (const part of parts) {
    if (!hasOwn(value, part)) return { present: false, value: undefined };
    value = value[part];
  }
  return { present: true, value };
};

const compareDiagnosticShape = (gasBody, workerBody, path, differences) => {
  const parts = path.split('.');
  const gasResult = readPath(gasBody, parts);
  const workerResult = readPath(workerBody, parts);
  if (gasResult.present !== workerResult.present) {
    pushDifference(differences, path);
    return;
  }
  if (gasResult.present && shapeType(gasResult.value) !== shapeType(workerResult.value)) {
    pushDifference(differences, path);
  }
};

const comparePrimaryResponses = (gasBody, workerBody, expectedCounts) => {
  const differences = [];
  if (!gasBody || !workerBody || typeof gasBody !== 'object' || typeof workerBody !== 'object') {
    return { pass: false, differencePaths: ['response'] };
  }
  if (gasBody.success !== workerBody.success) pushDifference(differences, 'success');
  if (gasBody.registered !== workerBody.registered) pushDifference(differences, 'registered');
  compareShape(primaryShapeProjection(gasBody), primaryShapeProjection(workerBody), '$', differences);

  const gasEvents = gasBody.calendar?.events;
  const workerEvents = workerBody.calendar?.events;
  if (compareCollectionCount(gasEvents, workerEvents, 'calendar.events', expectedCounts.events, differences)) {
    compareEventShapes(gasEvents, workerEvents, differences);
  }

  const gasOrdersMap = gasBody.ordersMap;
  const workerOrdersMap = workerBody.ordersMap;
  if (compareCollectionCount(gasOrdersMap, workerOrdersMap, 'ordersMap', expectedCounts.ordersMap, differences)) {
    compareOrderMapShapes(gasOrdersMap, workerOrdersMap, differences);
  }

  compareDiagnosticShape(gasBody, workerBody, 'bootId', differences);
  compareDiagnosticShape(gasBody, workerBody, 'observability', differences);
  compareDiagnosticShape(gasBody, workerBody, 'observability.timing', differences);
  compareDiagnosticShape(gasBody, workerBody, 'observability.timing.status', differences);
  compareDiagnosticShape(gasBody, workerBody, 'observability.timing.metrics', differences);

  return { pass: differences.length === 0, differencePaths: differences };
};

const runCommand = (command, args) => {
  const useWindowsCommandShim = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
  const executable = useWindowsCommandShim ? (process.env.ComSpec || 'cmd.exe') : command;
  const commandArgs = useWindowsCommandShim ? ['/d', '/s', '/c', command, ...args] : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: workerDirectory,
    stdio: 'inherit',
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with ${result.status}.`);
};

const runCorrectnessGate = () => {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  runCommand(npmCommand, ['run', 'db:migrations:local']);
  runCommand(npmCommand, ['run', 'db:migrations:local']);
  runCommand(process.execPath, ['--test', 'tests/index.test.js', 'tests/contract.test.js', 'tests/parity.test.js']);
};

const writeResult = (result) => {
  const outputPath = String(process.env.BENCH_JSON_OUT || '').trim();
  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  const markdownPath = String(process.env.BENCH_MARKDOWN_OUT || '').trim();
  if (markdownPath && result.summary) {
    fs.writeFileSync(path.resolve(markdownPath), `${renderSummary(result)}\n`, 'utf8');
  }
};

const main = async () => {
  runCorrectnessGate();

  const gasUrl = String(process.env.GAS_API_URL || process.env.VITE_GAS_API_URL || '').trim();
  const workerUrl = requiredEnv('WORKER_BOOTSTRAP_URL');
  const userId = requiredEnv('BENCH_USER_ID');
  const accessToken = requiredEnv('GAS_ACCESS_TOKEN');
  const targetDate = String(process.env.BENCH_TARGET_DATE || '').trim();
  const iterations = parsePositiveInteger('BENCH_ITERATIONS', 50, 30);
  const timeoutMs = parsePositiveInteger('BENCH_TIMEOUT_MS', 30000, 1000);
  const expectedEventCount = parsePositiveInteger('BENCH_EXPECTED_EVENT_COUNT', 13);
  const expectedOrderMapCount = parsePositiveInteger('BENCH_EXPECTED_ORDER_MAP_COUNT', 3);
  if (!gasUrl) throw new Error('Missing required environment variable: GAS_API_URL or VITE_GAS_API_URL');

  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    methodology: {
      primaryOnly: true,
      liFFLoginIncluded: false,
      concurrency: 1,
      firstRequestIsSeparate: true,
      warmIterations: iterations,
      timeoutMs,
      warmOrder: 'AB/BA; each backend receives the configured total serial warm requests',
      note: 'First request is cold-ish only; runtime providers do not guarantee a true cold start.'
    },
    config: {
      targetDate: targetDate || null,
      warmIterations: iterations,
      expectedEventCount,
      expectedOrderMapCount
    },
    parity: { status: 'NOT_RUN' },
    samples: {
      GAS: { cold: [], warm: [] },
      Worker: { cold: [], warm: [] }
    }
  };

  const bootId = createBootId();
  const gasCold = await requestJson({
    backend: 'GAS',
    ...gasRequest(gasUrl, accessToken, targetDate, bootId),
    timeoutMs
  });
  result.samples.GAS.cold.push(gasCold.sample);

  const workerCold = await requestJson({
    backend: 'Worker',
    url: workerUrlForScenario(workerUrl, userId, targetDate, bootId),
    init: { method: 'GET' },
    timeoutMs
  });
  result.samples.Worker.cold.push(workerCold.sample);

  const liveParity = comparePrimaryResponses(gasCold.body, workerCold.body, {
    events: expectedEventCount,
    ordersMap: expectedOrderMapCount
  });
  result.parity = {
    status: liveParity.pass ? 'PASS' : 'FAIL',
    differencePaths: liveParity.differencePaths
  };
  if (!liveParity.pass) {
    result.parity.status = 'FAIL';
    result.blocked = 'Live primary response semantics differ; warm benchmark was not run.';
    writeResult(result);
    process.stderr.write(`${result.blocked}\n`);
    process.exitCode = 2;
    return;
  }

  const firstRoundIterations = Math.ceil(iterations / 2);
  const secondRoundIterations = iterations - firstRoundIterations;
  const warmBlocks = [
    { run: 'A', backend: 'GAS', count: firstRoundIterations },
    { run: 'A', backend: 'Worker', count: firstRoundIterations },
    { run: 'B', backend: 'Worker', count: secondRoundIterations },
    { run: 'B', backend: 'GAS', count: secondRoundIterations }
  ];
  result.methodology.warmBlocks = warmBlocks;

  const requestWarmSample = (backend) => backend === 'GAS'
    ? requestJson({
      backend: 'GAS',
      ...gasRequest(gasUrl, accessToken, targetDate, createBootId()),
      timeoutMs
    })
    : requestJson({
      backend: 'Worker',
      url: workerUrlForScenario(workerUrl, userId, targetDate, createBootId()),
      init: { method: 'GET' },
      timeoutMs
    });

  let sequence = 0;
  for (const block of warmBlocks) {
    for (let index = 0; index < block.count; index += 1) {
      const warm = await requestWarmSample(block.backend);
      result.samples[block.backend].warm.push({
        ...warm.sample,
        iteration: result.samples[block.backend].warm.length + 1,
        run: block.run,
        runIteration: index + 1,
        sequence: sequence + 1
      });
      sequence += 1;
    }
  }

  result.summary = buildSummary(result);
  result.parity.status = 'PASS';
  writeResult(result);
  process.stdout.write(`${renderSummary(result)}\n`);
};

main().catch((error) => {
  process.stderr.write(`Benchmark blocked: ${error.message}\n`);
  process.exitCode = 1;
});

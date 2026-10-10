// Execute the actual App closures and effects with deterministic hook storage.
// Optional JSX/SSR verifies actual display conditions; this is not a browser/React DOM mount.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');
const React = require('react');
const { flush } = require('./deferred.cjs');
const root = path.resolve(__dirname, '../..');

exports.createHarness = ({ authClient, apiClient, store, timers = globalThis, renderJsx = false }) => {
  let cursor = 0, dirty = false, view;
  const slots = [], pendingEffects = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => {
        slots[i].value = typeof next === 'function' ? next(slots[i].value) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const i = cursor++;
      return (slots[i] ||= { current: initial });
    },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        pendingEffects.push(() => {
          slots[i]?.cleanup?.();
          slots[i] = { deps, fn, cleanup: fn() };
        });
      }
    }
  };
  const window = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = 'visible';
  const source = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
  const entry = source.lastIndexOf('\n  return (');
  if (entry < 0) throw new Error('App render entry missing');
  const renderSource = renderJsx
    ? source.slice(entry).replace('\n  return (', '\n  const renderedTree = (').replace(/\n}\s*$/, '')
    : '';
  const instrumented = source.slice(0, entry) + renderSource + `\n  return {
    authState, authStage, authError, authUser, authMode, loading, employeeGuestError,
    initLiffAndFetchData, handleLineLogin, handleBindLine, handleEmployeeGuestLogin,
    handleEmployeeGuestOnboarding, handleLineEmployeeBind,
    setEmployeeGuestId, setViewAsUser, viewAsUser, setAuthUser,
    ${renderJsx ? 'renderedTree,' : ''}
  };\n}`;
  const code = transformSync(instrumented, {
    loader: 'jsx', jsx: 'automatic', format: 'cjs', define: { 'import.meta.env.DEV': 'false' }
  }).code;
  const module = { exports: {} };
  const requireStub = (id) => {
    if (id === 'react') return { ...React, ...hooks, default: React };
    if (id === 'react/jsx-runtime') return require(id);
    if (id === './auth/liffClient') return { authClient };
    if (id === './api/apiClient') return { apiClient, guestSessionStore: store };
    if (id === './data/changelog') return { APP_VERSION: 'test', UI_CHANGELOG: [] };
    if (id === './observability/bootTiming') return {
      createBootId: () => `BOOT-${Date.now()}-test`, getPerformanceNow: () => performance.now(),
      createBootTimingLogger: () => ({ milestone() {}, metric() {}, backend() {}, deferredBackend() {} })
    };
    if (id === 'sweetalert2') return { fire: async () => ({ isConfirmed: false }) };
    if (renderJsx && id === './components/IdentityStatusBadges') {
      const file = path.join(root, 'src/components/IdentityStatusBadges.jsx');
      const badgeModule = { exports: {} };
      const badgeCode = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'jsx', jsx: 'automatic', format: 'cjs' }).code;
      vm.runInNewContext(badgeCode, { module: badgeModule, exports: badgeModule.exports,
        require: (name) => name.startsWith('.') ? require(path.resolve(path.dirname(file), name + '.js')) : require(name) });
      return badgeModule.exports;
    }
    if (id.endsWith('.css') || id.includes('/components/') || !id.startsWith('.')) return { __esModule: true, default: () => null };
    const base = path.resolve(root, 'src', id);
    for (const filename of [base, `${base}.js`]) {
      if (fs.existsSync(filename) && filename.endsWith('.js')) return require(filename);
    }
    return {};
  };
  vm.runInNewContext(code, {
    require: requireStub, module, exports: module.exports, window, document,
    console: { info() {}, error() {}, warn() {} },
    setTimeout: timers.setTimeout.bind(timers), clearTimeout: timers.clearTimeout.bind(timers),
    Date, AbortController, performance
  });
  const render = () => {
    cursor = 0; dirty = false;
    view = module.exports.default();
    while (pendingEffects.length) pendingEffects.shift()();
  };
  render();
  return {
    get view() { return view; }, window, document,
    async settle() {
      for (let i = 0; i < 12; i += 1) { await flush(); if (dirty) render(); }
    },
    async event(type, { hidden = false } = {}) {
      document.visibilityState = hidden ? 'hidden' : 'visible';
      (type === 'visibilitychange' ? document : window).dispatchEvent(new Event(type));
      await this.settle();
    },
    replayEffects() {
      for (const slot of slots) slot?.cleanup?.();
      for (const slot of slots) if (slot?.fn) slot.cleanup = slot.fn();
    },
    destroy() { for (const slot of slots) slot?.cleanup?.(); }
  };
};

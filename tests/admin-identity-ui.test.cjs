const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('identity badges render authoritative source and public state without deriving verification', async () => {
  const { getIdentityBadges, identityFilterMatches } = await import(
    pathToFileURL(path.join(root, 'src/features/balances/identityStatus.js')).href
  );
  assert.deepEqual(
    getIdentityBadges({ authSource: 'LINE', identityState: 'VERIFIED' }).map((badge) => badge.label),
    ['LINE', '已驗證']
  );
  assert.deepEqual(
    getIdentityBadges({ authSource: 'EMPLOYEE_GUEST', identityState: 'PENDING_VERIFICATION' }).map((badge) => badge.label),
    ['非 LINE', '待審核']
  );
  assert.equal(identityFilterMatches({ identityState: 'EMPLOYEE_BIND_REQUIRED' }, 'EMPLOYEE_BIND_REQUIRED'), true);
  assert.equal(identityFilterMatches({ identityState: 'PENDING_VERIFICATION' }, 'VERIFIED'), false);
  assert.equal(identityFilterMatches({ verificationStatus: 'VERIFIED' }, 'PENDING_VERIFICATION'), false);
});

test('Admin identity UI uses Worker binding and never writes verification state locally', () => {
  const app = read('src/App.jsx');
  const client = read('src/api/apiClientCore.js');
  const member = read('src/features/balances/MemberBalanceManagement.jsx');
  const identityStatus = read('src/features/balances/identityStatus.js');
  assert.match(client, /adminBindEmployee:[\s\S]*?\/api\/admin\/users\//);
  assert.match(client, /body: \{ employeeId \}/);
  assert.doesNotMatch(client, /employee_id/);
  assert.doesNotMatch(app, /set.*verificationStatus|verificationStatus\s*=/);
  assert.match(app, /requireAuthoritativeIdentityState/);
  assert.doesNotMatch(app, /identityState \|\| IDENTITY_STATES\./);
  assert.match(app, /await fetchUserInfo\(readCurrentCredential\(\)\)/);
  assert.match(app, /setMemberBalancesLoaded\(false\);[\s\S]*?loadMemberBalances\(true\)/);
  assert.match(member, /登入來源/);
  assert.match(member, /身份狀態/);
  assert.match(identityStatus, /待綁員編/);
  assert.match(member, /md:hidden/);
  assert.match(member, /onOpenEmployeeBindModal/);
});

test('legacy GAS adapter has no Admin identity binding operation', () => {
  const client = read('src/api/apiClientCore.js');
  const gasBlock = client.slice(client.indexOf('const createGasOperations'), client.indexOf('const createWorkerOperations'));
  assert.doesNotMatch(gasBlock, /adminBindEmployee|employee-binding/);
});

test('identity governance records Worker-only authority and separate review concepts', () => {
  const architecture = read('docs/identity-verification-architecture.md');
  const manifest = read('agent.yaml');
  const envExample = read('.env.example');
  assert.match(architecture, /Cloudflare Worker \+ formal D1 is the only production backend/);
  assert.match(architecture, /Authentication establishes/);
  assert.match(architecture, /Employee binding associates/);
  assert.match(architecture, /Verification establishes/);
  assert.match(architecture, /Authorization derives/);
  assert.match(architecture, /exception-oriented/);
  assert.match(architecture, /employee ID is never sufficient/);
  assert.match(architecture, /REMOTE MIGRATION:\s+NOT\s+EXECUTED/);
  assert.match(architecture, /Admin “bind employee” and Admin “approve verification” are separate actions/);
  assert.match(architecture, /canonical[\s\S]*unique[\s\S]*ownership index/i);
  assert.doesNotMatch(architecture, /production GAS/);
  assert.match(manifest, /type: react-worker-d1-liff/);
  assert.match(manifest, /Worker deployment and remote D1 production contract/);
  assert.doesNotMatch(manifest, /react-gas-liff|GAS deployment and production contract/);
  assert.match(envExample, /VITE_API_TRANSPORT=worker/);
  assert.match(envExample, /VITE_WORKER_API_URL=/);
});

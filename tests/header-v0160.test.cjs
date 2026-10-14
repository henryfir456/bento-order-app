const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'src/App.jsx'),'utf8');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
const changelog=fs.readFileSync(path.join(root,'CHANGELOG.md'),'utf8');
const translations=fs.readFileSync(path.join(root,'src/data/changelog.js'),'utf8');
test('mobile header has one right-aligned identity row and no visible title row',()=>{
 const header=app.slice(app.indexOf('<header className='),app.indexOf('</header>'));
 assert.match(header,/<h1 className="sr-only">蔬食便當預訂系統<\/h1>/);
 assert.match(header,/flex min-w-0 flex-wrap items-center justify-end/);
 assert.doesNotMatch(header,/text-xl font-bold">蔬食便當預訂系統/);
 assert.match(header,/IdentityStatusBadges/);
 assert.match(header,/ViewAsBanner/);
 assert.match(header,/handleOpenFloorModal/);
});
test('v0.16.0 is one application version in both UI modes',()=>{
 assert.equal(pkg.version,'0.16.0');
 assert.equal(lock.version,pkg.version);
 assert.equal(lock.packages[''].version,pkg.version);
 assert.match(changelog,/## \[0\.16\.0\] - 2026-10-14/);
 assert.match(translations,/'0\.16\.0': \[/);
 assert.match(app,/APP_VERSION/);
 assert.match(app,/localStorage.setItem\('bento-calendar-ui'/);
});

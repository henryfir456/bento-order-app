#!/usr/bin/env node
// node scripts/check-agent-policy.mjs
import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const reference="docs/governance/AGENTS_PRE_REFACTOR_20261016.md";
const current="AGENTS.md";
const destinations=["AGENTS.md","docs/WORKER_DEPLOYMENT_POLICY.md","docs/RELEASE_VERSION_POLICY.md","docs/HISTORY_MIGRATION_POLICY.md"];
const oldLines=read(reference).split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !/^#{1,6} /.test(x));
const collected=destinations.map(read).join('\n');
const missing=[...new Set(oldLines)].filter(line=>!collected.includes(line));
if(missing.length){console.error("LOST ORIGINAL POLICY LINES:",missing);process.exitCode=1;}
const ag=read(current);
const mandatory=["docs/WORKER_DEPLOYMENT_POLICY.md","docs/FORMAL_WORKER_RELEASE.md","docs/DEPLOYMENT_METHODS_AND_LESSONS.md","docs/RELEASE_VERSION_POLICY.md","docs/HISTORY_MIGRATION_POLICY.md","docs/retrospectives/README.md"];
for(const file of mandatory){if(!ag.includes(file)||!fs.existsSync(path.join(root,file))){console.error("MISSING REQUIRED REFERENCE:",file);process.exitCode=1;}}
for(const file of destinations){const body=read(file);for(const m of body.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)){const link=m[1];if(/^(https?:|mailto:)/.test(link))continue;const target=path.resolve(path.dirname(path.join(root,file)),decodeURIComponent(link));if(!fs.existsSync(target)){console.error("BROKEN RELATIVE LINK:",file,link);process.exitCode=1;}}}
const invariants=["正式後端部署禁止 GitHub Actions","main","WAITING_FOR_DELIVERY","PASS、FAIL、NOT RUN 或 NOT VERIFIED","不得用全域、上層、外掛","保護任務開始前"];
for(const term of invariants){if(!ag.includes(term)){console.error("MISSING ROOT SAFETY GATE:",term);process.exitCode=1;}}
if(!process.exitCode)console.log("PASS: legacy policy line preservation, mandatory references, local links and root safety gates");

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seedUser,seedVendor,seedMenuVersion,seedLedgerRow } from './helpers/formal-fixtures.js';

test('0015 upgrade preserves existing users, orders, menu, wallet, ledger and FK contracts exactly',()=>{
  const raw=new DatabaseSync(':memory:'),directory=fileURLToPath(new URL('../migrations-formal/',import.meta.url));
  const files=readdirSync(directory).filter(n=>n.endsWith('.sql')).sort();
  for(const file of files.filter(n=>n<'0015'))raw.exec(readFileSync(directory+file,'utf8'));
  const db={run:(sql,...params)=>raw.prepare(sql).run(...params)};
  seedUser(db,{lineUserId:'fixture-user',balance:-50});seedVendor(db,{vendorId:'fixture-vendor',name:'Fixture'});
  seedMenuVersion(db,{menuVersionId:'fixture-menu',vendor:'Fixture'});
  seedLedgerRow(db,{transactionId:'fixture-ledger',userId:'fixture-user',amount:-50,balanceAfter:-50});
  db.run("INSERT INTO orders(order_id,user_id,display_name_snapshot,order_date,vendor,pickup_floor,total_amount,created_by_user_id) VALUES ('fixture-order','fixture-user','Synthetic','2026-10-10','Fixture','1F',0,'fixture-user')");
  const tables=raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
  const snapshot=()=>JSON.stringify(tables.map(name=>({name,rows:raw.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),schema:raw.prepare(`PRAGMA table_info(${name})`).all()})));
  const before=snapshot();raw.exec(readFileSync(directory+'0015_vendor_order_batches.sql','utf8'));
  assert.equal(snapshot(),before);
  assert.deepEqual(raw.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(raw.prepare('SELECT COUNT(*) n FROM vendor_order_attempts').get().n,0);
  raw.close();
});

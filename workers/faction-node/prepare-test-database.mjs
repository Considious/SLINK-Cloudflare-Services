import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
// Reuse the production table definitions, but never their seeded admin/product grants.
export async function testDatabaseSql(){
 const tables={
  '0001-permissions.sql':['user_scope_grants','faction_scope_grants'],
  '0004-war-service.sql':['war_terms_acceptances'],
  '0005-permission-catalog.sql':['permission_scope_catalog'],
  '0017-faction-onboarding.sql':['faction_member_roster'],
  '0018-officer-armory-oc.sql':['faction_position_scope_grants','faction_member_scope_grants']
 };
 const statements=['-- TEST ONLY: run in slink-faction-chat-test, never slink-permissions.\n-- No admin wildcard grants, production data, API keys or signing secrets.'];
 for(const [file,names]of Object.entries(tables)){
  const source=await readFile(new URL('../../permissions/migrations/'+file,import.meta.url),'utf8');
  for(const name of names){const match=source.match(new RegExp('CREATE TABLE IF NOT EXISTS '+name+' \\([\\s\\S]*?\\n\\);'));if(!match)throw Error('Missing canonical table '+name);let sql=match[0];if(name==='permission_scope_catalog')sql=sql.replace('scope TEXT PRIMARY KEY,',"scope TEXT PRIMARY KEY,\n    category TEXT NOT NULL DEFAULT 'Products',");statements.push(sql);}
 }
 statements.push(await readFile(new URL('../../permissions/migrations/0023-faction-node.sql',import.meta.url),'utf8'));
 statements.push(`-- Fourteen-day test faction license. Rerunning does not extend an existing grant.
INSERT INTO faction_scope_grants(faction_id,scope,status,starts_at,expires_at,granted_by,note,created_at,updated_at)
VALUES(46978,'slink.chat','active',unixepoch()*1000,(unixepoch()+14*86400)*1000,3853023,'Isolated faction chat test',unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(faction_id,scope) DO NOTHING;
-- Initial Leader 3853023 is assigned through the signed node registration, not admin.*.
SELECT faction_id,scope,status,expires_at FROM faction_scope_grants WHERE scope='slink.chat';`);
 return statements.join('\n\n')+'\n';
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 if(!process.argv.includes('--write'))throw Error('Use --write to generate the public test-only SQL; no deployment is performed.');
 await writeFile(new URL('test-database.sql',import.meta.url),await testDatabaseSql());console.log('Generated test-database.sql. Nothing was sent to Cloudflare.');
}

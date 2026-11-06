import assert from 'node:assert/strict';import {canUseChristmasIcons,requireRoomIcon,CHRISTMAS_ICONS} from '../room-icons.js';
assert.equal(CHRISTMAS_ICONS.length,12);
for(const scopes of [[],['slink.chat'],['slink.chat.personal.5']]){assert.equal(canUseChristmasIcons({scopes}),false);assert.throws(()=>requireRoomIcon('naughty_medical',{scopes}),e=>e.code==='THEME_PERMISSION_REQUIRED'&&e.status===403);}
for(const scope of ['slink.theme.christmas2026','admin.*','slink.theme.*','slink.*','*']){assert.equal(canUseChristmasIcons({scopes:[scope]}),true);for(const id of CHRISTMAS_ICONS)assert.doesNotThrow(()=>requireRoomIcon(id,{scopes:[scope]}));}
assert.doesNotThrow(()=>requireRoomIcon('naughty_medical',{scopes:[]},'naughty_medical'));
assert.throws(()=>requireRoomIcon('naughty_missing',{scopes:['admin.*']}),e=>e.code==='INVALID_ROOM_ICON');assert.doesNotThrow(()=>requireRoomIcon('group',{scopes:[]}));
console.log('Christmas icons: all 12 fixed IDs, entitlement/admin overrides, denial, existing icon preservation and normal icons passed.');

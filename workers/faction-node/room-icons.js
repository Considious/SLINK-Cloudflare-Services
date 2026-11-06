import {ensure} from './protocol.js';
export const CHRISTMAS_ICON_SCOPE='slink.theme.christmas2026';
export const CHRISTMAS_ICONS=Object.freeze(['medical','drug','booster','casino','addiction','shopping','flight','racing','education','stocks','oc','market'].map(id=>'naughty_'+id));
export function canUseChristmasIcons(actor){return Array.isArray(actor?.scopes)&&actor.scopes.some(scope=>[CHRISTMAS_ICON_SCOPE,'admin.*','slink.theme.*','slink.*','*'].includes(scope));}
export function requireRoomIcon(icon,actor,previous){
 if(typeof icon!=='string'||!icon.startsWith('naughty_'))return;
 ensure(CHRISTMAS_ICONS.includes(icon),'INVALID_ROOM_ICON','Choose a supported Christmas room icon.');
 // Preserve an already saved room icon when its owner edits unrelated metadata.
 if(icon===previous)return;
 ensure(canUseChristmasIcons(actor),'THEME_PERMISSION_REQUIRED','Christmas room icons require slink.theme.christmas2026.',403);
}

import {ensure} from './protocol.js';
export const CHRISTMAS_ICON_SCOPE='slink.theme.christmas2026';
export const CHRISTMAS_ICONS=Object.freeze(['medical','drug','booster','casino','addiction','shopping','flight','racing','education','stocks','oc','market'].map(id=>'naughty_'+id));
export const ROOM_THEME_SCOPES=Object.freeze({'slinky-pursuit':'slink.theme.pursuit','slinky-underglow':'slink.theme.underglow','slinky-black-chrome':'slink.theme.black-chrome','halloween-2026':'slink.theme.halloween','slink-naughty-list':CHRISTMAS_ICON_SCOPE,'slink-candy-cartel':'slink.theme.candy-cartel'});
const props=['medical','drug','booster','casino','addiction','shopping','flight','racing','education','stocks','oc','market'];
const collections=[['slink-naughty-list','naughty_',CHRISTMAS_ICONS,'Christmas'],['halloween-2026','haunt_',props.map(id=>'haunt_'+id),'Halloween'],['slink-candy-cartel','cartel_',props.map(id=>'cartel_'+id),'Candy Cartel']];
function hasTheme(actor,theme){return Object.hasOwn(ROOM_THEME_SCOPES,theme)&&Array.isArray(actor?.scopes)&&actor.scopes.some(scope=>[ROOM_THEME_SCOPES[theme],'admin.*','slink.theme.*','slink.*','*'].includes(scope));}
export function roomThemes(actor){return Object.keys(ROOM_THEME_SCOPES).filter(theme=>hasTheme(actor,theme));}
export function canUseChristmasIcons(actor){return hasTheme(actor,'slink-naughty-list');}
export function roomThemeChange(theme,actor,previous){
 if(theme===undefined||theme===(previous?.theme||''))return {};
 ensure(typeof theme==='string'&&(theme===''||Object.hasOwn(ROOM_THEME_SCOPES,theme)),'INVALID_ROOM_THEME','Choose a supported room theme.');
 const creator=previous?.theme_creator_id||previous?.owner_id;
 ensure(!creator||Number(creator)===Number(actor.user_id),'ROOM_THEME_CREATOR_REQUIRED','Only the room creator can change its theme.',403);
 ensure(!theme||hasTheme(actor,theme),'THEME_PERMISSION_REQUIRED','You need permission for that theme to apply it to a room.',403);
 return {theme,theme_creator_id:Number(actor.user_id)};
}
export function requireRoomIcon(icon,actor,previous){
 if(typeof icon!=='string')return;
 const collection=collections.find(([,prefix])=>icon.startsWith(prefix));if(!collection)return;
 const [theme,,icons,name]=collection;
 ensure(icons.includes(icon),'INVALID_ROOM_ICON','Choose a supported '+name+' room icon.');
 // Preserve an already saved room icon when its owner edits unrelated metadata.
 if(icon===previous)return;
 ensure(hasTheme(actor,theme),'THEME_PERMISSION_REQUIRED',name+' room icons require '+ROOM_THEME_SCOPES[theme]+'.',403);
}

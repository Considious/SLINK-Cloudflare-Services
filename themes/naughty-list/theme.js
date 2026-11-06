// Testing package only. Do not register in the production catalogue until visual approval.
// Artwork is generated from the user's approved SLINK Naughty List concept; all UI stays live HTML/CSS.
const asset=path=>new URL('./assets/'+path,import.meta.url).href;
const palette={coal:'#080b0e',blackIce:'#10171c',steel:'#bdc9d2',silver:'#e1e8eb',red:'#f21d35',evergreen:'#11bd56',ice:'#d9f5ff',muted:'#aab8c2'};
const tokens={
 '--slink-bg-primary':palette.coal,'--slink-bg-secondary':'#151b20','--slink-bg-panel':'rgba(8,14,18,.94)','--slink-bg-panel-alt':'rgba(17,26,31,.94)',
 '--slink-text-primary':'#f4f6f7','--slink-text-secondary':'#d1dbe1','--slink-text-muted':palette.muted,'--slink-text-danger':'#ffb6b9','--slink-text-success':'#67ff6f','--slink-text-warning':'#ffe2a7',
 '--slink-accent-primary':palette.red,'--slink-accent-secondary':palette.evergreen,'--slink-accent-danger':'#d83a4c','--slink-accent-success':'#38946b','--slink-accent-warning':'#bc8b36','--slink-accent-ice':palette.ice,
 '--slink-border-primary':'#83949f','--slink-border-secondary':'rgba(189,201,210,.3)','--slink-border-active':'#f3d9dc','--slink-shadow-panel':'0 6px 18px rgba(0,0,0,.45)','--slink-shadow-active':'0 0 0 1px rgba(255,218,221,.7)',
 '--slink-radius-small':'6px','--slink-radius-medium':'10px','--slink-radius-large':'16px','--slink-spacing-xs':'4px','--slink-spacing-sm':'8px','--slink-spacing-md':'14px','--slink-spacing-lg':'22px',
 // Existing SLINK contract aliases: a later app integration needs no component rewrites.
 '--slink-bg':palette.coal,'--slink-bg-raised':'#151b20','--slink-bg-control':'#1b252b','--slink-surface':'#10171c','--slink-card':'#080e12','--slink-control':'#1b252b',
 '--slink-border':'#83949f','--slink-border-soft':'rgba(189,201,210,.3)','--slink-text':'#f4f6f7','--slink-muted':palette.muted,'--slink-accent':palette.red,'--slink-accent-alt':palette.ice,
 '--slink-ready':'#67ff6f','--slink-warning':'#ffe2a7','--slink-error':'#ffb6b9','--slink-danger-bg':'#54101d','--slink-link':'#bce9ff','--slink-shadow':'rgba(0,0,0,.5)',
 '--slink-page-bg':'linear-gradient(135deg,#07090c,#141b21 55%,#080b0e)','--slink-topbar-bg':'linear-gradient(115deg,rgba(6,9,12,.96),rgba(31,37,41,.9))','--slink-panel-bg':'rgba(8,14,18,.94)',
 '--slink-button-bg':'linear-gradient(165deg,#303b42,#11181d 45%,#06090d)','--slink-selected-bg':'linear-gradient(110deg,#701525,#a0182e 60%,#213d32)','--slink-mark-bg':'linear-gradient(145deg,#182126,#07090b)',
 '--slink-glow-left':'rgba(168,21,45,.16)','--slink-glow-right':'rgba(32,97,71,.12)','--slink-metal':palette.steel,'--slink-metal-dark':'#343f47'
};
const frame=Object.fromEntries(['tl','top','tr','left','center','right','bl','bottom','br'].map(piece=>[piece,asset('frames/naughty_frame_'+piece+'.webp')]));
export const NAUGHTY_LIST_COPY=Object.freeze({combat:{title:"SEASON’S BEATINGS"},targets:{title:'NAUGHTY LIST',subtitle:'Checking it twice…'},war:{title:'PEACE WAS NEVER AN OPTION'},mugging:{title:'GIVE ME THAT!'},market:{title:'GIFTS, GIFTS… GIFTS, GIFTS, GIFTS!'},racing:{title:"WE’RE GONNA DIE!"},chat:{title:'AFTER HOURS AT THE NORTH POLE'}});
export const naughtyListTheme=Object.freeze({id:'slink-naughty-list',label:'SLINK Naughty List',displayName:'SLINK Naughty List',description:'Testing · black ice, snow-capped steel, crimson graffiti, crowned skulls, coal gifts and the Naughty List. Not yet released to SLINK.',releaseStatus:'draft',testingOnly:true,ornament:'naughty-list',scope:null,swatch:['#080b0e','#a0182e','#bdc9d2','#215c46'],tokens,assets:{coalScene:asset('overlays/naughty_coal_graffiti_v2.webp'),blacklistNote:asset('overlays/naughty_blacklist_note_v2.webp'),background:asset('backgrounds/naughty_wall_portrait_v3.webp'),brandIcon:asset('icons/naughty-brand.svg'),chatIcon:asset('icons/naughty-brand.svg'),frostOverlay:asset('frames/naughty_frame_top.webp'),frameAtlas:asset('frames/naughty_frame_atlas.webp'),frame},copy:NAUGHTY_LIST_COPY,frame:{slicePercent:16,desktopEdge:26,mobileEdge:20},styles:'theme.css'});
export default naughtyListTheme;

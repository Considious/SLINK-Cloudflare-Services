// Candy Cartel draft: Theme Lab only. No production catalogue entry or app permission grant.
const asset=name=>new URL('./assets/'+name+'.webp',import.meta.url).href;
export const candyCartelTheme=Object.freeze({
 id:'slink-candy-cartel',label:'Candy Cartel · Draft',displayName:'Candy Cartel',
 description:'Purple sugar glass, gold wrappers and liquorice luxury. A candy-mafia speakeasy, tested in the lab only.',
 testingOnly:true,releaseStatus:'draft',scope:null,ornament:'candy-cartel',
 swatch:['#221128','#842fe2','#dca642','#9bd52b'],
 branding:{title:'SLINK',subtitle:'Sugar Logistics & Illicit Network of Kriminals'},
 tokens:{
  '--slink-bg':'#140e16','--slink-bg-raised':'#28172d','--slink-bg-control':'#24132b',
  '--slink-surface':'#211125','--slink-card':'#160d1d','--slink-control':'#291630',
  '--slink-border':'#cc9e4d','--slink-border-soft':'rgba(216,170,85,.4)',
  '--slink-text':'#fff5df','--slink-muted':'#ddcbe1','--slink-accent':'#9438df','--slink-accent-alt':'#e3b656',
  '--slink-ready':'#b4ed57','--slink-warning':'#ffcf75','--slink-error':'#ffa4b0','--slink-danger-bg':'#6f172d',
  '--slink-link':'#dbb4ff','--slink-shadow':'rgba(0,0,0,.65)',
  '--slink-page-bg':'#140e16','--slink-topbar-bg':'linear-gradient(120deg,#28112d,#110b15)',
  '--slink-panel-bg':'rgba(22,13,29,.92)',
  '--slink-button-bg':'linear-gradient(145deg,#51305e,#27132e 50%,#130a1a)',
  '--slink-selected-bg':'linear-gradient(120deg,#7023b3,#481567 55%,#224c1a)',
  '--slink-mark-bg':'linear-gradient(135deg,#62347c,#140b1a)',
  '--slink-glow-left':'rgba(140,40,238,.22)','--slink-glow-right':'rgba(151,222,32,.12)',
  '--slink-metal':'#f3cf7d','--slink-metal-dark':'#715022',
  '--slink-text-primary':'#fff5df','--slink-text-secondary':'#f0dcef','--slink-text-muted':'#ddcbe1',
  '--slink-bg-primary':'#140e16','--slink-bg-secondary':'#28172d','--slink-bg-panel':'rgba(22,13,29,.92)',
  '--slink-accent-primary':'#9438df','--slink-accent-secondary':'#9bd52b','--slink-border-primary':'#cc9e4d',
  '--slink-radius-small':'8px','--slink-radius-medium':'12px','--slink-radius-large':'18px'
 },
 assets:{background:asset('background'),brandIcon:asset('brand'),chatIcon:asset('brand'),
  candyFrame:asset('frame'),candyButtonFrame:asset('button'),sideRail:asset('rail'),
  alertProps:Object.fromEntries(['medical','drug','booster','casino','addiction','shopping','flight','racing','education','stocks','oc','market'].map(id=>[id,asset(id)]))},
 styles:'theme.css'
});
export default candyCartelTheme;

// Minimal, dependency-free OOXML writer. All provider text is inline text, never formulas.
const enc = new TextEncoder();
const xml = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
const cellStyle = item => ({yellow:3,orange:4,red:5}[String(item?.rarity).toLowerCase()] || 0);
const c = (v,s=0) => ({v,s});
const date = v => {
  if (v == null || v === '') return '';
  const raw = typeof v === 'string' && /^\d{10,13}$/.test(v) ? Number(v) : v;
  const d = new Date(typeof raw === 'number' ? (raw < 1e12 ? raw*1000:raw) : raw);
  // Use whole Excel date serials, interpreted as UTC calendar dates.
  const ms=d.getTime();
  return Number.isFinite(ms) && ms>=0 ? c(Math.floor(ms/86400000)+25569,6) : '';

};
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && Number.isFinite(Number(v)) ? Number(v) : '';
const bonusText = item => (item?.bonuses || []).map(b=>[b.title || b.id,b.value == null ? '' : String(b.value),b.description || ''].filter(Boolean).join(' — ')).join('\n');
const itemText = item => item ? [item.name || 'Unknown item', ...(item.bonuses || []).map(b=>[b.title || b.id,b.value].filter(x=>x!=null).join(' '))].join('\n') : '';
const slotNames = ['primary','secondary','melee','temporary','helmet','body','pants','boots','gloves'];
function col(i) { let x=''; for(i++;i;i=Math.floor((i-1)/26)) x=String.fromCharCode(65+(i-1)%26)+x; return x; }
function cell(value, r, i) {
  const {v,s,preview}=value && typeof value === 'object' ? value : c(value);
  const ref=col(i)+r;
  // Only a generated artwork cell may contain a formula; no provider data becomes formula source.
  if (preview === true && i === 3) return '<c r="'+ref+'" s="0"><f>IFERROR(_xlfn.IMAGE(C'+r+',B'+r+',0),&quot;Image unavailable&quot;)</f></c>';
  if (typeof v==='number' && Number.isFinite(v)) return '<c r="'+ref+'" s="'+s+'"><v>'+v+'</v></c>';
  return '<c r="'+ref+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+xml(String(v??'').slice(0,32767))+'</t></is></c>';
}
function worksheet(headers,widths,rows) {
  const all=[headers.map(h=>c(h,1)),...rows];
  const end=col(headers.length-1)+all.length;
  return declaration+'<worksheet xmlns="'+ns+'"><dimension ref="A1:'+end+'"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>'+widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('')+'</cols><sheetData>'+all.map((row,i)=>'<row r="'+(i+1)+'" ht="'+(i===0?28:Math.min(100,Math.max(row.some(x=>x?.preview===true)?80:22,...row.map(x=>String(x?.v??x??'').split('\n').length*15+7))))+'" customHeight="1">'+row.map((x,j)=>cell(x,i+1,j)).join('')+'</row>').join('')+'</sheetData><autoFilter ref="A1:'+end+'"/></worksheet>';
}
const fill = color=>'<fill><patternFill patternType="solid"><fgColor rgb="FF'+color+'"/><bgColor indexed="64"/></patternFill></fill>';
const xf = (fontId,fillId,numFmtId=0)=>'<xf numFmtId="'+numFmtId+'" fontId="'+fontId+'" fillId="'+fillId+'" borderId="0" xfId="0" applyAlignment="1" applyFill="1" applyFont="1" applyNumberFormat="1"><alignment vertical="center" wrapText="1"/></xf>';
const styles=declaration+'<styleSheet xmlns="'+ns+'"><numFmts count="1"><numFmt numFmtId="164" formatCode="mmmm d, yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+['243B53','FFF2B2','FFD0A1','FFB5B5'].map(fill).join('')+'</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7">'+[xf(0,0),xf(1,2),xf(0,0,3),xf(0,3),xf(0,4),xf(0,5),xf(0,0,164)].join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
function crc32(bytes) { let crc=0xffffffff; for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
function zip(files) {
  const blocks=[], central=[];let offset=0,centralSize=0;
  for (const [name,source] of Object.entries(files)) {
    const n=enc.encode(name),data=enc.encode(source),crc=crc32(data);
    const local=new Uint8Array(30+n.length), a=new DataView(local.buffer);
    a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);a.setUint16(12,33,true);a.setUint32(14,crc,true);a.setUint32(18,data.length,true);a.setUint32(22,data.length,true);a.setUint16(26,n.length,true);local.set(n,30);
    const cd=new Uint8Array(46+n.length), b=new DataView(cd.buffer);
    b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);b.setUint16(14,33,true);b.setUint32(16,crc,true);b.setUint32(20,data.length,true);b.setUint32(24,data.length,true);b.setUint16(28,n.length,true);b.setUint32(42,offset,true);cd.set(n,46);
    blocks.push(local,data);central.push(cd);offset+=local.length+data.length;centralSize+=cd.length;
  }
  const end=new Uint8Array(22), d=new DataView(end.buffer);d.setUint32(0,0x06054b50,true);d.setUint16(8,central.length,true);d.setUint16(10,central.length,true);d.setUint32(12,centralSize,true);d.setUint32(16,offset,true);
  const out=new Uint8Array(offset+centralSize+end.length);let pos=0;for(const block of [...blocks,...central,end]){out.set(block,pos);pos+=block.length;}return out;
}
export function factionWorkbook(report, {images=false}={}) {
  const overview=[],equipment=[],catalog=new Map();
  for(const m of report.members) {
    const items=m.loadout?.equipment || [], bySlot=new Map(items.map(x=>[x.slot_name,x]));
    overview.push([m.name,m.player_id,c(number(m.stats?.bs_estimate),2),date(m.stats?.last_updated),date(m.loadout?.observed_at),m.loadout_status,...slotNames.map(s=>c(itemText(bySlot.get(s)),cellStyle(bySlot.get(s))))]);
    for(const item of items) {
      equipment.push([m.name,m.player_id,item.slot_name || item.slot,c(item.name,cellStyle(item)),item.rarity,item.id,item.stats?.damage,item.stats?.accuracy,item.stats?.armor,item.stats?.quality,bonusText(item),item.ammo?.type,(item.mods||[]).map(x=>x.name||x.id).join('\n'),item.effect,(item.blocked_effects||[]).map(x=>typeof x==='object'?JSON.stringify(x):x).join('\n'),date(m.loadout?.observed_at)]);
      if(Number.isSafeInteger(Number(item.id)) && Number(item.id)>0)catalog.set(Number(item.id),item.name||'Unknown item');
    }
  }
  const info=[['Faction ID',report.faction_id],['Faction name (KAL)',report.faction_name],['Retrieved (UTC)',report.fetched_at],['Roster source','Official Torn API; only current members included.'],['Stat source','FFScouter estimated total battle stats, not verified actual stats or individual attributes. Missing estimates are blank. Date columns use UTC calendar dates.'],['Loadout source','KAL last visible observation, not live gear. Missing entries do not mean unarmed.'],['KAL stored roster observation',date(report.kal_roster_observed_at)],['Yellow',c('Yellow ranked rarity',3)],['Orange',c('Orange ranked rarity',4)],['Red',c('Red ranked rarity',5)],['No fill','Unranked or unspecified rarity.'],['Provider documentation','https://www.torn.com/swagger.php | https://kalends.dev/api-docs | https://ffscouter.com/'],['Item artwork','Artwork tab lists public Torn base-item image links. Optional previews use Excel IMAGE and require a compatible Excel version and permission for external images; they are not embedded.']];
  for(const w of report.warnings||[])info.push([w.provider||'Warning',[w.code,w.message,w.endpoint,w.upstream_status,w.upstream_code,w.player_id == null ? null : 'Player '+w.player_id].filter(x=>x!=null).join(' | ')]);
  const sheets=[
    ['Faction roster', ['Player','Player ID','Estimated stats','Stats updated','Loadout observed','Loadout coverage',...slotNames.map(s=>s[0].toUpperCase()+s.slice(1))],[25,15,19,23,23,24,...slotNames.map(()=>28)],overview],
    ['Equipment details',['Player','Player ID','Slot','Item','Rarity','Item ID','Damage','Accuracy','Armor','Quality','Bonuses','Ammo','Mods','Effect','Blocked effects','Observed date'],[25,15,15,28,13,12,11,11,11,11,48,17,28,25,30,25],equipment],
    ['Item artwork',['Item ID','Item name','Public Torn image URL',...(images?['Preview']:[])],[15,32,80,...(images?[26]:[])],[...catalog.entries()].sort((a,b)=>a[0]-b[0]).map(([id,name])=>[id,name,'https://www.torn.com/images/items/'+id+'/large.png',...(images?[{preview:true}]:[])])],
    ['Read me',['Field','Explanation'],[32,105],info]
  ];
  const files={
    '[Content_Types].xml':declaration+'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>',
    '_rels/.rels':declaration+'<Relationships xmlns="'+pkg+'"><Relationship Id="rId1" Type="'+rel+'/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':declaration+'<workbook xmlns="'+ns+'" xmlns:r="'+rel+'"><bookViews><workbookView/></bookViews><sheets>'+sheets.map(([name],i)=>'<sheet name="'+xml(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels':declaration+'<Relationships xmlns="'+pkg+'">'+sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+rel+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="'+rel+'/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':styles
  };
  sheets.forEach(([,headers,widths,rows],i)=>{files['xl/worksheets/sheet'+(i+1)+'.xml']=worksheet(headers,widths,rows);});
  return zip(files);
}

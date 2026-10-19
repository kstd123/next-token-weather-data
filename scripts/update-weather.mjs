import fs from 'node:fs/promises';
import path from 'node:path';

// Generic public MeteoSwiss OGD extractor. No application code, secrets or user data.
const root='https://data.geo.admin.ch/',collection='ch.meteoschweiz.ogd-local-forecasting';
const generatedAt=new Date().toISOString(),today=generatedAt.slice(0,10).replaceAll('-','');
const parameters=['tre200h0','fu3010h0','fu3010h1','rp0003i0','nprolohs','jww003i0'];
const requiredIds=['4271','381800','33','435','382200','273','639000','43','601000','866','392000','1013','635600','1103'];
const popularNames=['Männlichen','Harder Kulm','Niesen','Stanserhorn','Rochers de Naye','Rochers-de-Naye','Bachalpsee','Säntis','Eggishorn','Piz Nair','Diavolezza','Muottas Muragl','Piz Corvatsch'];
const number=s=>s?.trim()!==''&&Number.isFinite(Number(s))?Number(s):null;
function cells(line){const out=[];let cell='',quote=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quote&&line[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(c===';'&&!quote){out.push(cell);cell='';}else cell+=c;}out.push(cell.replace(/\r$/,''));return out;}
async function request(url,init={}){if(!url.startsWith(root+collection+'/')&&!url.startsWith(root+'ch.meteoschweiz.ogd-smn/')&&!url.startsWith(root+'api/stac/v1/collections/'+collection+'/'))throw new Error('Unexpected source URL');const r=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(600000)});if(!r.ok)throw new Error(`Official source returned ${r.status}`);return r;}
async function lines(url,consume,limit=60000000){const r=await request(url);if(!r.body)throw new Error('Empty CSV');const reader=r.body.getReader(),decoder=new TextDecoder('windows-1252');let size=0,pending='';try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit)throw new Error('CSV too large');pending+=decoder.decode(part.value,{stream:true});const rows=pending.split('\n');pending=rows.pop()??'';for(const row of rows)consume(row.replace(/\r$/,''));if(pending.length>10000)throw new Error('Bad CSV line');}pending+=decoder.decode();if(pending)consume(pending.replace(/\r$/,''));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
// Ranged batches replace slow single nationwide transfers, only in this producer.
// Process immutable run files in byte order and preserve rows split at boundaries.
async function forecastLines(url,consume){
 const probe=await request(url,{headers:{Range:'bytes=0-0','Accept-Encoding':'identity'}});
 const range=probe.headers.get('content-range');await probe.body?.cancel();
 const match=/^bytes 0-0\/(\d+)$/.exec(range??'');if(probe.status!==206||!match)throw new Error('Official forecast range protocol changed');
 const total=Number(match[1]);if(total>60000000)throw new Error('Forecast file too large');
 const block=4000000,decoder=new TextDecoder('windows-1252');let pending='';
 for(let start=0;start<total;start+=block*4){
  const ranges=Array.from({length:4},(_,i)=>start+i*block).filter(from=>from<total);
  const buffers=await Promise.all(ranges.map(async from=>{const to=Math.min(from+block-1,total-1);const r=await request(url,{headers:{Range:`bytes=${from}-${to}`,'Accept-Encoding':'identity'}});if(r.status!==206||r.headers.get('content-range')!==`bytes ${from}-${to}/${total}`){await r.body?.cancel();throw new Error('Unexpected official byte range');}const value=await r.arrayBuffer();if(value.byteLength!==to-from+1)throw new Error('Truncated official byte range');return value;}));
  for(const buffer of buffers){pending+=decoder.decode(buffer,{stream:true});const rows=pending.split('\n');pending=rows.pop()??'';for(const row of rows)consume(row.replace(/\r$/,''));}
 }
 pending+=decoder.decode();if(pending)consume(pending.replace(/\r$/,''));
}
const allPoints=[];let headers=[];
await lines(root+collection+'/ogd-local-forecasting_meta_point.csv',line=>{if(!headers.length){headers=cells(line);for(const key of ['point_id','point_name','point_height_masl','point_coordinates_wgs84_lat','point_coordinates_wgs84_lon'])if(!headers.includes(key))throw new Error('Point schema changed');return;}if(!line)return;const row=cells(line),get=k=>row[headers.indexOf(k)];allPoints.push({id:get('point_id'),name:get('point_name'),altitude:Number(get('point_height_masl')),lat:Number(get('point_coordinates_wgs84_lat')),lng:Number(get('point_coordinates_wgs84_lon')),station:get('station_abbr')||null,distanceKm:null});},3000000);
const selected=allPoints.filter(p=>requiredIds.includes(p.id)||p.altitude>=1400&&popularNames.some(name=>p.name.toLowerCase()===name.toLowerCase()));
for(const id of ['4271','381800','33'])if(!selected.some(p=>p.id===id))throw new Error('Required official point missing: '+id);
if(selected.length>100)throw new Error('Unexpected selected point count');
const selectedIds=new Set(selected.map(p=>p.id));
headers=[];const smnStations=[];
await lines(root+'ch.meteoschweiz.ogd-smn/ogd-smn_meta_stations.csv',line=>{if(!headers.length){headers=cells(line);if(!headers.includes('station_abbr'))throw new Error('Station schema changed');return;}const row=cells(line),id=row[headers.indexOf('station_abbr')];if(id)smnStations.push(id);},500000);
let item;
try{item=await(await request(root+'api/stac/v1/collections/'+collection+'/items/'+today+'-ch')).json();}catch{const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10).replaceAll('-','');item=await(await request(root+'api/stac/v1/collections/'+collection+'/items/'+yesterday+'-ch')).json();}
const assets=Object.entries(item.assets??{});
const runs=assets.filter(([name])=>name.endsWith('.tre200h0.csv')).map(([name])=>name.split('.')[2]).filter(run=>/^\d{12}$/.test(run)&&parameters.every(p=>assets.some(([name])=>name.includes('.'+run+'.'+p+'.csv')))).sort();
const run=runs.at(-1);if(!run)throw new Error('No complete official forecast run');
const runTime=`${run.slice(0,4)}-${run.slice(4,6)}-${run.slice(6,8)}T${run.slice(8,10)}:${run.slice(10,12)}:00Z`;
if(Date.now()-Date.parse(runTime)>4*3600000)throw new Error('Latest complete official run is stale');
let previous;try{previous=JSON.parse(await fs.readFile('weather/index.json','utf8'));}catch{}
async function publishStatus(index){
 const status={version:1,run:index.run,generatedAt:index.generatedAt,pointCount:index.available.length};
 await fs.writeFile('weather/status.json',JSON.stringify(status,null,2)+'\n');
}
if(previous?.run===run){await publishStatus(previous);console.log('Latest complete run already published: '+run);process.exit(0);}
const data=new Map(selected.map(p=>[p.id,new Map()]));
for(let i=0;i<parameters.length;i+=2){await Promise.all(parameters.slice(i,i+2).map(async parameter=>{let header=false;const asset=assets.find(([name])=>name.includes('.'+run+'.'+parameter+'.csv'));console.log('Extracting '+parameter+' from official run '+run);
 await forecastLines(asset[1].href,line=>{if(!header){if(!line.startsWith('point_id;point_type_id;Date;'))throw new Error('Forecast schema changed');header=true;return;}const separator=line.indexOf(';');if(!selectedIds.has(line.slice(0,separator)))return;const [id,,time,raw]=line.split(';');if(!/^\d{12}$/.test(time))throw new Error('Forecast timestamp changed');const rows=data.get(id),row=rows.get(time)??{};row[parameter]=number(raw);rows.set(time,row);});console.log('Finished '+parameter);
}));}
const output='weather/runs/'+run;await fs.mkdir(output,{recursive:true});
const valid=[];
for(const point of selected){const entries=[...data.get(point.id)].sort(([a],[b])=>a.localeCompare(b));if(!entries.length||entries.length>240)throw new Error('Missing/oversized point series: '+point.id);const hours=entries.map(([time,row])=>({time:`${time.slice(0,4)}-${time.slice(4,6)}-${time.slice(6,8)}T${time.slice(8,10)}:${time.slice(10,12)}:00Z`,temperature:row.tre200h0??null,wind:row.fu3010h0??null,gust:row.fu3010h1??null,rainProbability:row.rp0003i0??null,lowCloud:row.nprolohs==null?null:Math.round(row.nprolohs*100),symbol:row.jww003i0??null}));
 if(hours.every(h=>h.temperature===null))throw new Error('No temperature: '+point.id);
 for(const h of hours)if(h.rainProbability!==null&&(h.rainProbability<0||h.rainProbability>100)||h.lowCloud!==null&&(h.lowCloud<0||h.lowCloud>100))throw new Error('Invalid fraction/probability');
 const record={version:1,pointId:point.id,run,generatedAt,hours};await fs.writeFile(path.join(output,point.id+'.json'),JSON.stringify(record,null,2)+'\n');valid.push(point.id);
}
const index={version:1,run,generatedAt,source:root+'api/stac/v1/collections/'+collection,license:'CC-BY-4.0',points:allPoints.filter(p=>p.altitude>=1400||selectedIds.has(p.id)),available:valid,smnStations};
if(index.points.length>2000)throw new Error('Point index exceeds contract');
await fs.writeFile('weather/index.json',JSON.stringify(index,null,2)+'\n');
await publishStatus(index);
const directories=(await fs.readdir('weather/runs')).filter(name=>/^\d{12}$/.test(name)).sort();
for(const name of directories.slice(0,-2))await fs.rm(path.join('weather/runs',name),{recursive:true});
console.log(JSON.stringify({run,points:valid.length,indexPoints:index.points.length,generatedAt}));

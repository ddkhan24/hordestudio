/* Portable Human ZIP: bounded metadata, separate media, no monolithic JSON string.
 * ZIP entries use STORE: photos, video and life archives are already compressed. */
(function(root){
'use strict';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=0xffffffff,MAX_ENTRIES=10000;
const LIFE_ARCHIVE_LIMIT=256*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
async function checksum(blob){let crc=0xffffffff;const reader=blob.stream().getReader();try{while(true){const {value,done}=await reader.read();if(done)break;for(const byte of value)crc=crcTable[(crc^byte)&255]^(crc>>>8);}}finally{reader.releaseLock();}return (crc^0xffffffff)>>>0;}
function bytes(length,fields){const data=new Uint8Array(length),v=new DataView(data.buffer);for(const [offset,size,value]of fields)v[size===2?'setUint16':'setUint32'](offset,value,true);return data;}
function safePath(path){return typeof path==='string'&&path.length<200&&!path.startsWith('/')&&!/[\\\u0000-\u001f\u007f:*?"<>|]/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');}
async function zip(entries,onProgress=()=>{}){if(!Array.isArray(entries)||entries.length>MAX_ENTRIES)throw Error('Package exceeds the ZIP entry limit.');const parts=[],central=[],paths=new Set();let offset=0,count=0;
 for(const [path,blob]of entries){if(!safePath(path)||!(blob instanceof Blob))throw Error('Invalid package file.');if(paths.has(path))throw Error('Duplicate package file: '+path);paths.add(path);const name=encoder.encode(path),crc=await checksum(blob);if(blob.size>MAX||offset+blob.size+name.length+30>MAX)throw Error('This package exceeds the supported 4 GB ZIP size.');
 const header=bytes(30,[[0,4,0x04034b50],[4,2,20],[6,2,0x800],[14,4,crc],[18,4,blob.size],[22,4,blob.size],[26,2,name.length]]);
 parts.push(header,name,blob);central.push(bytes(46,[[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x800],[16,4,crc],[20,4,blob.size],[24,4,blob.size],[28,2,name.length],[42,4,offset]]),name);offset+=30+name.length+blob.size;onProgress(++count,entries.length);}
 const directory=new Blob(central);if(count>65535||offset+directory.size+22>MAX)throw Error('Package exceeds standard ZIP limits.');parts.push(directory,bytes(22,[[0,4,0x06054b50],[8,2,count],[10,2,count],[12,4,directory.size],[16,4,offset]]));return new Blob(parts,{type:'application/zip'});}
async function unzip(file){if(file.size>MAX)throw Error('Package is larger than 4 GB.');const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer()),v=new DataView(tail.buffer);let end=-1;
 for(let i=tail.length-22;i>=0;i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===tail.length){end=i;break;}
 if(end<0)throw Error('Invalid ZIP directory.');if(v.getUint16(end+4,true)||v.getUint16(end+6,true))throw Error('Multi-volume ZIP is unsupported.');const count=v.getUint16(end+10,true),size=v.getUint32(end+12,true),offset=v.getUint32(end+16,true),endAt=file.size-tail.length+end;if(count>MAX_ENTRIES||v.getUint16(end+8,true)!==count||size>16*1024*1024||offset+size!==endAt)throw Error('Invalid ZIP limits.');
 const directory=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer()),d=new DataView(directory.buffer),files=new Map(),ranges=[];let at=0,total=0;
 for(let i=0;i<count;i++){if(at+46>size||d.getUint32(at,true)!==0x02014b50)throw Error('Invalid ZIP entry.');const flags=d.getUint16(at+8,true),method=d.getUint16(at+10,true),crc=d.getUint32(at+16,true),compressed=d.getUint32(at+20,true),raw=d.getUint32(at+24,true),n=d.getUint16(at+28,true),extra=d.getUint16(at+30,true),comment=d.getUint16(at+32,true),disk=d.getUint16(at+34,true),start=d.getUint32(at+42,true);const path=decoder.decode(directory.slice(at+46,at+46+n));at+=46+n+extra+comment;
 if(at>size||!safePath(path)||files.has(path)||flags&1||![0,8].includes(method)||start+30>offset||disk)throw Error('Unsupported or unsafe ZIP entry.');total+=raw;if(total>MAX)throw Error('Expanded package exceeds 4 GB.');const h=new DataView(await file.slice(start,start+30).arrayBuffer());if(h.getUint32(0,true)!==0x04034b50||h.getUint16(6,true)!==flags||h.getUint16(8,true)!==method||h.getUint16(26,true)!==n)throw Error('Inconsistent ZIP file header.');const dataAt=start+30+n+h.getUint16(28,true);if(dataAt+compressed>offset)throw Error('ZIP file overlaps its directory.');
 if(decoder.decode(await file.slice(start+30,start+30+n).arrayBuffer())!==path||!(flags&8)&&(h.getUint32(14,true)!==crc||h.getUint32(18,true)!==compressed||h.getUint32(22,true)!==raw))throw Error('Inconsistent ZIP file metadata.');ranges.push([start,dataAt+compressed]);
 let blob=file.slice(dataAt,dataAt+compressed);if(method===8){const stream=blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));const reader=stream.getReader(),parts=[];let length=0;try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>raw)throw Error('Expanded ZIP file exceeds declared size.');parts.push(r.value);}}finally{reader.releaseLock();}blob=new Blob(parts);}
 if(blob.size!==raw||await checksum(blob)!==crc)throw Error('Damaged package file: '+path);files.set(path,blob);}
 if(at!==size)throw Error('Invalid ZIP directory size.');ranges.sort((a,b)=>a[0]-b[0]);if(ranges.some((range,i)=>i&&range[0]<ranges[i-1][1]))throw Error('Overlapping ZIP files.');return files;}
function clone(value,seen=new Set(),arrayItem=false){if(value===null)return null;if(typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number')return Number.isFinite(value)?value:null;if(typeof value==='bigint')throw TypeError('BigInt cannot be serialized.');if(typeof value!=='object')return arrayItem?null:undefined;if(seen.has(value))throw TypeError('Circular archive data.');if(typeof value.toJSON==='function')return clone(value.toJSON(),seen,arrayItem);seen.add(value);const out=Array.isArray(value)?[]:{};for(const key of Object.keys(value)){if(['__proto__','prototype','constructor'].includes(key))continue;const item=clone(value[key],seen,Array.isArray(value));if(item!==undefined)out[key]=item;}seen.delete(value);return out;}
async function dataBlob(source){const comma=source.indexOf(','),mime=source.slice(5,source.indexOf(';'));const parts=[];for(let at=comma+1;at<source.length;at+=1048576){const raw=atob(source.slice(at,at+1048576));parts.push(Uint8Array.from(raw,c=>c.charCodeAt(0)));}return new Blob(parts,{type:mime});}
async function dataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
function validateLifeArchives(archives,limit=LIFE_ARCHIVE_LIMIT){
 if(!Array.isArray(archives)||archives.length>20)throw Error('Invalid character life archives.');let total=0;const worlds=new Set();
 for(const entry of archives){if(!entry||typeof entry!=='object'||typeof entry.worldId!=='string'||!entry.worldId.length||entry.worldId.length>100||worlds.has(entry.worldId))throw Error('Invalid or duplicate character life archive.');worlds.add(entry.worldId);
 const data=entry.data;let size;if(data instanceof Blob)size=data.size;else if(typeof data==='string'&&data.length%4===0&&/^[A-Za-z0-9+/]+={0,2}$/.test(data))size=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);else throw Error('Invalid character life archive encoding.');
 if(!size||(total+=size)>limit)throw Error('Saved life archives exceed the supported 256 MB combined limit.');}
 return total;
}
async function lifeUpload(body){
 validateLifeArchives(body.archives);if(!body.archives.length||!['companionId','importId'].every(k=>typeof body[k]==='string'&&body[k].length>0&&body[k].length<=100))throw Error('A character and import identity are required.');
 const entries=[],archives=[];
 for(const [index,entry] of body.archives.entries()){const path='lives/'+index+'.gz',blob=entry.data instanceof Blob?entry.data:await dataBlob('data:application/gzip;base64,'+entry.data);entries.push([path,blob]);archives.push({worldId:entry.worldId,path});}
 const metadata={format:'horde-character-lives',version:1,companionId:body.companionId,importId:body.importId,archives};entries.unshift(['restore.json',new Blob([JSON.stringify(metadata)],{type:'application/json'})]);return zip(entries);
}
async function pack(payload,onProgress=()=>{}){const entries=[],cache=new Map();let counter=0;
 async function visit(value,key=''){if(value instanceof Blob||typeof value==='string'&&/^data:[^;,]+;base64,/.test(value)){
  if(cache.has(value))return cache.get(value);const isBlob=value instanceof Blob,blob=isBlob?value:await dataBlob(value),mime=blob.type||'application/octet-stream',ext=({'video/mp4':'mp4','video/webm':'webm','image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/gzip':'gz'})[mime]||'bin';const path='media/'+String(++counter).padStart(5,'0')+'.'+ext,ref={$hordeAsset:path,mime,encoding:isBlob?'blob':'data-url'};entries.push([path,blob]);cache.set(value,ref);onProgress('Collecting media '+counter);return ref;}
  if(Array.isArray(value)){const out=[];for(const item of value)out.push(await visit(item));return out;}if(value&&typeof value==='object'){const out={};for(const [k,item]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(k))continue;out[k]=await visit(item,k);}return out;}return value;}
 const archive=await visit(payload),manifest={format:'horde-human-package',version:1,archive};const json=JSON.stringify(manifest),metadata=new Blob([json],{type:'application/json'});if(metadata.size>32*1024*1024)throw Error('Character metadata exceeds 32 MB; media must be separate files.');entries.unshift(['character.json',metadata]);return zip(entries,(done,total)=>onProgress('Packing '+done+' of '+total+' files'));}
async function unpack(file){const files=await unzip(file),manifestFile=files.get('character.json');if(!manifestFile||manifestFile.size>32*1024*1024)throw Error('Missing or oversized character.json.');const manifest=JSON.parse(await manifestFile.text());if(manifest.format!=='horde-human-package'||manifest.version!==1)throw Error('Unsupported Human package.');const cache=new Map();
 async function visit(value){if(value&&typeof value==='object'&&Object.hasOwn(value,'$hordeAsset')){const path=value.$hordeAsset;if(!files.has(path)||!['blob','data-url'].includes(value.encoding))throw Error('Missing package media: '+path);const key=path+'|'+value.encoding;if(!cache.has(key)){const blob=files.get(path).slice(0,undefined,value.mime);cache.set(key,value.encoding==='blob'?blob:await dataUrl(blob));}return cache.get(key);}
  if(Array.isArray(value)){const out=[];for(const item of value)out.push(await visit(item));return out;}if(value&&typeof value==='object'){const out={};for(const [key,item]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe archive field.');out[key]=await visit(item);}return out;}return value;}
 return visit(manifest.archive);}
// IndexedDB serializes repeated strings independently. Legacy reversible turn
// snapshots can exceed one record's limit with only a few distinct photos.
// Keep each large media string once as an immutable Blob in that same record,
// then restore the exact strings on read; no history or reroll data is discarded.
const STORAGE_FORMAT='media-strings-v1';
function storageEncode(value){
 const strings=[],byString=new Map(),seen=new Map(),marker='$hordeMediaRef:'+crypto.randomUUID();
 function visit(item){
  if(typeof item==='string'&&item.length>=65536&&/^data:[^;,]+;base64,/.test(item)){
   let index=byString.get(item);if(index===undefined){index=strings.length;byString.set(item,index);strings.push(new Blob([item],{type:'text/plain;charset=utf-8'}));}
   return {[marker]:index};
  }
  if(!item||typeof item!=='object'||!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))return item;
  if(seen.has(item))return seen.get(item);
  const result=Array.isArray(item)?[]:{};seen.set(item,result);
  for(const key of Object.keys(item))Object.defineProperty(result,key,{value:visit(item[key]),enumerable:true,writable:true,configurable:true});
  return result;
 }
 const data=visit(value);
 // Escape user objects that happen to resemble the storage wrapper as data.
 return strings.length||value?.$hordeStorage===STORAGE_FORMAT?{$hordeStorage:STORAGE_FORMAT,marker,data,strings}:value;
}
async function storageDecode(value){
 if(!value||value.$hordeStorage!==STORAGE_FORMAT||typeof value.marker!=='string'||!/^\$hordeMediaRef:[a-f0-9-]{36}$/.test(value.marker)||!Array.isArray(value.strings)||value.strings.some(v=>!(v instanceof Blob))||!Object.hasOwn(value,'data'))return value;
 const strings=await Promise.all(value.strings.map(blob=>blob.text())),seen=new Map();
 function visit(item){
  if(!item||typeof item!=='object'||!Array.isArray(item)&&![Object.prototype,null].includes(Object.getPrototypeOf(item)))return item;
  if(Object.hasOwn(item,value.marker)&&Object.keys(item).length===1){const index=item[value.marker];if(!Number.isSafeInteger(index)||index<0||index>=strings.length)throw Error('Saved media reference is damaged. Restore a verified backup.');return strings[index];}
  if(seen.has(item))return seen.get(item);
  const result=Array.isArray(item)?[]:{};seen.set(item,result);
  for(const key of Object.keys(item))Object.defineProperty(result,key,{value:visit(item[key]),enumerable:true,writable:true,configurable:true});
  return result;
 }
 return visit(value.data);
}
root.HordeHumanPackage={pack,unpack,zip,unzip,checksum,clone,dataBlob,dataUrl,validateLifeArchives,lifeUpload,LIFE_ARCHIVE_LIMIT,storageEncode,storageDecode};if(typeof module!=='undefined')module.exports=root.HordeHumanPackage;
})(globalThis);

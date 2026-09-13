'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../human-package.js');
(async()=>{
const media=new Blob([new Uint8Array(8*1024*1024).fill(37)],{type:'video/mp4'});
const raw={_format:'horde-studio-virtual-human',_version:3,companion:{name:'Package fixture'},media:{videos:[{id:'one',data:media},{id:'two',data:media}]}};
const zip=await P.pack(raw);const files=await P.unzip(zip);assert.equal(files.size,2);assert.equal(files.get('media/00001.mp4').size,media.size);const restored=await P.unpack(zip);assert.equal(restored.media.videos[0].data.size,media.size);assert.equal(await P.checksum(restored.media.videos[0].data),await P.checksum(media));
const malformed=new Uint8Array(await zip.arrayBuffer());malformed[60]^=1;await assert.rejects(()=>P.unzip(new Blob([malformed])));await assert.rejects(()=>P.zip([['../escape',new Blob(['x'])]]));
const polluted=JSON.parse('{"name":"safe","__proto__":{"polluted":true}}');assert.deepEqual(P.clone(polluted),{name:'safe'});
fs.writeFileSync(path.join(os.tmpdir(),'human-package-fixture.zip'),Buffer.from(await zip.arrayBuffer()));
// ZIP readers and disk extractors must agree on which file each payload belongs to.
const single=await P.zip([['character.json',new Blob(['{}'])]]),original=new Uint8Array(await single.arrayBuffer());
for(const [label,change] of [
 ['local filename',a=>{a[30]='x'.charCodeAt(0);}],
 ['local method',a=>{new DataView(a.buffer).setUint16(8,8,true);}],
 ['disk entry count',a=>{new DataView(a.buffer).setUint16(a.length-14,0,true);}],
]){const mutated=original.slice();change(mutated);await assert.rejects(()=>P.unzip(new Blob([mutated])),undefined,label);}
await assert.rejects(()=>P.zip([['character.json',new Blob(['{}'])],['character.json',new Blob(['{}'])]]),/duplicate/i);
await assert.rejects(()=>P.zip(Array.from({length:10001},(_,i)=>['media/'+i,new Blob()])),/limit/i);
// Metadata limits must use UTF-8 bytes, matching the import limit, not JS characters.
await assert.rejects(()=>P.pack({description:'界'.repeat(12*1024*1024)}),/metadata.*32 MB/i);
// Python zipfile DEFLATE fixtures, including a streamed data descriptor and ZIP comment.
for(const encoded of [
 'UEsDBBQAAAAIAOAYLV00JfsHUQAAAFgAAAAOAAAAY2hhcmFjdGVyLmpzb24VzDsOgCAQBcCrmFdLYUvrSTa4CFE+WT4xIdxdraabAZskUIWGS3Kwci1QVJnMRSdjRWcpPkXobQWJcb4z9ECk8IldUikq31T/ZrH+qU0Yc75QSwECFAMUAAAACADgGC1dNCX7B1EAAABYAAAADgAAAAAAAAAAAAAAgAEAAAAAY2hhcmFjdGVyLmpzb25QSwUGAAAAAAEAAQA8AAAAfQAAAB8AUHl0aG9uIHppcGZpbGUgaW50ZXJvcGVyYWJpbGl0eQ==',
 'UEsDBBQACAAIAOAYLV0AAAAAAAAAAAAAAAAOAAAAY2hhcmFjdGVyLmpzb24VzDsOgCAQBcCrmFdLYUvrSTa4CFE+WT4xIdxdraabAZskUIWGS3Kwci1QVJnMRSdjRWcpPkXobQWJcb4z9ECk8IldUikq31T/ZrH+qU0Yc75QSwcINCX7B1EAAABYAAAAUEsBAhQDFAAIAAgA4BgtXTQl+wdRAAAAWAAAAA4AAAAAAAAAAAAAAIABAAAAAGNoYXJhY3Rlci5qc29uUEsFBgAAAAABAAEAPAAAAI0AAAAfAFB5dGhvbiB6aXBmaWxlIGludGVyb3BlcmFiaWxpdHk=',
])assert.equal((await P.unpack(new Blob([Buffer.from(encoded,'base64')]))).name,'Cross-platform fixture');
const nearLimit=new Blob([new Uint8Array(900)]),lives=[{worldId:'fixture',data:nearLimit}];
assert.equal(P.validateLifeArchives(lives,1024),900);
assert.equal(P.validateLifeArchives([{worldId:'fixture',data:Buffer.alloc(900).toString('base64')}],1024),900);
assert.throws(()=>P.validateLifeArchives([...lives,{worldId:'other',data:new Blob([new Uint8Array(125)])}],1024),/combined limit/);
assert.throws(()=>P.validateLifeArchives([...lives,...lives]),/duplicate/);
const lifeFiles=await P.unzip(await P.lifeUpload({companionId:'copy',importId:'receipt',archives:lives}));
assert.equal(lifeFiles.get('lives/0.gz').size,900);assert.equal(JSON.parse(await lifeFiles.get('restore.json').text()).archives[0].path,'lives/0.gz');
console.log('PASS binary media, deduplication, ZIP round-trip, corruption/header checks, matching limits, UTF-8 metadata and portable fixture output.');
})().catch(e=>{console.error(e);process.exitCode=1;});

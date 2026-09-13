'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),kernel=require('../vh2-kernel-worker'),core=require('../vh-simulation-core');
const at=Date.UTC(2026,8,12,12),profile={lifeWildcardsEnabled:true,lifeProfile:{initializedAt:at,wildcardDeck:[{id:'old',label:'Invented argument',category:'conflict'}]}};
const c=kernel.run({create:true,name:'Test',entityId:'retired',now:at,profile}).companion;
c.lifeRuntime.activeWildcard={label:'Invented argument',startedAt:at,endsAt:at+3600000,availability:'private',placeLabel:'Somewhere else'};
assert.notEqual(core.companionSituationAt(c,at).source,'wildcard');assert.equal(c.lifeProfile.wildcardDeck,undefined);
const app=fs.readFileSync('app.js','utf8'),html=fs.readFileSync('index.html','utf8');
for(const name of ['HORDE_INCLUDED_HUMANS','installIncludedHuman','ashlynSocialProfileBackfill'])assert(!app.includes(name));
for(const file of ['ashlyn-reynolds-human.js','jane-harlow-human.js']){assert(!html.includes(file));assert(!fs.existsSync(file));}
kernel.run({companion:c,now:at+3600000});assert(!c.lifeEvents.some(e=>e.text==='Invented argument'));
assert.equal(core.normalizeCompanionLifeEvent({id:'old-record',text:'Previously recorded event',createdAt:at,source:'autonomy'}).text,'Previously recorded event');
console.log('PASS retired wildcard cannot override state or emit events; no bundle installer/catalog; historical event reading retained.');

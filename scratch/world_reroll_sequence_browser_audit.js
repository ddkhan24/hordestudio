/** Browser regression: successful turn, failed reroll, successful reroll, reload. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, launchOptions } = require('./browser_runtime').browserRuntime();
const root = path.resolve(__dirname, '..');

(async () => {
    const browser = await chromium.launch(launchOptions);
    try {
        const context = await browser.newContext();
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'reroll-sequence.test') return route.abort();
            const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
            if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404,body:''});
            return route.fulfill({contentType:{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
        });
        const page = await context.newPage();
        await page.goto('https://reroll-sequence.test/');
        await page.waitForFunction(() => typeof companionAgencyTimer !== 'undefined' && !!companionAgencyTimer);
        const result = await page.evaluate(async () => {
            clearInterval(companionAgencyTimer); clearInterval(companionAlwaysOnTimer);
            const world = {id:'reroll_sequence',name:'Reroll Sequence',model:'fixture/model',dmPrompt:'Briefly narrate.',
                intro:'',startLocationId:'hall',locations:[{id:'hall',name:'Hall',exits:[]}],entities:[],
                kernel:{enabled:true,memoryMode:'ledger',resolveFirst:false,sceneDrafts:false},
                hudConfig:{showClock:true,showQuests:false,showLedger:true,stats:[]}};
            state.worlds=[world]; state.worldInstances={reroll_sequence:{sessions:[],activeSessionId:null}};
            state.activeWorldId=world.id; state.apiKey='offline-fixture';
            const sess=prepareCurrentWorldSession(); sess.setupComplete=true;
            sess.inventory=['letter']; sess.outfit='linen shirt, blue coat';
            sess.history.push({id:'opening',role:'dm',text:'You are in the hall.',location:'hall'});
            switchView('worldPlay'); renderWorldPlayState();
            let mode='first'; let requests=0;
            const receipt={summary:'Waiting acknowledged.',scene:{player_location_id:'hall',player_location_changed:false,present_character_ids:[]},
                events:[{type:'interaction',actor_id:'player',status:'completed',action:'wait and listen',
                    evidence:'The player waits and listens in the hall.'}],entity_updates:[],state_updates:{}};
            const realFetch=window.fetch;
            window.fetch=async (url,options={}) => {
                if (!String(url).includes('/chat/completions')) return realFetch(url,options);
                requests++;
                if (mode==='fail') return new Response('provider failure',{status:503});
                const text=mode==='first'?'You wait and listen in the hall.':'You listen to the quiet hallway.';
                const content=`${text}\n<world_turn_receipt>${JSON.stringify(receipt)}</world_turn_receipt>`;
                const body=JSON.parse(options.body||'{}');
                if (body.stream) return new Response(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,{status:200,headers:{'Content-Type':'text/event-stream'}});
                return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(receipt)},finish_reason:'stop'}]}),{status:200,headers:{'Content-Type':'application/json'}});
            };
            document.getElementById('world-user-input').value='I wait and listen.';
            await executeWorldTurn();
            const snapshot=() => ({version:sess.worldStateVersion,location:sess.playerLocation,
                inventory:(sess.inventory||[]).map(item=>item.name||item),outfit:sess.outfit,
                history:sess.history.map(item=>({role:item.role,text:item.text})),
                versions:sess.history.at(-1)?.versions?.length||1});
            const first=snapshot();
            mode='fail'; await executeWorldTurn(true); const failed=snapshot();
            mode='second'; await executeWorldTurn(true); const second=snapshot();
            await saveState();
            const persisted=(await HordeDB.get('worldInstance:reroll_sequence'))?.sessions?.[0];
            window.fetch=realFetch;
            return {first,failed,second,requests,persisted:{version:persisted?.worldStateVersion,
                location:persisted?.playerLocation,inventory:persisted?.inventory?.map(item=>item.name||item),outfit:persisted?.outfit,
                versions:persisted?.history?.at(-1)?.versions?.length||1}};
        });
        assert.equal(result.first.version,1,JSON.stringify(result));
        assert(result.first.history.at(-1).text.includes('You wait and listen in the hall.'),
            'the original turn must be a genuinely accepted response');
        assert.deepEqual(result.failed,result.first,'failed reroll must preserve selected take and canonical state');
        assert.equal(result.second.version,1,'reroll must replace, not stack, the first commit');
        assert(result.second.history.at(-1).text.includes('You listen to the quiet hallway.'),
            'the replacement must be a genuinely accepted response');
        assert.equal(result.second.versions,2);
        assert.equal(result.second.location,'hall');
        assert.deepEqual(result.second.inventory,['letter']);
        assert.equal(result.second.outfit,'linen shirt, blue coat');
        assert.deepEqual(result.persisted,{version:1,location:'hall',inventory:['letter'],outfit:'linen shirt, blue coat',versions:2});
        await page.reload();
        const loaded=await page.evaluate(async()=>{const value=await HordeDB.get('worldInstance:reroll_sequence');const s=value?.sessions?.[0];return {version:s?.worldStateVersion,location:s?.playerLocation,inventory:s?.inventory?.map(item=>item.name||item),outfit:s?.outfit,versions:s?.history?.at(-1)?.versions?.length||1};});
        assert.deepEqual(loaded,result.persisted,'reload must preserve exactly one successful reroll outcome');
        console.log('PASS reroll success → failed reroll → successful reroll → save/reload; one canonical version and two takes');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});

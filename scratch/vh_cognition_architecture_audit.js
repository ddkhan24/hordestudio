'use strict';
const {spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser_runtime').browserRuntime();
const cognition=require('../virtual_humans/engine/vh-cognition-engine');
const kernel=require('../virtual_humans/engine/vh2-kernel-worker');

const gifted=cognition.normalizeProfile({enabled:true,iq:145,axes:{socialInference:22,executiveFunction:36},details:{expertise:'Number theory',gaps:'Popular culture'}});
const resolved=cognition.resolvedAxes(gifted);
assert.equal(cognition.iqLabel(145),'Exceptional / genius-level');
assert(resolved.abstractReasoning>90,'Overall anchor derives strong abstract reasoning.');
assert.equal(resolved.socialInference,22,'A specific uneven ability overrides the overall anchor.');
assert.equal(resolved.executiveFunction,36,'Planning can differ from general reasoning.');
assert(cognition.activityScore(gifted,{label:'Research and solve a difficult logic puzzle'})>15);
assert.equal(cognition.activityScore(gifted,{label:'Take a quiet shower'}),0,'Unrelated ordinary actions are not intelligence-gated.');
assert(cognition.mechanics(gifted).decisionTemperatureMultiplier<1,'Stronger planning mildly reduces choice noise.');
assert.match(cognition.prompt(gifted),/not a clinical score or diagnosis/i);
assert.match(cognition.prompt(gifted),/High reasoning does not mean perfect judgment/i);

const now=Date.parse('2026-09-20T12:00:00Z');
let human=kernel.run({create:true,name:'Inez',entityId:'cognition-action',now,profile:{age:29,cognitionProfile:gifted,lifeProfile:{places:[{id:'home',label:'Home',kind:'home'}],weeklySchedule:[],activityOptions:[{id:'puzzle',label:'Research and solve a difficult logic puzzle',kind:'focus',startMinute:0,endMinute:1440,priority:30,durationMinutes:30},{id:'shower',label:'Take a quiet shower',kind:'leisure',startMinute:0,endMinute:1440,priority:30,durationMinutes:30}],sleepPolicy:{enabled:false}}}}).companion;
human.vh2Decision.choice=null;human.vh2Decision.policy={...human.vh2Decision.policy,temperature:0,exploration:0};
for(let step=1;step<=3&&!human.vh2Decision?.choice;step++)human=kernel.run({companion:human,now:now+step*60000}).companion;
assert.equal(human.cognitionContext.axes.socialInference,22);
const candidates=human.vh2Decision.choice.candidates;
assert(candidates.find(row=>row.id.includes(':puzzle:')).components.cognition>15);
assert(human.vh2Decision.choice.goalId.includes(':puzzle:'),'Cognitive task fit reaches actual VH2 action selection.');

(async()=>{const server=spawn(process.env.HORDE_PYTHON_EXECUTABLE||'python3',['scratch/vh2_browser_server.py'],{stdio:['ignore','pipe','pipe']});let browser;
try{
 const port=await new Promise((resolve,reject)=>{server.stdout.once('data',data=>resolve(+String(data).trim()));server.stderr.on('data',data=>process.stderr.write(data));server.once('exit',code=>reject(Error('server '+code)));});
 const base=`http://127.0.0.1:${port}`;browser=await chromium.launch(launchOptions);const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
 await page.goto(base+'/index.html');await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);
 const id=await page.evaluate(()=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);hideGlobalSettings();const c=normalizeCompanion({id:'cognition-ui',name:'Inez',age:29});state.companions=[c];state.companionTimelines={};state.companionThreads={};ensureCompanionTimelineStore(c.id);openCompanionStudio(c.id);switchView('companionStudio');activateCompanionStudioTab('cs-mind');return c.id;});
 assert(await page.locator('.vh-cognition-studio').isVisible());assert.equal(await page.locator('[data-cognition-axis-row]').count(),11);
 await page.locator('#cs-cognition-enabled').check();const iq=page.locator('#cs-cognition-iq');await iq.fill('145');await iq.dispatchEvent('change');assert.match(await page.locator('#cs-cognition-iq-out').innerText(),/145 · Exceptional/);
 const social=page.locator('[data-cognition-axis="socialInference"]');await social.fill('22');assert.match(await page.locator('[data-cognition-axis-row="socialInference"] small').innerText(),/manual/);
 await page.locator('summary').filter({hasText:'Knowledge, learning & blind spots'}).click();await page.locator('#cs-cognition-expertise').fill('Number theory and railway timetables.');await page.locator('#cs-cognition-gaps').fill('Popular culture and celebrity news.');await page.locator('#cs-cognition-blindspots').fill('Overcomplicates ordinary explanations.');
 await page.locator('#save-companion-btn').click();await page.waitForFunction(()=>document.getElementById('vh-save-status').textContent.startsWith('Saved'));await page.reload();await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});await page.waitForFunction(()=>typeof companionAgencyTimer!=='undefined'&&!!companionAgencyTimer);await page.evaluate(id=>{clearInterval(companionAgencyTimer);clearInterval(companionAlwaysOnTimer);hideGlobalSettings();openCompanionStudio(id);switchView('companionStudio');activateCompanionStudioTab('cs-mind');},id);
 assert.equal(await page.locator('#cs-cognition-iq').inputValue(),'145');assert.equal(await page.locator('[data-cognition-axis="socialInference"]').inputValue(),'22');await page.locator('summary').filter({hasText:'Knowledge, learning & blind spots'}).click();assert.equal(await page.locator('#cs-cognition-expertise').inputValue(),'Number theory and railway timetables.');
 await page.evaluate(id=>{state.activeCompanionId=id;openCompanionSimulationDetails();},id);assert.match(await page.locator('[data-cognition-diagnostics]').innerText(),/145 · Exceptional/);assert.match(await page.locator('[data-cognition-diagnostics]').innerText(),/Number theory/);assert.match(await page.locator('[data-cognition-diagnostics]').innerText(),/Social inference\s+22/);
 await page.locator('#close-companion-simulation-btn').click();for(const width of [1040,390]){await page.setViewportSize({width,height:850});await page.evaluate(id=>{openCompanionStudio(id);activateCompanionStudioTab('cs-mind');},id);const overflow=await page.locator('.vh-cognition-studio').evaluate(node=>node.scrollWidth-node.clientWidth);assert(overflow<=2,`Cognition editor overflows by ${overflow}px at ${width}px`);}
 assert.deepEqual(errors,[]);console.log('PASS cognition: IQ-style anchor, 11 independent dimensions, expertise/gaps, persistence, provider context, responsive UI and actual VH2 decision mechanics.');
}finally{await browser?.close();server.kill('SIGTERM');}})().catch(error=>{console.error(error);process.exitCode=1;});

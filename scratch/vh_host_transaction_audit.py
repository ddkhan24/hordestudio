"""Offline host transaction tests using the real shared JS worker and mocked provider."""
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import horde_mcp_bridge as bridge
root = Path(__file__).resolve().parent.parent
runtime = bridge.AlwaysOnRuntime(queue_file=Path(tempfile.mkdtemp()) / 'queue.json', start_thread=False)
node = runtime._node_path()
assert node, 'Node runtime required for host integration audit'
now = 1788782400000
script = r"""
const vm=require('node:vm');const {buildContext}=require('./scratch/app_source');
const x={console,state:{globalSettings:{},personas:[],companions:[],companionThreads:{},companionTimelines:{}}};
buildContext(vm,['normalizeCompanion'],x);const t=Number(process.argv[1]);
const c=x.normalizeCompanion({id:'host',name:'Ada',age:28,locationMode:'custom',timezoneOffsetMinutes:0,
 humanDynamics:{lastUpdated:t,energy:90},mood:{lastUpdated:t,valence:0},emotionState:{lastUpdated:t},
 continuityRuntime:{lastExchangeAt:t-1000,revision:0},
 lifeRuntime:{temporarySituation:{activity:'relaxing at home',availability:'available',startedAt:t-60000,endsAt:t+3600000}}});
process.stdout.write(JSON.stringify({companion:c,messages:[{id:'u',role:'user',type:'text',text:'Cafe?',timestamp:t-500,deliveredAt:t-500,awaitingReply:true}],experience:{realTimeLife:true,replyDelays:true,allowNoReply:true}}));
"""
snapshot = json.loads(subprocess.check_output([node,'-e',script,str(now)],cwd=root,text=True))
# Future-delivered and media messages must never be silently consumed.
probe = copy.deepcopy(snapshot)
probe['now'] = now
probe['messages'].append({'id':'future','role':'user','type':'text','text':'Later',
                         'timestamp':now+60000,'deliveredAt':now+60000,'awaitingReply':True})
result = json.loads(subprocess.check_output([node, str(root/'vh-host-worker.js')], input=json.dumps(probe), text=True))
assert 'future' not in result['replyIds']
probe['messages'][0]['type'] = 'photo'
result = json.loads(subprocess.check_output([node, str(root/'vh-host-worker.js')], input=json.dumps(probe), text=True))
assert result['due'] is False and result['messages'][0]['awaitingReply']
print('PASS future messages are excluded from the reply batch and attachments stay pending for the browser')
manifest = {'enabled':True,'clientId':'test','handoffSeconds':45,'dailyLimit':6,'humans':[{
 'id':'host','name':'Ada','timelineId':'a','messagesEnabled':True,'socialEnabled':False,'hasSpoken':True,
 'stateRevision':0,'snapshotId':'a:0:u','baseMessageIds':['u'],'simulation':snapshot,
 'provider':{'baseUrl':'https://example.invalid','headers':{'Authorization':'SECRET_TEST_TOKEN'},'model':'offline'}}]}
real_time = bridge.time.time
bridge.time.time = lambda: now/1000
try:
 runtime.sync(copy.deepcopy(manifest));runtime.last_heartbeat-=100
 calls=[]
 def generate(human,kind):
  calls.append(kind)
  assert human['pendingIds']==['u']
  return {'decision':'message','text':'Cafe sounds good. Which one?', 'state':{'valence_change':6,'arousal_change':2,'mood_label':'happy','conversation':{'topic':'Cafe plans','reaction':{'summary':'Looking forward to making plans','evidence':'Cafe?','lingerMinutes':30}}},'next_check_minutes':120}
 runtime._generate=generate
 runtime._tick()
 events=runtime.pending_events('test');assert len(events)==1
 event=events[0];assert event['consumedMessageIds']==['u']
 assert event['simulation']['companion']['mood']['valence']==6
 assert event['affectCommitted'] is True
 assert event['simulation']['companion']['continuityRuntime']['conversation']['reaction']['sourceMessageId']=='u'
 assert event['simulation']['messages'][0]['awaitingReply'] is False
 runtime._tick();assert calls==['message']
 disk=runtime.queue_file.read_text();assert 'SECRET_TEST_TOKEN' not in disk
 restored=bridge.AlwaysOnRuntime(queue_file=runtime.queue_file,start_thread=False)
 assert restored.pending_events('test')[0]['id']==event['id']
 print('PASS host uses shared attention, commits affect, consumes one batch, persists a credential-free transaction, and does not repeat it')
 runtime.acknowledge([event['id']]);runtime.sync(copy.deepcopy(manifest));runtime.last_heartbeat-=100
 def reclaim(human,kind):
  runtime.sync(copy.deepcopy(manifest))
  return {'decision':'message','text':'Must be discarded'}
 runtime._generate=reclaim;runtime._tick();assert not runtime.pending_events('test')
 print('PASS reopening the browser during generation rejects the worker result')
 runtime.last_heartbeat-=100
 def stop(human,kind):
  runtime.stop();return {'decision':'message','text':'Must also be discarded'}
 runtime._generate=stop;runtime._tick();assert not runtime.pending_events('test')
 print('PASS stopping background agency during generation prevents publication')
finally:
 bridge.time.time=real_time
 runtime.stop()
# Live routing stays at the host I/O boundary and is applied by the shared kernel.
from unittest.mock import patch
route_snapshot=copy.deepcopy(snapshot)
rc=route_snapshot['companion']
rc['lifeProfile']['world']['transport'].update({'enabled':True,'liveRouting':True})
rc['lifeProfile']['places']=[{'id':'home','label':'Home','kind':'home','googlePlaceId':'origin'}, {'id':'gym','label':'Gym','kind':'other','googlePlaceId':'destination'}]
rc['lifeProfile']['travelLegs']=[{'from':'home','to':'gym','mode':'WALK','minutes':20,'cost':0}]
rc['lifeRuntime']['world'].update({'started':True,'lastAt':now,'placeId':'home','journey':{'id':'host-route','from':'home','to':'gym','toLabel':'Gym','mode':'WALK','departedAt':now,'arrivesAt':now+1200000,'targetStart':now+1800000,'targetEnd':now+3600000,'cost':0}})
route_human={'simulation':route_snapshot}
with patch.object(bridge,'maps_request',return_value={'routes':[{'duration':'600s','distanceMeters':900}]}) as maps:
    result=runtime._simulation(route_human,now)
    assert result['companion']['lifeRuntime']['world']['journey']['arrivesAt']==now+600000
    assert result['companion']['lifeRuntime']['world']['journey']['routeStatus']=='live'
    runtime._simulation(route_human,now)
    assert maps.call_count==1
print('PASS host live-route I/O applies once through the shared worker without paid calls')
closed=copy.deepcopy(snapshot)
closed['companion']['lifeProfile']['world']['frame']['mode']='private_social'
closed_result=runtime._simulation({'simulation':closed},now)
assert not closed_result['due'] and not closed_result['available']
print('PASS closed-profile connection gate blocks background replies and proactive availability')
# Basic player details and follow-through use the same persistence path in the host.
probe = copy.deepcopy(snapshot)
probe['now'] = now
probe['companion']['continuityRuntime']['playerPersonaId'] = 'london-profile'
probe['messages'] = [{'id':'home-fact','role':'user','type':'text','text':'I live in London',
                      'timestamp':now-1000,'deliveredAt':now-1000,'readAt':now-500,'awaitingReply':False}]
probe['companion']['lifeRuntime']['world']['followups'] = [
    {'id':'gift:host','text':'Opened a gift','status':'pending','dueAt':now-1000,'expiresAt':now+3600000}]
probe['commit'] = {'text':'I opened your gift this morning.',
                   'state':{'conversation':{'followThrough':{'id':'gift:host','evidence':'I opened your gift'}}}}
result = json.loads(subprocess.check_output([node,str(root/'vh-host-worker.js')],input=json.dumps(probe),text=True))
assert 'London' in result['dialogueGuidance']
assert result['companion']['continuityRuntime']['playerFacts'][0]['personaId'] == 'london-profile'
assert result['companion']['lifeRuntime']['world']['followups'][0]['status'] == 'addressed'
print('PASS host persists persona-scoped basic facts and resolves only evidenced follow-through')
# Explicit first-contact scenarios do not require an earlier player message.
probe = copy.deepcopy(snapshot)
probe['now'] = now
probe['messages'] = []
probe['companion']['initiativeMode'] = 'balanced'
probe['companion']['lifeProfile']['world']['frame'].update({'openerMode':'vh_first','openingDelayMinutes':0,'openerScenario':'Introduce yourself after a match.'})
probe['companion']['continuityRuntime']['originScenarioConsumedAt'] = 0
result = json.loads(subprocess.check_output([node,str(root/'vh-host-worker.js')],input=json.dumps(probe),text=True))
assert result['openingDueAt'] == now
assert 'first conversation' in result['dialogueGuidance']
probe['companion'] = result['companion']
probe['commit'] = {'text':'Hey, good to meet you.','state':{}}
result = json.loads(subprocess.check_output([node,str(root/'vh-host-worker.js')],input=json.dumps(probe),text=True))
assert result['openingDueAt'] == 0
assert result['companion']['continuityRuntime']['originScenarioConsumedAt'] == now
print('PASS explicit first contact works in the host and is consumed once')
# A real host handoff is delivered once, and discarded if generation outlives it.
for expires in [False, True]:
    handoff_snapshot=copy.deepcopy(snapshot)
    hc=handoff_snapshot['companion']
    hc['initiativeMode']='balanced'
    hc['humanDynamics']['sleep']={'stage':'winding_down','pressure':85,'lastAt':now,'windDownAt':now-300000,'lastWakeAt':now-57600000}
    handoff_snapshot['messages']=[{'id':'u','role':'user','type':'text','text':'Long day?', 'timestamp':now-1000}, {'id':'c','role':'companion','type':'text','text':'yeah','timestamp':now-500}]
    handoff_manifest=copy.deepcopy(manifest)
    handoff_manifest['humans'][0]['simulation']=handoff_snapshot
    hr=bridge.AlwaysOnRuntime(queue_file=Path(tempfile.mkdtemp())/'queue.json',start_thread=False)
    clock=[now/1000]
    with patch.object(bridge.time,'time',side_effect=lambda:clock[0]):
        hr.sync(handoff_manifest);hr.last_heartbeat-=100
        def farewell(human,kind):
            assert human['handoff'] and 'sign-off' in human['dialogueGuidance']
            if expires:clock[0]+=600
            return {'decision':'message','text':'night','state':{}}
        hr._generate=farewell;hr._tick()
        published=hr.pending_events('test')
        assert len(published)==(0 if expires else 1)
        if published:assert published[0]['simulation']['companion']['continuityRuntime']['lastHandoffKey']
        hr.stop()
print('PASS background farewell reaches the transaction queue once; an expired farewell is discarded')

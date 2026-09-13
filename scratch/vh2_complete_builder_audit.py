"""Executable full-life proposals, atomic failure and reload without providers."""
from vh2_lifestyle_audit import Lifestyle
import json,unittest

class CompleteBuilder(Lifestyle):
 def test_accepted_life_descriptions_survive_save_tick_and_replay(self):
  keys=('fashionSense','grooming','foodHabits','mediaHabits','moneyPattern','healthRoutine','digitalLife','seasonalVariation')
  # The service accepts 4,000 Unicode characters per field. Include astral
  # characters so JS UTF-16 slicing cannot silently shorten a valid proposal.
  prose=('Ordinary routines have context. '*150)[:3998]+'🌿.'
  self.assertEqual(len(prose),4000)
  proposal={key:prose for key in keys}
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=0,proposal=proposal)
  self.cmd('advance',steps=2)
  c=self.state()['truth']['companion']
  for key in keys:self.assertEqual(c['lifeProfile'][key],prose,key)
  self.assertEqual(self.state(),self.s.replay(self.w))
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',version=2,baseSetupVersion=c['vh2SetupVersion'],proposal={'grooming':prose+'x'})
  self.assertEqual(before,self.state(),'oversized changes remain atomic')
 def draft(self):
  c=self.state()['truth']['companion']
  return {'version':2,'baseSetupVersion':c.get('vh2SetupVersion',0),'proposal':{
   'finance':{'enabled':True,'startingBalance':250,'incomePerHour':0,'dailyIncome':0,'dailyExpense':0,'workPlaceIds':[]},
   'possessions':[{'id':'phone','name':'Dark green phone','category':'object','description':'A dark green phone with a scratched matte case','tags':['phone']}],
   'referencePlan':[{'id':'phone-ref','role':'prop','entityId':'phone','view':'front','description':'Dark green phone with a scratched matte case','label':'Everyday phone'}],
   'expression':{'personality':'Outgoing but considerate; enjoys swimming and low-key gatherings.','appearance':'Short brown curls and hazel eyes','regulationProfile':'steady','emotionExpression':'transparent'},
   'places':[{'id':'cafe','label':'Neighbourhood café','kind':'social','encounterScope':'nearby'},{'id':'pool','label':'Apartment pool','kind':'social','encounterScope':'nearby'}],
   'socialCircle':[{'id':'jo','name':'Jo','role':'friend','relationship':'friend','appearance':'Dark curls','age':24}],
   'peopleLives':[{'personId':'jo','initialPlaceId':'away','startingBalance':60,'policy':{'homePlaceId':'away','foodPlaceIds':['cafe'],'leisurePlaceIds':['pool','cafe'],'paidPlaceIds':[],'modes':['WALK'],'ownsCar':False,'ownsBicycle':False,'curiosity':70,'conscientiousness':60,'temperature':8,'sleepStart':23,'sleepEnd':7,'mealCost':4,'incomePerHour':0,'dailyExpense':0}}],
   'routes':[{'from':a,'to':b,'mode':'WALK','minutes':5,'cost':0} for a,b in [('home','cafe'),('cafe','home'),('away','cafe'),('cafe','away'),('home','pool'),('pool','home')]],
   'autonomy':{'enabled':True,'spontaneousExpression':True,'socialPosting':True,'liveWeather':False},
   'socialPolicy':{'encountersEnabled':True,'groupPlansEnabled':True,'introductionsEnabled':True,'sociability':80,'openness':65,'dispositions':{'jo':{'sociability':75,'openness':60}}},
   'socialPlanPolicy':{'enabled':True,'remoteInvitations':True,'hostedEvents':True,'privateVisits':False},
   'geography':{'enabled':True,'maxTravelMinutes':40,'places':[{'placeId':'cafe','capabilities':['food','leisure'],'mealCost':7,'access':'public'}]},
   'population':{'enabled':True,'openness':65,'fictional':{'enabled':True,'targetCount':2,'seed':'neighbourhood','homePlaceIds':['away'],'publicPlaceIds':['cafe'],'ageMin':22,'ageMax':35}},
   'healthPolicy':{'enabled':True,'illnessRatePerYear':2,'recoveryScale':1},
   'psychologyPolicy':{'learningRate':.3,'emotionalImpact':.8},
   'relationshipPolicy':{'friendliness':80,'guardedness':25,'trustOpenness':65},
  }}
 def test_complete_draft_is_executable_and_persistent(self):
  self.cmd('apply_life_proposal',**self.draft())
  self.cmd('advance',steps=3)
  s=self.state();c=s['truth']['companion']
  self.assertEqual(c['regulationProfile'],'steady');self.assertEqual(c['vh2Agency']['policy']['enabled'],True)
  self.assertTrue(c['socialFeedEnabled']);self.assertTrue(c['vh2Geography']['enabled']);self.assertTrue(c['vh2Plans']['policy']['enabled'])
  self.assertIn('jo',c['vh2People']['actors']);self.assertEqual(c['vh2People']['network']['dispositions']['jo']['sociability'],75)
  self.assertEqual(c['vh2Psychology']['relationshipPolicy']['guardedness'],25);self.assertEqual(c['vh2Health']['policy']['illnessRatePerYear'],2)
  self.assertEqual(c['lifeRuntime']['world']['balance'],250)
  self.assertIn('phone',c['lifeRuntime']['world']['inventory'])
  self.assertEqual(next(i for i in c['lifeProfile']['world']['items'] if i['id']=='phone')['referenceDescription'],'A dark green phone with a scratched matte case')
  from vh2_assets import reference_prompt,reference_subjects
  self.assertIn('scratched matte case',reference_prompt('prop','front',reference_subjects(c)['prop']['phone']))
  self.assertEqual(s,self.s.replay(self.w))
  self.assertFalse(c.get('vh2ImagePolicy',{}).get('enabled',False),'Life generation must not enable paid rendering')
 def test_invalid_late_section_rolls_back_person_and_world(self):
  before=self.state();draft=self.draft();draft['proposal']['socialPlanPolicy']['unsupported']=True
  with self.assertRaises(ValueError):self.cmd('apply_life_proposal',**draft)
  self.assertEqual(before,self.state())
 def test_personality_policies_do_not_reset_funds_or_history(self):
  self.cmd('apply_life_proposal',**self.draft());before=self.state()['truth']['companion']['vh2People']['actors']['jo']
  revision=self.state()['truth']['companion']['vh2SetupVersion']
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=revision,proposal={'expression':{'personality':'Quiet, thoughtful, prefers one-to-one company'},'socialPolicy':{'sociability':20,'openness':30,'dispositions':{'jo':{'sociability':35}}}})
  c=self.state()['truth']['companion'];self.assertEqual(c['vh2Agency']['policy']['sociability'],20)
  self.assertEqual(c['vh2People']['actors']['jo']['balance'],before['balance']);self.assertEqual(c['vh2People']['actors']['jo']['placeId'],before['placeId'])
 def test_starting_resources_cannot_refill_an_established_life(self):
  self.cmd('apply_life_proposal',**self.draft());self.cmd('advance',steps=2)
  finance={'enabled':True,'startingBalance':999,'incomePerHour':0,'dailyIncome':0,'dailyExpense':0,'workPlaceIds':[]}
  before=self.state();version=before['truth']['companion']['vh2SetupVersion']
  from vh2_runtime import Conflict
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=2,baseSetupVersion=version,proposal={'finance':finance})
  with self.assertRaises(Conflict):self.cmd('apply_life_proposal',version=2,baseSetupVersion=version,proposal={'possessions':[{'id':'another-phone','name':'Another phone','category':'object','description':'Silver phone'}]})
  self.assertEqual(self.state(),before)
 def test_chat_receives_own_health_without_private_actor_symptoms(self):
  self.cmd('apply_life_proposal',**self.draft());s=self.state();c=s['truth']['companion']
  c['vh2Health']['episode']={'label':'Feeling run-down','startedAt':s['simAt'],'endsAt':s['simAt']+86400000};c['humanDynamics']['illnessSeverity']=30
  c['vh2People']['actors']['jo']['health']={'episode':{'label':'private actor symptom'}}
  request,_=self.s.dialogue.snapshot(self.w,1,s)
  self.assertTrue(request['context']['current']['health']['feelingUnwell'])
  self.assertEqual(request['context']['current']['health']['severity'],30)
  self.assertNotIn('private actor symptom',json.dumps(request))
  c['vh2Health']['policy']['enabled']=False
  request,_=self.s.dialogue.snapshot(self.w,1,s)
  self.assertFalse(request['context']['current']['health']['feelingUnwell'])
 def test_supporting_work_is_executable_and_preserved(self):
  draft=self.draft();p=draft['proposal'];p['places'].append({'id':'studio','label':'Design studio','kind':'work'})
  p['socialPlanPolicy']['enabled']=False;p['autonomy']['spontaneousExpression']=False
  actor=p['peopleLives'][0];actor['policy'].update(paidPlaceIds=['studio'],incomePerHour=12,temperature=1,conscientiousness=100)
  actor['commitments']=[{'id':'jo-work','placeId':'studio','days':[0,1,2,3,4,5,6],'start':0,'end':1440,'activity':'Design work','flexibility':'hard'}]
  p['routes'] += [{'from':a,'to':b,'mode':'WALK','minutes':2,'cost':0} for a,b in [('away','studio'),('studio','away')]]
  self.cmd('apply_life_proposal',**draft);self.cmd('advance',steps=12)
  c=self.state()['truth']['companion'];rows=[r for r in c['lifeProfile']['world']['people'] if r['personId']=='jo']
  self.assertEqual(rows[0]['id'],'jo-work');self.assertEqual(rows[0]['flexibility'],'hard')
  self.assertGreater(c['vh2People']['actors']['jo']['balance'],60,'Work income must come from actual on-site participation')
  self.assertEqual(self.state(),self.s.replay(self.w))

if __name__=='__main__':unittest.main()

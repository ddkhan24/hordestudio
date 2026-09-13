"""AI-reviewed attendance setup reaches the existing engine without resetting history."""
import copy,datetime,json,gzip,unittest
from vh2_lifestyle_audit import Lifestyle
from vh2_runtime import Conflict
import vh2_backup

class InstitutionSetup(Lifestyle):
 def draft(self,place='home'):
  now=datetime.datetime.fromtimestamp(self.state()['simAt']/1000,datetime.timezone.utc);minute=now.hour*60+now.minute
  return {'weeklySchedule':[{'id':'seminar','activity':'History seminar','placeId':place,'days':list(range(7)),'startMinute':minute+1,'endMinute':minute+15,'flexibility':'fixed','availability':'busy'}],
   'institutions':[{'id':'seminar-attendance','label':'History seminar attendance','scheduleId':'seminar','minimumAttendance':.5,'fee':0,'missedStress':2}]}
 def apply(self,proposal):
  self.cmd('apply_life_proposal',version=2,baseSetupVersion=self.state()['truth']['companion'].get('vh2SetupVersion',0),proposal=proposal)
 def test_setup_records_actual_attendance_and_survives_archive(self):
  draft=self.draft();self.apply(draft);self.cmd('advance',steps=6)
  r=self.state()['truth']['companion']['vh2Institutions']
  self.assertEqual(r['rules'],draft['institutions']);self.assertEqual(r['events'][-1]['status'],'completed')
  self.assertGreater(r['events'][-1]['attendedMinutes'],0)
  exported=json.loads(gzip.decompress(vh2_backup.export(self.s,self.w)))['payload']['state']
  self.assertEqual(exported['truth']['companion']['vh2Institutions'],r)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_missing_real_presence_records_miss_not_invented_class(self):
  self.apply(self.draft('away'));self.cmd('advance',steps=6)
  r=self.state()['truth']['companion']['vh2Institutions']
  self.assertEqual(r['events'][-1]['status'],'missed');self.assertEqual(r['events'][-1]['attendedMinutes'],0)
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_unknown_commitment_and_duplicate_assignment_are_atomic(self):
  before=self.state();draft=self.draft();draft['institutions'][0]['scheduleId']='missing'
  with self.assertRaises(ValueError):self.apply(draft)
  self.assertEqual(before,self.state())
  draft=self.draft();draft['institutions'].append({**draft['institutions'][0],'id':'duplicate-target'})
  with self.assertRaises(ValueError):self.apply(draft)
  self.assertEqual(before,self.state())
 def test_same_rule_can_roundtrip_mid_session_but_change_cannot_rewrite_it(self):
  draft=self.draft();self.apply(draft);self.cmd('advance',steps=2)
  before=copy.deepcopy(self.state()['truth']['companion']['vh2Institutions'])
  self.apply({'institutions':draft['institutions']})
  self.assertEqual(before,self.state()['truth']['companion']['vh2Institutions'])
  changed=copy.deepcopy(draft['institutions']);changed[0]['fee']=50;state=self.state()
  with self.assertRaises(Conflict):self.apply({'institutions':changed})
  self.assertEqual(state,self.state())

if __name__=='__main__':unittest.main(verbosity=2)

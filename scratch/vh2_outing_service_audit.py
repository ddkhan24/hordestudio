"""SQLite outing replay, restart and geographic projection, entirely offline."""
from test_runtime import node_executable
import sys, tempfile, subprocess, json, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService, encode
ROOT=Path(__file__).resolve().parents[1];NODE=node_executable(ROOT)
class Outings(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.now=1788782400000;self.s=self.open('a')
    def open(self,name):return WorldService(Path(self.tmp.name)/(name+'.sqlite'),NODE,ROOT,clock=lambda:self.now)
    def tearDown(self):self.s.close();self.tmp.cleanup()
    def create(self,s):
        w=s.command({'schemaVersion':1,'key':'fixture','type':'create','name':'Alex'})
        c=json.loads(subprocess.check_output([NODE,'-e',"process.stdout.write(JSON.stringify(require('./scratch/vh_goal_outing_audit').fixture()))"],cwd=ROOT,text=True));c['id']=w['worldId']+':human'
        with s.connect() as db:
            revision,before=s.read(db,w['worldId']);after=json.loads(encode(before))
            after['truth']=s.kernel({'companion':c,'now':self.now,'inspect':True})
            s.commit_event(db,w['worldId'],revision,before,after,'TEST_OUTING_PROFILE')
        return w['worldId']
    def advance(self,s,w,steps,key):
        return s.command({'schemaVersion':1,'key':key,'type':'advance','worldId':w,'expectedRevision':s.projection(w)['revision'],'steps':steps})
    def test_restart_replay_and_expression_history(self):
        reference=self.open('reference')
        try:
            a=self.create(self.s);b=self.create(reference)
            self.advance(reference,b,12,'all')
            self.advance(self.s,a,4,'first');self.s.close();self.s=self.open('a');self.advance(self.s,a,8,'rest')
            self.assertEqual(self.s.projection(a),reference.projection(b))
            self.assertEqual(self.s.projection(a)['state'],self.s.replay(a))
            context=self.s.context(a)
            self.assertEqual(context['current']['placeId'],'home')
            self.assertTrue(any(m['summary'].startswith('Returned home') for m in context['recentExperiences']))
            self.assertTrue(any(m['summary'].startswith('Chose an outing') for m in context['recentExperiences']))
        finally:reference.close()
    def test_route_position_survives_service_restart(self):
        w=self.create(self.s)
        for step in range(8):
            self.advance(self.s,w,1,'depart-'+str(step))
            if self.s.projection(w)['state']['truth']['companion']['lifeRuntime']['world']['journey']:
                break
        with self.s.connect() as db:
            revision,before=self.s.read(db,w);after=json.loads(encode(before))
            c=after['truth']['companion'];j=c['lifeRuntime']['world']['journey']
            self.assertIsNotNone(j)
            j['geometry']=[[0,51],[0,51.01],[.01,51.01]]
            after['truth']=self.s.kernel({'companion':c,'now':after['simAt'],'inspect':True})
            self.s.commit_event(db,w,revision,before,after,'TEST_ROUTE_GEOMETRY')
        expected=self.s.projection(w)['state']['truth']['present']['position']
        self.assertEqual(expected['source'],'route');self.assertTrue(0<expected['progress']<1)
        self.s.close();self.s=self.open('a')
        self.assertEqual(self.s.projection(w)['state']['truth']['present']['position'],expected)
        self.assertEqual(self.s.projection(w)['state'],self.s.replay(w))
        self.assertEqual(self.s.context(w)['current']['movement']['to'],'park')
        self.assertNotIn('progress',self.s.context(w)['current']['movement'],'frame progress must not invalidate every dialogue job')

    def test_place_projection_keeps_real_field_names(self):
        w=self.create(self.s)
        records=self.s.entity_projection(w)['entities']
        park=next(e['data'] for e in records if e['kind']=='place' and e['id']=='park')
        self.assertEqual(park['mapCoordinates'],[.01,51.01]);self.assertIn('parentPlaceId',park)
        with self.s.connect() as db:db.execute('UPDATE entity_views SET projection_version=1')
        rebuilt=self.s.entity_projection(w)
        self.assertEqual(rebuilt['projectionVersion'],2)
        self.assertEqual(records,rebuilt['entities'])
if __name__=='__main__':unittest.main(verbosity=2)

"""Offline sparse walking-network materialization preserves real return paths."""
import sys,unittest,tempfile,subprocess,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from tools.build_world_pack import walking_routes,pedestrian_directions

class WalkingPack(unittest.TestCase):
 def test_xml_input_keeps_attribution_and_resolves_nodes_after_ways(self):
  source='<osm version="0.6"><way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/><tag k="oneway" v="yes"/></way><node id="1" lon="0" lat="0"><tag k="amenity" v="library"/><tag k="name" v="Library"/></node><node id="2" lon="0.001" lat="0"><tag k="amenity" v="cafe"/><tag k="name" v="Cafe"/></node></osm>'
  with tempfile.TemporaryDirectory() as directory:
   raw=Path(directory)/'source.osm';out=Path(directory)/'pack.json';raw.write_text(source)
   subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1]/'tools/build_world_pack.py'),str(raw),str(out),'--bbox=-1,-1,1,1','--source=OpenStreetMap / fixture'],check=True,capture_output=True)
   pack=json.loads(out.read_text());self.assertEqual(pack['routingVersion'],2);self.assertTrue(pack['source'].startswith('OpenStreetMap / fixture;'))
   self.assertEqual({(r['from'],r['to']) for r in pack['routes']},{('osm:node/1','osm:node/2'),('osm:node/2','osm:node/1')})
 def fixture(self):
  nodes={0:[0,0],1:[.001,0],2:[.0011,0]}
  places=[{'id':str(n),'_node':n,'_access':0,'mapCoordinates':xy} for n,xy in nodes.items()]
  return nodes,places
 def test_nearest_neighbor_sparsification_keeps_return_to_peripheral_home(self):
  nodes,places=self.fixture();edges={0:[(1,100)],1:[(0,100),(2,10)],2:[(1,10)]}
  routes=walking_routes(places,nodes,edges,neighbors=1);pairs={(r['from'],r['to']):r for r in routes}
  self.assertEqual(set(pairs),{('0','1'),('1','0'),('1','2'),('2','1')})
  self.assertEqual(pairs[('1','0')]['geometry'],list(reversed(pairs[('0','1')]['geometry'])))
  self.assertEqual(pairs[('1','0')]['minutes'],pairs[('0','1')]['minutes'])
 def test_one_way_pedestrian_evidence_never_becomes_reverse_route(self):
  nodes,places=self.fixture();edges={0:[(1,100)],1:[(2,10)],2:[(1,10)]}
  pairs={(r['from'],r['to']) for r in walking_routes(places,nodes,edges,neighbors=1)}
  self.assertIn(('0','1'),pairs);self.assertNotIn(('1','0'),pairs);self.assertNotIn(('2','0'),pairs)
 def test_car_and_pedestrian_directionality_are_separate(self):
  self.assertEqual(pedestrian_directions({'oneway':'yes'}),(True,True))
  self.assertEqual(pedestrian_directions({'oneway:foot':'yes'}),(True,False))
  self.assertEqual(pedestrian_directions({'oneway:foot':'-1'}),(False,True))
  self.assertEqual(pedestrian_directions({'foot:backward':'no'}),(True,False))
  self.assertEqual(pedestrian_directions({'access':'private'}),(False,False))
  self.assertEqual(pedestrian_directions({'access':'private','foot':'designated'}),(True,True))
  self.assertEqual(pedestrian_directions({'foot':'no','oneway':'no'}),(False,False))
 def test_export_capacity_and_reciprocity_hold_at_largest_region_size(self):
  nodes={n:[n*.00001,0] for n in range(500)}
  places=[{'id':str(n),'_node':n,'_access':0,'mapCoordinates':xy} for n,xy in nodes.items()]
  edges={n:[(m,1) for m in (n-1,n+1) if m in nodes] for n in nodes}
  routes=walking_routes(places,nodes,edges);pairs={(r['from'],r['to']) for r in routes}
  self.assertLessEqual(len(routes),5000);self.assertEqual(len(routes),len(pairs))
  self.assertTrue(all((b,a) in pairs for a,b in pairs))

if __name__=='__main__':unittest.main(verbosity=2)

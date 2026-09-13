import sys, unittest, tempfile, json, os
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
import horde_mcp_bridge as bridge
class MapsAudit(unittest.TestCase):
    def setUp(self):
        directory=tempfile.TemporaryDirectory();self.addCleanup(directory.cleanup)
        for name,value in [('CONFIG_DIR',Path(directory.name)),('AUTH_FILE',Path(directory.name)/'auth.json')]:
            mock=patch.object(bridge,name,value);mock.start();self.addCleanup(mock.stop)
    @patch.dict(bridge.os.environ, {'GOOGLE_MAPS_API_KEY':'env_key'})
    def test_settings(self):
        self.assertEqual(bridge.maps_settings_status()['source'],'environment')
        status=bridge.update_maps_settings({'googleKey':'saved_key'})
        self.assertTrue(status['configured']);self.assertEqual(status['source'],'settings')
        self.assertNotIn('saved_key',json.dumps(status))
        self.assertEqual(bridge.maps_key(),'saved_key')
        bridge.update_maps_settings({'googleKey':''})
        self.assertEqual(bridge.maps_key(),'saved_key')
        self.assertEqual(os.stat(bridge.AUTH_FILE).st_mode & 0o777,0o600)
        self.assertEqual(bridge.update_maps_settings({'remove':True})['source'],'environment')
        self.assertEqual(bridge.maps_key(),'env_key')
        with self.assertRaises(ValueError):bridge.update_maps_settings({'googleKey':'bad key'})

    @patch.dict(bridge.os.environ, {'GOOGLE_MAPS_API_KEY':'synthetic'})
    @patch.object(bridge,'json_request',return_value=(200,{}, {'places':[{'id':'test','location':{'latitude':51.5,'longitude':-.1}}]}))
    def test_search(self,call):
        result=bridge.google_maps_request('search',{'query':'gym in London'})['places'][0]
        self.assertEqual(result['id'],'test')
        self.assertEqual(result['location'],{'latitude':51.5,'longitude':-.1})
        args=call.call_args.args
        self.assertEqual(args[0],'https://places.googleapis.com/v1/places:searchText')
        self.assertEqual(args[3],{'textQuery':'gym in London','pageSize':5})
        self.assertIn('places.location',args[2]['X-Goog-FieldMask'].split(','))
    @patch.dict(bridge.os.environ, {'GOOGLE_MAPS_API_KEY':'synthetic'})
    @patch.object(bridge,'json_request',return_value=(200,{}, {'routes':[]}))
    def test_route(self,call):
        bridge.google_maps_request('route',{'origin':'abc','destination':'def','mode':'TRANSIT'})
        self.assertEqual(call.call_args.args[3]['origin'],{'placeId':'abc'})
        self.assertIn('routes.polyline.encodedPolyline',call.call_args.args[2]['X-Goog-FieldMask'])
        with self.assertRaises(ValueError): bridge.google_maps_request('route',{'origin':'https://evil','destination':'def'})
        self.assertEqual(call.call_count,1)
    @patch.dict(bridge.os.environ, {'GOOGLE_MAPS_API_KEY':''})
    @patch.object(bridge,'json_request')
    def test_missing_key(self,call):
        with self.assertRaisesRegex(ValueError,'Settings'):bridge.google_maps_request('search',{'query':'gym'})
        call.assert_not_called()
    @patch.dict(bridge.os.environ, {'GOOGLE_MAPS_API_KEY':'synthetic'})
    @patch.object(bridge,'json_request',return_value=(403,{}, {'error':{'message':'secret'}}))
    def test_provider_error(self,call):
        with self.assertRaisesRegex(ValueError,'failed \\(403\\)'):bridge.google_maps_request('search',{'query':'gym'})
    def test_ors_settings_are_separate(self):
        status=bridge.update_maps_settings({'orsKey':'ors.token==','provider':'openrouteservice'})
        self.assertTrue(status['orsConfigured']);self.assertEqual(status['provider'],'openrouteservice')
        self.assertNotIn('ors.token',json.dumps(status))
        bridge.update_maps_settings({'googleKey':'google'})
        self.assertEqual(bridge.maps_key('openrouteservice'),'ors.token==')
        self.assertFalse(bridge.update_maps_settings({'removeOrs':True})['orsConfigured'])
        self.assertEqual(bridge.maps_key(),'google')
    @patch.dict(bridge.os.environ, {'OPENROUTESERVICE_API_KEY':'ors_fixture'})
    @patch.object(bridge,'json_request',return_value=(200,{}, {'features':[{'geometry':{'coordinates':[8.6,49.4]},'properties':{'gid':'osm:venue:1','name':'Gym','label':'Gym, Heidelberg'}}]}))
    def test_ors_search_coordinates_and_header(self,call):
        data=bridge.maps_request('search',{'provider':'openrouteservice','query':'Gym in Heidelberg'})
        self.assertEqual(data['places'][0]['coordinates'],[8.6,49.4])
        self.assertEqual(data['provider'],'openrouteservice')
        self.assertTrue(call.call_args.args[0].startswith('https://api.heigit.org/pelias/v1/search?'))
        self.assertNotIn('ors_fixture',call.call_args.args[0]);self.assertEqual(call.call_args.args[2]['Authorization'],'ors_fixture')
    @patch.dict(bridge.os.environ, {'OPENROUTESERVICE_API_KEY':'ors_fixture'})
    @patch.object(bridge,'json_request',return_value=(200,{}, {'routes':[{'summary':{'duration':600.5,'distance':1400},'geometry':'_p~iF~ps|U_ulLnnqC_mqNvxq`@'}]}))
    def test_ors_route_profiles(self,call):
        for mode,profile in [('WALK','foot-walking'),('BICYCLE','cycling-regular'),('DRIVE','driving-car'),('RIDESHARE','driving-car')]:
            data=bridge.maps_request('route',{'provider':'openrouteservice','mode':mode,'originCoordinates':[8,49],'destinationCoordinates':[8.1,49.1]})
            self.assertEqual(data['routes'][0]['duration'],'600.5s')
            self.assertTrue(call.call_args.args[3]['geometry'])
            self.assertEqual(data['routes'][0]['geometry'],'_p~iF~ps|U_ulLnnqC_mqNvxq`@')
            self.assertEqual(call.call_args.args[0],f'https://api.heigit.org/openrouteservice/v2/directions/{profile}/json')
            self.assertEqual(call.call_args.args[3]['coordinates'],[[8,49],[8.1,49.1]])
    @patch.dict(bridge.os.environ, {'OPENROUTESERVICE_API_KEY':'ors_fixture'})
    @patch.object(bridge,'json_request')
    def test_ors_rejects_transit_and_bad_coordinates_before_call(self,call):
        for mode,coords in [('TRANSIT',[8,49]),('WALK',[float('nan'),49]),('WALK',[8,100]),('WALK',[None,0]),('WALK',[True,1])]:
            with self.assertRaises(ValueError):bridge.maps_request('route',{'provider':'openrouteservice','mode':mode,'originCoordinates':coords,'destinationCoordinates':[8,49]})
        call.assert_not_called()
    @patch.dict(bridge.os.environ, {'OPENROUTESERVICE_API_KEY':''})
    @patch.object(bridge,'json_request')
    def test_ors_missing_key_no_fallback(self,call):
        bridge.update_maps_settings({'provider':'openrouteservice','googleKey':'google_fixture'})
        with self.assertRaisesRegex(ValueError,'openrouteservice key'):bridge.maps_request('search',{'query':'Gym'})
        call.assert_not_called()
    @patch.dict(bridge.os.environ, {'OPENROUTESERVICE_API_KEY':'ors_fixture'})
    @patch.object(bridge,'json_request',return_value=(429,{}, {'error':'secret_credential'}))
    def test_ors_error_redaction(self,call):
        with self.assertRaisesRegex(ValueError,'429') as failure:bridge.maps_request('search',{'provider':'openrouteservice','query':'Gym'})
        self.assertNotIn('secret_credential',str(failure.exception))
if __name__=='__main__':unittest.main()

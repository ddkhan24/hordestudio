import io,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_open_airports as a
RAW=b'ident,type,name,latitude_deg,longitude_deg,scheduled_service,iata_code\nEGLL,large_airport,Heathrow,51.47,-0.45,yes,LHR\nOPKC,large_airport,Jinnah,24.9,67.16,yes,KHI\nNO,small_airport,Private,0,0,no,\n'
class Airports(unittest.TestCase):
 def test_parser(self):
  self.assertEqual(len(a.parse(RAW)),2)
  with self.assertRaises(ValueError):a.parse(b'bad')
 def test_estimate(self):
  p={'id':'london','latitude':51.5,'longitude':-0.1};q={'id':'karachi','latitude':24.85,'longitude':67.0}
  r=a.estimate(a.parse(RAW),p,q,1800000000000)
  self.assertEqual(r['origin']['code'],'LHR');self.assertEqual(r['destination']['code'],'KHI')
  self.assertGreater(r['airMinutes'],300);self.assertIn('not a verified',r['service']['source']);self.assertEqual(r['service']['cost'],0)
  self.assertGreater(r['service']['arrivesAt'],r['service']['departsAt']);self.assertEqual(r['service']['departsAt']%60000,0)
  with self.assertRaises(ValueError):a.estimate(a.parse(RAW),p,p,0)
  with self.assertRaises(ValueError):a.estimate(a.parse(RAW),{'id':'bad','latitude':float('nan'),'longitude':0},q,0)
 def test_shared_cache(self):
  with tempfile.TemporaryDirectory() as tmp:
   service=SimpleNamespace(path=Path(tmp)/'world.db')
   with patch.object(a,'fetch',return_value=RAW) as fetch:
    first,stale=a.catalogue(service);second,_=a.catalogue(service)
    self.assertEqual(first,second);self.assertFalse(stale);fetch.assert_called_once()
   path=Path(tmp)/'ourairports-cache.json';first['fetchedAt']=0;path.write_text(json.dumps(first))
   with patch.object(a,'fetch',side_effect=OSError('offline')):self.assertTrue(a.catalogue(service)[1])
unittest.main()

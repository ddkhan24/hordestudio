import sys,io,zipfile,json,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_feed_discovery import choices,discover,preview
from unittest.mock import patch

def archive(text):
 b=io.BytesIO()
 with zipfile.ZipFile(b,'w') as z:z.writestr('stops.txt',text)
 return b.getvalue()
class Discovery(unittest.TestCase):
 def test_stops(self):
  rows=choices(archive('stop_id,stop_name,location_type\na,Central,0\nb,River,\nc,Entrance,2\n'),'gtfs')['choices']
  self.assertEqual(rows,[{'id':'a','label':'Central'},{'id':'b','label':'River'}])
 def test_invalid(self):
  for raw in [b'bad',archive('stop_id,stop_name\na,One\na,Two\n')]:
   with self.assertRaises(ValueError):choices(raw,'gtfs')
 def test_scores(self):
  self.assertEqual(choices(json.dumps([{'matchID':1,'matchResults':[{'resultTypeID':7,'resultName':'Final'},{'resultTypeID':True,'resultName':'bad'}]}]).encode(),'openliga')['choices'],[{'id':'7','label':'Final'}])
  self.assertEqual(choices(b'[]','openliga'),{'choices':[]})
 def test_wrong_sports_sources(self):
  for raw,message in [(b'<html>League homepage</html>','webpage'),(b'<rss><channel/></rss>','Local news'),(b'[{"leagueId":1}]','not an OpenLigaDB match list'),(b'unavailable','valid JSON')]:
   with self.assertRaisesRegex(ValueError,message):choices(raw,'openliga')
 def test_feed_preview(self):
  with patch('vh2_feeds.fetch',return_value=b'<rss><channel><item><title>Local news</title></item></channel></rss>'):
   result=preview({'url':'https://example.org/rss'})
   self.assertTrue(result['valid']);self.assertEqual(result['titles'],['Local news'])
  with patch('vh2_feeds.fetch',return_value=b'<html>News homepage</html>'):
   with self.assertRaises(ValueError):preview({'url':'https://example.org'})
 def test_transport(self):
  with patch('vh2_feeds.fetch',return_value=b'[]') as fetch:
   self.assertEqual(discover({'kind':'openliga','url':'https://example.org'}),{'choices':[]})
   fetch.assert_called_once_with('https://example.org',limit=1000000)
  with self.assertRaises(ValueError):discover({'kind':'other'})
unittest.main()

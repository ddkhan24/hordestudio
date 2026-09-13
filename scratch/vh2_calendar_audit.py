"""Offline source timestamps are event times only for explicit VEVENT records."""
import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import vh2_calendar,vh2_feeds
class Calendar(unittest.TestCase):
 def setUp(self):self.source={'id':'s','url':'https://example.org/events.ics','placeId':'venue','tags':['music'],'calendarVenueConfirmed':True};self.now=1789030800000
 def calendar(self,extra='',start='DTSTART:20260910T120000Z',end='DTEND:20260910T140000Z'):
  return '\r\n'.join(['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:test','SUMMARY:Live music\\, tonight',start,end,extra,'END:VEVENT','END:VCALENDAR'])
 def test_explicit_times_venue_scope_and_folded_text(self):
  rows=vh2_calendar.parse(self.calendar('LOCATION:Hall\r\n  Two'),self.source,self.now);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['endsAt']-rows[0]['startsAt'],7200000);self.assertEqual(rows[0]['placeId'],'venue');self.assertEqual(rows[0]['locationText'],'Hall Two');self.assertEqual(rows[0]['title'],'Live music, tonight');self.assertEqual(rows[0]['confidence'],'unverified')
 def test_feed_adapter_requires_explicit_venue_mapping_and_updates_cancellations(self):
  source={**self.source,'freshHours':48,'calendarVenueConfirmed':False};c={}
  vh2_feeds.ingest(c,source,self.calendar(),self.now,self.now);original=c['vh2Signals']['signals'][0];self.assertIsNone(original['placeId'])
  source['calendarVenueConfirmed']=True
  vh2_feeds.ingest(c,source,self.calendar('STATUS:CANCELLED'),self.now+1,self.now+1);changed=c['vh2Signals']['signals'][0]
  self.assertEqual(len(c['vh2Signals']['signals']),1);self.assertEqual(changed['eventStatus'],'cancelled');self.assertNotEqual(changed['versionKey'],original['versionKey']);self.assertEqual(c['vh2Signals']['known'],[])
 def test_timezone_and_floating_times(self):
  self.assertEqual(vh2_calendar.parse(self.calendar(start='DTSTART:20260910T120000',end='DTEND:20260910T140000'),self.source,self.now),[])
  rows=vh2_calendar.parse(self.calendar(start='DTSTART;TZID=Europe/London:20260910T120000',end='DTEND;TZID=Europe/London:20260910T140000'),self.source,self.now);self.assertEqual(rows[0]['startsAt'],1789038000000)
 def test_cancelled_and_recurrence_not_silently_invented(self):
  self.assertEqual(vh2_calendar.parse(self.calendar('STATUS:CANCELLED'),self.source,self.now)[0]['eventStatus'],'cancelled')
  self.assertEqual(vh2_calendar.parse(self.calendar('RRULE:FREQ=WEEKLY'),self.source,self.now),[]);self.assertIn('skipped',self.source['warning'])
 def test_all_day_break_uses_source_timezone_and_exclusive_end(self):
  rows=vh2_calendar.parse(self.calendar(start='DTSTART;VALUE=DATE:20260910',end='DTEND;VALUE=DATE:20260912'),{**self.source,'timeZone':'America/Phoenix'},self.now)
  self.assertEqual(rows[0]['endsAt']-rows[0]['startsAt'],2*86400000)
  self.assertEqual(rows[0]['scope'],'publisher_claim')
 def test_unfinished_event_rejected(self):
  with self.assertRaisesRegex(ValueError,'unfinished'):vh2_calendar.parse(self.calendar().replace('END:VEVENT\r\n',''),self.source,self.now)
if __name__=='__main__':unittest.main(verbosity=2)

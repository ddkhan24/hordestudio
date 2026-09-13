"""Service gifts: exact amounts, permissions, idempotency, receipt and inventory."""
from test_runtime import node_executable
import json,sys,tempfile,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vh2_runtime import WorldService,Conflict
ROOT=Path(__file__).resolve().parents[1]
POLICY={'enabled':True,'mailAllowed':True,'cashAllowed':True,'minTrust':-100,'maxValue':1000000,'deliveryHours':0,'playerBudget':1000000}
class Gifts(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.s=self.open();profile={'age':28,'lifeProfile':{'places':[{'id':'home','label':'Home','kind':'home'}]}}
  self.w=self.s.command(dict(schemaVersion=1,key='create',type='create_profile',name='Alex',profile=profile,providerScope='horde:alex',personaId='player:alex'))['worldId']
 def open(self):return WorldService(Path(self.tmp.name)/'test.sqlite',node_executable(ROOT),ROOT,clock=lambda:1788764400000)
 def tearDown(self):self.s.close();self.tmp.cleanup()
 def state(self):return self.s.projection(self.w)['state']
 def body(self,command_type,**kwargs):return dict(schemaVersion=1,key=str(uuid.uuid4()),type=command_type,worldId=self.w,expectedRevision=self.s.projection(self.w)['revision'],**kwargs)
 def cmd(self,command_type,**kwargs):return self.s.command(self.body(command_type,**kwargs))
 def configure(self,**changes):return self.cmd('configure_gifts',currency='GBP',policy={**POLICY,**changes})
 def test_cash_amount_receipt_wallet_replay_and_restart(self):
  self.configure();balance=self.state()['truth']['companion']['lifeRuntime']['world']['balance'];balance=balance if balance is not None else self.state()['truth']['companion']['lifeProfile']['world']['transport']['budget']
  body=self.body('offer_gift',kind='cash',value=10000.25,currency='GBP')
  self.s.command(body);self.s.command(body)
  self.cmd('advance',steps=2);world=self.state()['truth']['companion']['lifeRuntime']['world']
  self.assertEqual(len(world['gifts']),1);gift=world['gifts'][0];self.assertEqual(gift['status'],'received');self.assertEqual(gift['amountMinor'],1000025)
  self.assertEqual(world['balance'],balance+10000.25);self.assertEqual(world['playerBalance'],1000000-10000.25)
  self.assertEqual(self.s.context(self.w)['receivedGifts'][0]['currency'],'GBP');self.assertEqual(self.s.context(self.w)['receivedGifts'][0]['value'],10000.25)
  before=self.state();self.assertEqual(before,self.s.replay(self.w));self.s.close();self.s=self.open();self.assertEqual(before,self.state())
 def test_permissions_currency_and_wallet_cannot_reset(self):
  self.configure(cashAllowed=False);before=self.state()
  with self.assertRaises(ValueError):self.cmd('offer_gift',kind='cash',value=10,currency='GBP')
  self.assertEqual(before,self.state());self.configure()
  for value in (0.00000001,1.001):
   with self.assertRaises(ValueError):self.cmd('offer_gift',kind='cash',value=value,currency='GBP')
  self.cmd('offer_gift',kind='cash',value=10,currency='GBP')
  before=self.state()
  with self.assertRaises(Conflict):self.cmd('configure_gifts',currency='USD',policy=POLICY)
  with self.assertRaises(Conflict):self.configure(playerBudget=999999)
  with self.assertRaises(ValueError):self.cmd('offer_gift',kind='cash',value=5,currency='EUR')
  self.assertEqual(before,self.state())
 def test_item_delivery_then_inventory(self):
  self.configure();self.cmd('add_gift_item',name='Green jacket',category='outerwear',tags=['casual','cozy'],photo='')
  item=self.state()['truth']['companion']['lifeProfile']['world']['items'][-1];self.cmd('offer_gift',kind='item',itemId=item['id'],value=40,currency='GBP')
  self.assertNotIn(item['id'],self.state()['truth']['companion']['lifeRuntime']['world']['inventory'])
  for _ in range(8):self.cmd('advance',steps=1)
  world=self.state()['truth']['companion']['lifeRuntime']['world'];self.assertIn(item['id'],world['inventory']);self.assertEqual(world['gifts'][0]['status'],'received')
  self.assertEqual(self.state(),self.s.replay(self.w))
 def test_reject_unsupported_reference(self):
  before=self.state()
  with self.assertRaises(ValueError):self.cmd('add_gift_item',name='Bad',category='top',photo='data:image/svg+xml,<svg/>')
  self.assertEqual(before,self.state())
if __name__=='__main__':unittest.main(verbosity=2)

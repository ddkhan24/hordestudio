"""Quoted simulated purchases and reviewed preset-to-item conversion."""
import json,uuid,datetime
from decimal import Decimal,ROUND_HALF_UP
COMMANDS=('refresh_fx_rate','purchase_item','convert_wardrobe_preset')
def currency(value):
 if not isinstance(value,str) or len(value)!=3 or not value.isascii() or not value.isupper() or not value.isalpha():raise ValueError('Use a three-letter uppercase currency.')
 return value

def command(service,db,world,revision,state,body):
 from vh2_runtime import encode,Conflict
 after=json.loads(encode(state));c=after['truth']['companion'];w=c['lifeRuntime']['world'];r=c.setdefault('vh2Commerce',{'quotes':{},'purchases':[],'convertedPresets':[]});kind=body['type'];local=currency(c.get('vh2Gifts',{}).get('currency','USD'))
 if kind=='refresh_fx_rate':
  foreign=currency(body.get('currency'))
  if foreign==local:raise ValueError('Local purchases do not need an exchange rate.')
  from vh2_feeds import fetch
  raw=json.loads(fetch('https://api.frankfurter.dev/v1/latest?base='+foreign+'&symbols='+local));rate=raw.get('rates',{}).get(local)
  if type(rate) not in (int,float) or not 0<rate<1000000 or raw.get('base')!=foreign:raise ValueError('The exchange-rate provider returned an invalid quote.')
  date=raw.get('date');day=datetime.date.fromisoformat(date)
  today=datetime.datetime.fromtimestamp(service.clock()/1000,datetime.timezone.utc).date()
  if not 0<=(today-day).days<=7:raise ValueError('The exchange-rate observation is stale or future-dated.')
  r['quotes'][foreign]={'base':foreign,'quote':local,'rate':rate,'date':date,'source':'Frankfurter','observedAt':service.clock(),'expiresAt':service.clock()+24*3600000}
 elif kind=='convert_wardrobe_preset':
  ident=body.get('presetId');preset=next((p for p in c['lifeProfile']['wardrobe'] if p['id']==ident),None);pieces=body.get('pieces')
  if not preset or ident in r['convertedPresets']:raise ValueError('Choose an unconverted wardrobe preset.')
  if not isinstance(pieces,list) or not 1<=len(pieces)<=12:raise ValueError('Review one to twelve garment pieces.')
  items=c['lifeProfile']['world']['items']
  if len(items)+len(pieces)>150:raise ValueError('Item capacity exceeded.')
  for piece in pieces:
   if not isinstance(piece,dict) or piece.get('category') not in ('top','bottom','dress','outerwear','underwear','shoes','accessory') or not isinstance(piece.get('name'),str) or not 1<=len(piece['name'])<=160:raise ValueError('Each reviewed piece needs a category and name.')
  categories={p['category'] for p in pieces}
  if 'dress' not in categories and not {'top','bottom'}<=categories:raise ValueError('A complete preset needs a dress or top and bottom.')
  converted_ids=[]
  for piece in pieces:
   item={'id':'converted:'+str(uuid.uuid4()),'name':piece['name'],'category':piece['category'],'tags':[preset.get('context','casual')],'warmth':1,'photo':'','owned':True,'incompatible':[],'sourcePresetId':ident};items.append(item)
   converted_ids.append(item['id'])
  r['convertedPresets'].append(ident)
  r.setdefault('conversions',[]).append({'presetId':ident,'itemIds':converted_ids,'at':state['simAt']})
 else:
  item=next((i for i in c['lifeProfile']['world']['items'] if i['id']==body.get('itemId')),None);amount=body.get('amount');foreign=currency(body.get('currency'))
  if not item or item.get('owned') or item['id'] in w['inventory'] or any(g.get('itemId')==item['id'] and g.get('status')!='declined' for g in w['gifts']):raise ValueError('Choose an unowned item that is not already being gifted.')
  if type(amount) not in (int,float) or not 0<amount<=1000000 or abs(amount*100-round(amount*100))>.00001:raise ValueError('Use a positive price with at most two decimal places.')
  quote=r['quotes'].get(foreign) if foreign!=local else {'rate':1,'base':local,'quote':local,'source':'same_currency'}
  if not quote or quote['quote']!=local or foreign!=local and quote['expiresAt']<service.clock():raise ValueError('Refresh this currency quote before purchasing.')
  minor=int((Decimal(str(amount))*Decimal(str(quote['rate']))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
  if minor<1 or minor>round((w['balance'] or 0)*100):raise ValueError('Insufficient funds or a price below the smallest accounting unit.')
  finance=c['vh2Finance'];balance=w['balance']
  if finance['trackedBalance'] is not None and abs(balance-finance['trackedBalance'])>.001:
   finance['sequence']+=1;finance['ledger'].append({'id':f"finance:{c['id']}:{finance['sequence']}",'at':state['simAt'],'kind':'life_cashflow','amountMinor':round((balance-finance['trackedBalance'])*100),'currency':local,'balanceMinor':round(balance*100),'detail':'Recorded cash changes before purchase.'})
  w['balance']=(round(balance*100)-minor)/100;item['owned']=True;w['inventory'].append(item['id']);finance['trackedBalance']=w['balance'];finance['sequence']+=1
  record={'id':str(uuid.uuid4()),'itemId':item['id'],'itemName':item['name'],'originalAmount':amount,'originalCurrency':foreign,'amountMinor':minor,'currency':local,'quote':quote,'at':state['simAt']};r['purchases'].append(record)
  finance['ledger'].append({'id':f"finance:{c['id']}:{finance['sequence']}",'at':state['simAt'],'kind':'purchase','amountMinor':-minor,'currency':local,'balanceMinor':round(w['balance']*100),'detail':'Purchased '+item['name']});finance['ledger']=finance['ledger'][-400:]
 revision=service.commit_event(db,world,revision,state,after,'COMMERCE_CHANGED',{'operation':kind});return revision,after

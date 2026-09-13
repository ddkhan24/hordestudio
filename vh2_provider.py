"""Host-only, versioned chat-completions configuration and bounded transport.
No credentials enter world snapshots, command receipts or diagnostics.
"""
import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request
import uuid

SCHEMA='''
CREATE TABLE IF NOT EXISTS dialogue_providers (
 id TEXT PRIMARY KEY, config TEXT NOT NULL, api_key TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS dialogue_provider_immutable BEFORE UPDATE ON dialogue_providers
 BEGIN SELECT RAISE(ABORT,'Provider versions are immutable'); END;
CREATE TABLE IF NOT EXISTS dialogue_usage (job_id TEXT PRIMARY KEY, at INTEGER NOT NULL);
'''
class UnknownOutcome(Exception):pass
class RejectedOutput(Exception):pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

def transport(config,key,messages):
    body={'model':config['model'],'messages':messages,'temperature':config['temperature'],
          'max_tokens':config['maxTokens'],'stream':False}
    headers={'Content-Type':'application/json'}
    if key:headers['Authorization']='Bearer '+key
    request=urllib.request.Request(config['baseUrl']+'/chat/completions',data=json.dumps(body).encode(),headers=headers,method='POST')
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=30) as response:
            raw=response.read(2*1024*1024+1)
            if len(raw)>2*1024*1024:raise RejectedOutput('Response too large')
            return json.loads(raw)
    except urllib.error.HTTPError as error:
        # A status response is known, but never echo response bodies/credentials.
        raise RejectedOutput('Provider returned HTTP '+str(error.code)) from None
    except RejectedOutput:raise
    except (ValueError,UnicodeError):raise RejectedOutput('Provider returned malformed JSON') from None
    except Exception:raise UnknownOutcome('Submission outcome unknown') from None

def parse_response(data):
    try:
        choice=data['choices'][0]
        if choice.get('finish_reason')!='stop':raise ValueError()
        message=choice['message']
        if message.get('tool_calls') or message.get('refusal'):raise ValueError()
        text=message['content']
        if isinstance(text,list):
            if any(not isinstance(p,dict) or p.get('type')!='text' or not isinstance(p.get('text'),str) for p in text):raise ValueError()
            text=''.join(p['text'] for p in text)
        if not isinstance(text,str) or not text.strip():raise ValueError()
        return text.strip()
    except (KeyError,IndexError,TypeError,ValueError):
        raise RejectedOutput('Incomplete, refused or unsupported response') from None

class ProviderStore:
    def __init__(self,service):self.service=service
    def current(self,db,scope=None):
        row=db.execute("SELECT * FROM dialogue_providers WHERE json_extract(config,'$.scope') IS ? ORDER BY rowid DESC LIMIT 1",(scope,)).fetchone()
        return dict(row) if row else None
    def status(self,scope=None):
        with self.service.connect() as db:
            row=self.current(db,scope)
            day=self.service.clock()//86400000*86400000
            used=db.execute('SELECT COUNT(*) FROM dialogue_usage WHERE at>=? AND at<?',(day,day+86400000)).fetchone()[0]
            if not row:return {'configured':False,'enabled':False,'usedToday':used}
            return {**json.loads(row['config']),'configured':True,'version':row['id'],'hasKey':bool(row['api_key']),'usedToday':used}
    def save(self,body):
        if not isinstance(body,dict):raise ValueError('Provider settings must be an object.')
        if not isinstance(body.get('baseUrl'),str):raise ValueError('API base URL is required.')
        base=body['baseUrl'].strip().rstrip('/')
        parsed=urllib.parse.urlsplit(base)
        try:
            local=parsed.hostname=='localhost' or ipaddress.ip_address(parsed.hostname or '').is_loopback
        except ValueError:local=False
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not (parsed.scheme=='https' or parsed.scheme=='http' and local):
            raise ValueError('Use an HTTPS API base URL, or HTTP for a local server, without credentials or query parameters.')
        if len(base)>2000:raise ValueError('API base URL is too long.')
        model=body.get('model')
        if not isinstance(model,str) or not 1<=len(model.strip())<=200:raise ValueError('Select a model identifier.')
        enabled=body.get('enabled',False)
        if type(enabled) is not bool:raise ValueError('enabled must be boolean.')
        limits={'maxTokens':(1,4096),'dailyLimit':(1,1000),'temperature':(0,2)}
        for key,(low,high) in limits.items():
            value=body.get(key)
            if type(value) not in (int,float) or not low<=value<=high or key!='temperature' and type(value) is not int:
                raise ValueError('Invalid '+key)
        config={'baseUrl':base,'model':model.strip(),'enabled':enabled,**{k:body[k] for k in limits}}
        scope=body.get('scope')
        if scope is not None:
            if not isinstance(scope,str) or not 1<=len(scope)<=120:raise ValueError('Invalid provider scope.')
            config['scope']=scope
        with self.service.connect() as db:
            db.execute('BEGIN IMMEDIATE');prior=self.current(db,scope)
            secret=body.get('apiKey','')
            if not isinstance(secret,str) or len(secret)>4096 or any(c in secret for c in '\r\n'):raise ValueError('Invalid API key.')
            # Never carry a credential to a changed endpoint implicitly.
            if not secret and prior and json.loads(prior['config'])['baseUrl']==base and not body.get('clearKey'):
                secret=prior['api_key']
            if not (prior and json.loads(prior['config'])==config and prior['api_key']==secret):
                db.execute('INSERT INTO dialogue_providers VALUES (?,?,?,?)',
                           (str(uuid.uuid4()),json.dumps(config,sort_keys=True),secret,self.service.clock()))
        return self.status(scope)
    def disable(self,scope):
        if not isinstance(scope,str) or not scope.startswith('horde:') or len(scope)>120:raise ValueError('Invalid Horde provider scope.')
        with self.service.connect() as db:
            db.execute('BEGIN IMMEDIATE');row=self.current(db,scope)
            if row:
                config=json.loads(row['config'])
                if config['enabled']:
                    config['enabled']=False
                    db.execute('INSERT INTO dialogue_providers VALUES (?,?,?,?)',(str(uuid.uuid4()),json.dumps(config,sort_keys=True),row['api_key'],self.service.clock()))
        return self.status(scope)

    def freeze(self,db,scope=None):
        row=self.current(db,scope)
        if not row or not json.loads(row['config'])['enabled']:raise ValueError('Configure and enable the selected dialogue provider in Horde settings first.')
        return {'version':row['id'],**json.loads(row['config'])}
    def resolve(self,db,version):
        row=db.execute('SELECT * FROM dialogue_providers WHERE id=?',(version,)).fetchone()
        if not row:raise ValueError('Provider version unavailable')
        return json.loads(row['config']),row['api_key']

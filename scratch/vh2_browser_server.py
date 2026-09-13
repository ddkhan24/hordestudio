"""Ephemeral offline-only server for the VH2 browser acceptance test."""
import sys, json
from test_runtime import node_executable
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import tempfile
from http.server import ThreadingHTTPServer
import horde_mcp_bridge as bridge
from vh2_runtime import WorldService,QUANTUM
import vh2_feeds
def fixture_feed(url):
    if url!="https://example.org/feed":raise ValueError("Offline fixture feed only")
    return b"<rss><channel><item><guid>fixture</guid><title>Local exhibition announced</title></item></channel></rss>"
vh2_feeds.fetch=fixture_feed
bridge.always_on_runtime._stop.set()
with tempfile.TemporaryDirectory() as directory:
    now=[1788764400000]
    bridge.CONFIG_DIR=Path(directory)
    bridge.vh2_service=WorldService(Path(directory)/'test.sqlite',node_executable(bridge.APP_DIR),bridge.APP_DIR,clock=lambda:now[0])
    bridge.vh2_service.image_executor=lambda *args:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    bridge.vh2_service.route_executor=lambda body:{'provider':'fixture','routes':[{'duration':'900s'}]}
    bridge.vh2_service.start()
    class Handler(bridge.BridgeHandler):
        def do_POST(self):
            if self.path=='/test/chat/completions':
                body=self.read_json()
                if body.get('model')!='browser-fixture' or self.headers.get('Authorization')!='Bearer LOCAL_TEST_KEY':
                    return self.respond(400,{'error':'Invalid fixture request'})
                context=json.loads(body['messages'][-1]['content'])
                if 'evidence' in context and 'previousTentativeReviews' in context:
                    output=json.dumps({'direction':'','unresolved':[],'basisIds':[],'suggestion':{'kind':'none','targetId':'','reason':''}})
                    return self.respond(200,{'choices':[{'finish_reason':'stop','message':{'content':output}}]})
                ready=context.get('readyMessageIds',[]);message=next((m for m in context.get('conversation',[]) if m['id'] in ready and "I'll text you in an hour." in m['text']),None)
                output='Local mock model reply'
                if message:output=json.dumps({'reply':output,'appraisals':[],'commitments':[{'sourceMessageId':message['id'],'evidence':"I'll text you in an hour.",'dueInMinutes':60,'confidence':1}]})
                return self.respond(200,{'choices':[{'finish_reason':'stop','message':{'content':output}}]})
            if self.path=='/test/kernel-version':
                bridge.vh2_service.kernel_version+='-upgrade-fixture'
                return self.respond(200,{'ok':True})
            if self.path=='/test/tick':
                now[0]+=QUANTUM
                bridge.vh2_service.tick()
                return self.respond(200,{'ok':True})
            return super().do_POST()
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    bridge.ALLOWED_ORIGINS.add('http://127.0.0.1:'+str(server.server_port))
    print(server.server_port,flush=True)
    try:server.serve_forever()
    finally:server.server_close();bridge.vh2_service.close()

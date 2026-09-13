#!/usr/bin/env python3
"""Check shipped VH2 dependencies and optionally boot an isolated timeline."""
import argparse
import ast
import re
import subprocess
import sys
import tempfile
from pathlib import Path

def verify(app):
    required={'vh-life-schema.js','vh_maps_budget.py','vh2_runtime.py','vh2-kernel-worker.js','vh2-horde-integration.js','vh2-vh1-fields.json'}
    for path in app.glob('*.py'):
        tree=ast.parse(path.read_text(),filename=str(path))
        for node in ast.walk(tree):
            names=[a.name for a in node.names] if isinstance(node,ast.Import) else [node.module or ''] if isinstance(node,ast.ImportFrom) else []
            required.update(name+'.py' for name in names if name.startswith('vh2_'))
            if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='__import__' and node.args and isinstance(node.args[0],ast.Constant):
                name=node.args[0].value
                if isinstance(name,str) and name.startswith('vh2_'):required.add(name+'.py')
    for path in app.glob('*.js'):
        for name in re.findall(r"require\(['\"]\./([^'\"]+)['\"]\)",path.read_text()):
            if name.startswith(('vh2','vh-')):required.add(name if name.endswith(('.js','.json')) else name+'.js')
    missing=sorted(name for name in required if not (app/name).is_file())
    if missing:raise ValueError('Portable VH2 dependencies missing: '+', '.join(missing))
    print('Portable VH2 dependency closure passed.',flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app',type=Path);parser.add_argument('--node',type=Path)
    args=parser.parse_args();app=args.app.resolve();verify(app)
    if args.node:
        with tempfile.TemporaryDirectory(prefix='vh2-portable-smoke-') as temporary:
            code="""
import sys
from pathlib import Path
from vh2_runtime import WorldService
s=WorldService(Path(sys.argv[2])/'test.sqlite',sys.argv[1],Path.cwd(),clock=lambda:1789030800000)
try:
 w=s.command(dict(schemaVersion=1,key='create',type='create',name='Portable fixture'))['worldId']
 p=s.projection(w)
 s.command(dict(schemaVersion=1,key='advance',type='advance',worldId=w,expectedRevision=p['revision'],steps=2))
 assert s.projection(w)['state']==s.replay(w)
 print('Packaged timeline boot, advance and replay passed.')
finally:s.close()
"""
            subprocess.run([sys.executable,'-c',code,str(args.node.resolve()),temporary],cwd=app,check=True,timeout=60)

if __name__=='__main__':main()

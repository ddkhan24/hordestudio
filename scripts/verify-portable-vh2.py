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
    required = {app / name for name in (
        'virtual_humans/__init__.py', 'virtual_humans/backend/__init__.py',
        'virtual_humans/frontend/vh-page-builder.js',
        'virtual_humans/engine/vh-life-schema.js',
        'virtual_humans/backend/vh_maps_budget.py',
        'virtual_humans/backend/vh2_runtime.py',
        'virtual_humans/engine/vh2-kernel-worker.js',
        'virtual_humans/frontend/vh2-horde-integration.js',
        'virtual_humans/engine/vh2-vh1-fields.json')}
    for path in app.rglob('*.py'):
        tree = ast.parse(path.read_text(), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith('virtual_humans.backend.'):
                        required.add(app / (alias.name.replace('.', '/') + '.py'))
            elif isinstance(node, ast.ImportFrom):
                module = node.module or ''
                if module == 'virtual_humans.backend' or (node.level and not module):
                    required.update(app / 'virtual_humans/backend' / (alias.name + '.py')
                                    for alias in node.names if alias.name != '*')
                elif module.startswith('virtual_humans.backend.'):
                    required.add(app / (module.replace('.', '/') + '.py'))
                elif node.level and module.startswith('vh'):
                    required.add(path.parent / (module.replace('.', '/') + '.py'))
    for path in app.rglob('*.js'):
        for name in re.findall(r"require\(['\"](\.[^'\"]+)['\"]\)", path.read_text()):
            dependency = path.parent / name
            if not dependency.suffix:
                dependency = dependency.with_suffix('.js')
            required.add(dependency)
    missing = sorted(str(path.relative_to(app)) for path in required if not path.is_file())
    if missing:
        raise ValueError('Portable VH2 dependencies missing: ' + ', '.join(missing))
    loose = [path.name for path in app.glob('vh*')
             if path.suffix in {'.js', '.json', '.css', '.html', '.py'}]
    assert not loose, 'Loose VH source files or compatibility shims are not allowed: ' + ', '.join(loose)
    print('Portable VH2 dependency closure passed.', flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app',type=Path);parser.add_argument('--node',type=Path)
    args=parser.parse_args();app=args.app.resolve();verify(app)
    if args.node:
        with tempfile.TemporaryDirectory(prefix='vh2-portable-smoke-') as temporary:
            code="""
import sys
from pathlib import Path
from virtual_humans.backend.vh2_runtime import WorldService
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

"""Offline validation of the shipped manual, shared knowledge and package resources."""
import importlib.util, json, re, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
text=(root/'horde-handbook.js').read_text()
book=json.loads(text.split('Object.freeze(',1)[1].rsplit(');',1)[0])
pages=book['pages']
assert len(pages)==75
assert len({p['id'] for p in pages})==len(pages)
assert sum(p['ch']=='Virtual Humans 2.0' for p in pages)>=25
assert sum(p['ch']=='Worlds' for p in pages)>=15
assert sum(bool(p.get('diagram')) for p in pages)==4
assert sum(bool(p.get('example')) for p in pages)>10
for page in pages:
    assert page['body'] and page['title'] and page['terms']
    if page.get('image'):
        image=root/page['image'];assert image.is_file() and image.stat().st_size>1000
        assert image.resolve().is_relative_to((root/'assets/manual').resolve())
assert sum(len(p['body'].split()) for p in pages)>10000
assert any('Pip’s own provider' in p['body'] for p in pages)
script=(root/'scripts/build-portable.sh').read_text()
bridge=(root/'horde_mcp_bridge.py').read_text()
for name in ['horde-handbook.js','horde-manual.js','pip-assistant.js', 'pip-knowledge.js','horde-support.css']:
    assert name in script and name in bridge and (root/name).is_file()
spec=importlib.util.spec_from_file_location('portable_package',root/'scripts/portable-package.py')
package=importlib.util.module_from_spec(spec);spec.loader.exec_module(package)
assert 'assets/manual' in package.TREES
with tempfile.TemporaryDirectory() as directory:
    package.stage_tree(root/'assets/manual',Path(directory)/'manual')
    assert len(list((Path(directory)/'manual').glob('*.webp')))==len(list((root/'assets/manual').glob('*.webp')))
print(f'PASS: {len(pages)} indexed topics, {len({p.get("image") for p in pages if p.get("image")})} screenshot assets, four workflows, and portable resource staging.')

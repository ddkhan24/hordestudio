"""Native Windows launch routing in a temporary directory containing spaces."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import venv

ROOT = Path(__file__).resolve().parents[1]

@unittest.skipUnless(os.name == 'nt', 'Requires native Windows cmd.exe')
class WindowsLaunchers(unittest.TestCase):
    def test_root_and_app_virtual_environments(self):
        with tempfile.TemporaryDirectory(prefix='Horde Windows launcher ') as temporary:
            root = Path(temporary) / 'Horde Studio portable'
            app = root / 'app'
            app.mkdir(parents=True)
            shutil.copy2(ROOT/'scripts/portable/Start Horde Studio.bat', root/'Start Horde Studio.bat')
            shutil.copy2(ROOT/'Start Horde Studio.bat', app/'Start Horde Studio.bat')
            (app/'horde_mcp_bridge.py').write_text(
                'import json,os,sys\nfrom pathlib import Path\n'
                'Path(os.environ["HORDE_LAUNCH_AUDIT_RESULT"]).write_text(json.dumps({"cwd":os.getcwd(),"args":sys.argv[1:],"text":"旅行 🐉 café"},ensure_ascii=False),encoding="utf-8")\n', encoding='utf-8')
            for location in (root,app):
                environment=location/'.venv'
                venv.EnvBuilder(with_pip=False).create(environment)
                receipt=root/'receipt.json'
                env={**os.environ,'HORDE_LAUNCH_AUDIT_RESULT':str(receipt),'PYTHONUTF8':'0'}
                result=subprocess.run([os.environ.get('COMSPEC','cmd.exe'),'/d','/c','call',str(root/'Start Horde Studio.bat')],
                    cwd=temporary,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=30)
                self.assertEqual(result.returncode,0,result.stderr)
                saved=json.loads(receipt.read_text(encoding='utf-8'))
                self.assertEqual(Path(saved['cwd']).resolve(),app.resolve())
                self.assertEqual(saved['args'],['--open'])
                self.assertEqual(saved['text'],'旅行 🐉 café')
                receipt.unlink()
                shutil.rmtree(environment)

if __name__=='__main__':unittest.main(verbosity=2)

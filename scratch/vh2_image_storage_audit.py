#!/usr/bin/env python3
"""Focused checks for bounded, content-addressed VH2 media storage."""
import base64,io,pathlib,sqlite3,sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from virtual_humans.backend import vh2_media

try:
    from PIL import Image
except ImportError:
    raise SystemExit('Pillow is required for the compression branch of this audit.')

db=sqlite3.connect(':memory:')
db.row_factory=sqlite3.Row
db.executescript('CREATE TABLE photo_assets(id TEXT PRIMARY KEY,world_id TEXT NOT NULL,mime TEXT NOT NULL,bytes BLOB NOT NULL);')

# Provider-style PNG: photographic noise is deliberately expensive as PNG.
source=Image.effect_noise((1536,1024),48).convert('RGB')
encoded=io.BytesIO();source.save(encoded,'PNG')
raw=encoded.getvalue()
assert len(raw)>vh2_media.IMAGE_OPTIMIZE_ABOVE
mime,optimized=vh2_media.optimize_image_bytes('image/png',raw)
assert mime=='image/jpeg'
assert len(optimized)<len(raw)*0.4,(len(raw),len(optimized))
with Image.open(io.BytesIO(optimized)) as result:
    assert max(result.size)<=vh2_media.IMAGE_MAX_DIMENSION

# Oversize sources are dimension-bounded even if their original encoding is small.
wide=Image.new('RGB',(4096,512),'navy');wide_bytes=io.BytesIO();wide.save(wide_bytes,'PNG')
# Pixel dimensions are bounded even when an unusually simple PNG is tiny.
wide_raw=wide_bytes.getvalue()
wide_mime,wide_optimized=vh2_media.optimize_image_bytes('image/png',wide_raw)
assert wide_mime=='image/jpeg'
with Image.open(io.BytesIO(wide_optimized)) as result:
    assert result.size==(2048,256),result.size

# One binary referenced by several messages/photos occupies one row per life.
first=vh2_media.store_asset(db,'life-a',mime,optimized)
again=vh2_media.store_asset(db,'life-a',mime,optimized)
alias=vh2_media.store_asset(db,'life-a','image/jpg',optimized)
other_life=vh2_media.store_asset(db,'life-b',mime,optimized)
assert first==again==alias and first!=other_life
assert db.execute('SELECT COUNT(*) FROM photo_assets').fetchone()[0]==2

# The public decoder validates then applies the same compression policy.
data='data:image/png;base64,'+base64.b64encode(raw).decode()
decoded_mime,decoded=vh2_media.decode_image(data)
assert decoded_mime=='image/jpeg' and decoded==optimized

docker=(ROOT/'deploy/vh2-self-host/Dockerfile').read_text()
integration=(ROOT/'virtual_humans/frontend/vh2-horde-integration.js').read_text()
workspace=(ROOT/'virtual_humans/frontend/vh-workspace.js').read_text()
assert 'python3-pil' in docker
assert 'vh2NormalizeStoredImage(stable)' in integration
assert "toDataURL('image/webp',quality)" in integration
assert integration.count('vh2NormalizeUploadedImage(')>=3
assert workspace.count('vh2NormalizeUploadedImage(file)')>=2

print('PASS: new images are bounded/compressed, content-addressed per life, and normalized in desktop + self-host paths')
print({'pngBytes':len(raw),'storedBytes':len(optimized),'ratio':round(len(optimized)/len(raw),3),'rowsForThreeReferences':2})

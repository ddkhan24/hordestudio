from pathlib import Path
from collections import defaultdict
import math,sys,json,re,html
from PIL import Image as PILImage
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color, white
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
sys.path.insert(0,str(Path(__file__).parent));from content import PAGES
ROOT=Path(__file__).resolve().parents[3]; WORK=Path(__file__).parent;OUT=ROOT/'output/pdf/Horde-Studio-v18.3.5-Illustrated-User-Manual.pdf'
for name,file in [('Body','Arial.ttf'),('Bold','Arial Bold.ttf'),('Italic','Arial Italic.ttf')]:pdfmetrics.registerFont(TTFont(name,'/System/Library/Fonts/Supplemental/'+file))
pdfmetrics.registerFontFamily('Body',normal='Body',bold='Bold',italic='Italic',boldItalic='Bold')
W,H=595.276,841.89;M=48;CW=W-2*M
INK=HexColor('#172a3d');MUTED=HexColor('#526b7c');TEAL=HexColor('#007e87');RED=HexColor('#e53e50');PALE=HexColor('#edf5f6');LINE=HexColor('#d2e1e6');GOLD=HexColor('#efbd65')
styles={
'body':ParagraphStyle('body',fontName='Body',fontSize=10.2,leading=14.4,textColor=INK,spaceAfter=9),
'caption':ParagraphStyle('caption',fontName='Body',fontSize=8.3,leading=11,textColor=MUTED),
'cell':ParagraphStyle('cell',fontName='Body',fontSize=9.1,leading=12.3,textColor=INK),
'headcell':ParagraphStyle('headcell',fontName='Bold',fontSize=9.1,leading=12.3,textColor=white),
'example':ParagraphStyle('example',fontName='Body',fontSize=9.2,leading=13,textColor=INK),
}
C=canvas.Canvas(str(OUT),pagesize=(W,H),pageCompression=1);C.setTitle('Horde Studio v18.3.5 - Illustrated User Manual');C.setAuthor('Horde Studio');C.setSubject('Detailed user guide: Virtual Humans 2.0, Worlds, chat, media, multiplayer and recovery');C.setKeywords('Horde Studio, v18.3.5, Virtual Humans, Worlds, manual, setup, user guide');C.setViewerPreference('DisplayDocTitle','true')
log=[];fig=0

def safe(s):return html.escape(s).replace('\n','<br/>')
def par(text,style='body',width=CW):
 # Highlight literal path names and step numbers, retaining fully selectable text.
 t=safe(text)
 if re.match(r'^\d+\.',text):t=re.sub(r'^(\d+\.)',r'<b>\1</b>',t)
 return Paragraph(t,styles[style])
def drawp(text,y,style='body',x=M,width=CW):
 p=par(text,style,width);_,h=p.wrap(width,1000);p.drawOn(C,x,y-h);return y-h-9

def header(ch,page):
 C.setFillColor(TEAL);C.rect(0,H-9,W,9,fill=1,stroke=0)
 C.setFillColor(MUTED);C.setFont('Bold',8);C.drawString(M,H-35,'HORDE STUDIO  /  ILLUSTRATED USER MANUAL')
 C.setFont('Body',8);C.drawRightString(W-M,H-35,'v18.3.5')
 C.setStrokeColor(LINE);C.line(M,42,W-M,42)
 C.setFillColor(MUTED);C.setFont('Body',8);C.drawString(M,28,ch);C.drawRightString(W-M,28,str(page))
 C.linkRect('', 'contents', (M,18,M+150,40), relative=0,thickness=0)
 C.setFont('Body',7);C.drawCentredString(W/2,28,'Contents: click the footer')

def title(t,ch,page,key):
 header(ch,page);C.bookmarkPage(key);C.addOutlineEntry(t,key,1,False)
 C.setFillColor(TEAL);C.setFont('Bold',9);C.drawString(M,H-68,ch.upper())
 st=ParagraphStyle('title',fontName='Bold',fontSize=24,leading=28,textColor=INK)
 p=Paragraph(safe(t),st);_,h=p.wrap(CW,200);p.drawOn(C,M,H-89-h);return H-103-h

def table(data,y):
 rows=[]
 for i,row in enumerate(data):
  cells=[]
  for j,item in enumerate(row):
   s=safe(str(item))
   if str(item).startswith('https://'):
    url=str(item);s='<link href="'+html.escape(url,quote=True)+'" color="#007e87">Open official guide</link>'
   cells.append(Paragraph(s,styles['headcell' if i==0 else 'cell']))
  rows.append(cells)
 widths=[CW*.39,CW*.61] if len(data[0])==2 else [CW/len(data[0])]*len(data[0])
 t=Table(rows,colWidths=widths,hAlign='LEFT');t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),TEAL),('ROWBACKGROUNDS',(0,1),(-1,-1),[PALE,white]),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,1),(-1,-1),.4,LINE)]));_,h=t.wrap(CW,1000);t.drawOn(C,M,y-h);return y-h-13

def example(text,y):
 p=par(text,'example',CW-26);_,h=p.wrap(CW-26,1000);hh=h+38
 C.setFillColor(PALE);C.roundRect(M,y-hh,CW,hh,6,fill=1,stroke=0);C.setFillColor(TEAL);C.rect(M,y-hh,3,hh,fill=1,stroke=0);C.setFont('Bold',8);C.drawString(M+13,y-15,'EXAMPLE / PRACTICAL CHECK');p.drawOn(C,M+13,y-27-h);return y-hh-12

def box(x,y,w,h,label,sub):
 C.setFillColor(PALE);C.setStrokeColor(LINE);C.roundRect(x,y,w,h,7,fill=1,stroke=1)
 p=Paragraph(safe(label),ParagraphStyle('box',fontName='Bold',fontSize=12,leading=14,textColor=TEAL));_,ph=p.wrap(w-22,100);p.drawOn(C,x+11,y+h-15-ph)
 p=Paragraph(safe(sub),styles['caption']);_,ph=p.wrap(w-22,100);p.drawOn(C,x+11,y+12)
def arrow(x1,y1,x2,y2):
 C.setStrokeColor(TEAL);C.setLineWidth(1.5);C.line(x1,y1,x2,y2);a=math.atan2(y2-y1,x2-x1)
 for d in [-.45,.45]:C.line(x2,y2,x2-7*math.cos(a+d),y2-7*math.sin(a+d))
def diagram(kind,y):
 h=122;yy=y-h
 if kind=='person-life':
  box(M,yy,CW*.43,95,'EDIT HUMAN','Identity, voice and starting world\nSave the authored template');box(M+CW*.57,yy,CW*.43,95,'LIVE HUMAN','Routine, people and history\nChanges belong to this timeline');arrow(M+CW*.44,yy+49,M+CW*.56,yy+49)
 elif kind=='world-flow':
  labels=[('WORLD STUDIO','Places, cast and rules'),('NEW TIMELINE','Player and starting life'),('WORLD PLAY','Actions and saved state')];ww=(CW-28)/3
  for i,(a,b) in enumerate(labels):box(M+i*(ww+14),yy,ww,95,a,b)
  for i in range(2):arrow(M+(i+1)*ww+i*14+2,yy+48,M+(i+1)*(ww+14)-2,yy+48)
 elif kind=='hosting':
  box(M,yy,CW*.43,95,'PRIVATE SERVICE','Active life + persistent disk\nCloud-capable text provider');box(M+CW*.57,yy,CW*.43,95,'LOCAL MIRROR','Paused recovery copy\nRefreshes while connected');arrow(M+CW*.44,yy+49,M+CW*.56,yy+49)
 else:
  labels=[('PLAYERS','Named actions + votes'),('HOST','Canonical save + model'),('PARTY VIEW','Sanitized shared result')];ww=(CW-28)/3
  for i,(a,b) in enumerate(labels):box(M+i*(ww+14),yy,ww,95,a,b)
  for i in range(2):arrow(M+(i+1)*ww+i*14+2,yy+48,M+(i+1)*(ww+14)-2,yy+48)
 C.setFillColor(MUTED);C.setFont('Body',8);C.drawString(M,yy-13,'WORKFLOW ILLUSTRATION  /  conceptual diagram, not an application screenshot')
 return yy-27

def screenshot(name,y,topic):
 global fig
 source=WORK/'screens'/f'{name}.png'
 if not source.exists():raise ValueError('Missing screenshot '+name)
 im=PILImage.open(source);scale=im.width/1360
 # Honest crop of the upper working panel. The full capture is retained in source assets.
 if name in ['vh-commitment-dialog','vh-draft-dialog']:bounds=(int(300*scale),int(155*scale),int(1060*scale),int(685*scale))
 elif name=='labs-panel':bounds=(int(175*scale),int(35*scale),int(1185*scale),int(650*scale))
 elif name.startswith('vh-live-'):bounds=(int(220*scale),int(72*scale),im.width,int(615*scale))
 elif name.startswith('vh-edit-'):bounds=(int(220*scale),int(65*scale),im.width,int(630*scale))
 elif name.startswith('world-') and name not in ['world-play','world-map']:bounds=(int(220*scale),int(40*scale),im.width,int(590*scale))
 elif name.startswith('character-'):bounds=(int(220*scale),int(38*scale),im.width,int(585*scale))
 elif name.startswith('settings-'):bounds=(int(200*scale),int(80*scale),int(1300*scale),int(630*scale))
 else:bounds=(0,0,im.width,int(650*scale))
 im=im.crop(bounds);crop=WORK/(name+'-crop.jpg');im.convert('RGB').save(crop,quality=94)
 avail=y-78;h=min(228,avail-34);w=min(CW,h*im.width/im.height);h=w*im.height/im.width
 if h<110:raise ValueError(f'Screenshot too small: {topic}: {h:.1f}')
 fig+=1;C.setFillColor(INK);C.roundRect(M,y-h,w,h,5,fill=1,stroke=0);C.drawImage(str(crop),M,y-h,width=w,height=h,mask='auto')
 cap=f'Figure {fig:02d}. {topic} - actual v18.3.5 interface, upper-panel excerpt. Demo data; enlarge for detail.'
 y=drawp(cap,y-h-8,'caption');return y

# Cover
C.bookmarkPage('cover');C.addOutlineEntry('Cover','cover',0,False)
C.setFillColor(INK);C.rect(0,0,W,H,fill=1,stroke=0);C.setFillColor(TEAL);C.rect(0,H-12,W,12,fill=1,stroke=0)
C.setFillColor(white);C.setFont('Bold',18);C.drawString(M,H-82,'Horde');C.setFillColor(RED);C.drawString(M+55,H-82,'Studio')
C.setFillColor(GOLD);C.setFont('Bold',10);C.drawString(M,H-124,'VERSION 18.3.5  /  USER DOCUMENTATION')
p=Paragraph('Build characters.<br/>Shape worlds.<br/>Simulate lives.',ParagraphStyle('cover',fontName='Bold',fontSize=38,leading=45,textColor=white));_,hh=p.wrap(CW,300);p.drawOn(C,M,H-172-hh)
C.setFillColor(white);C.setFont('Body',18);C.drawString(M,415,'The illustrated user manual')
p=Paragraph('Step-by-step setup, real screenshots and worked examples.<br/>With in-depth guides to Worlds and Virtual Humans 2.0.',ParagraphStyle('sub',fontName='Body',fontSize=12,leading=18,textColor=HexColor('#b9d7df')));_,hh=p.wrap(CW,100);p.drawOn(C,M,380-hh)
# Editorial mini-map of the three central experiences.
for i,(a,b) in enumerate([('01','CHARACTER CHAT'),('02','WORLDS'),('03','VIRTUAL HUMANS')]):
 x=M+i*(CW/3);C.setStrokeColor(HexColor('#466573'));C.line(x,265,x+CW/3-16,265);C.setFillColor(GOLD);C.setFont('Bold',24);C.drawString(x,227,a);C.setFillColor(white);C.setFont('Bold',9);C.drawString(x,205,b)
C.setFillColor(HexColor('#b9d7df'));C.setFont('Body',10);C.drawString(M,96,'Searchable text  /  linked contents  /  bookmarks  /  alphabetical index');C.drawString(M,76,'English edition - 10 October 2026');C.showPage()

# Four contents pages, exact topic page references. All topics use a single page.
TOC_PER=21;TOC_COUNT=math.ceil(len(PAGES)/TOC_PER);START=2+TOC_COUNT
for k in range(TOC_COUNT):
 page=2+k;header('Contents',page)
 if k==0:C.bookmarkPage('contents');C.addOutlineEntry('Contents','contents',0,False)
 C.setFillColor(TEAL);C.setFont('Bold',10);C.drawString(M,H-68,'FIND A TASK');C.setFillColor(INK);C.setFont('Bold',26);C.drawString(M,H-107,'Contents'+('' if k==0 else ' / continued'))
 y=H-143;previous=None
 for i in range(k*TOC_PER,min((k+1)*TOC_PER,len(PAGES))):
  p=PAGES[i]
  if previous!=p['ch']:
   C.setFillColor(TEAL);C.setFont('Bold',9);C.drawString(M,y,p['ch'].upper());y-=20;previous=p['ch']
  sty=ParagraphStyle('toc',fontName='Body',fontSize=10.0,leading=13,textColor=INK)
  q=Paragraph(safe(p['title']),sty);_,qh=q.wrap(CW-35,100);q.drawOn(C,M,y-qh);C.setFillColor(MUTED);C.setFont('Body',10);C.drawRightString(W-M,y-10,str(START+i));C.linkRect('',f'topic-{i}',(M,y-qh-2,W-M,y+3),relative=0,thickness=0);y-=qh+10
 if y<60:raise ValueError('Contents overflow')
 C.showPage()

lastch=None
for i,p in enumerate(PAGES):
 pg=START+i
 if p['ch']!=lastch:C.bookmarkPage(f'chapter-{i}');C.addOutlineEntry(p['ch'],f'chapter-{i}',0,False);lastch=p['ch']
 y=title(p['title'],p['ch'],pg,f'topic-{i}')
 for chunk in p['body'].split('\n'):
  if chunk.strip():y=drawp(chunk.strip(),y)
 if p.get('table'):y=table(p['table'],y)
 if p.get('example'):y=example(p['example'],y)
 if p.get('diagram'):y=diagram(p['diagram'],y)
 elif p.get('shot'):y=screenshot(p['shot'],y,p['title'])
 if y<57:raise ValueError(f'Page overflow {pg}: {p["title"]}: {y}')
 log.append(dict(page=pg,title=p['title'],bottom=y,screenshot=p.get('shot')));C.showPage()

# Linked index with multiple destinations per term.
index=defaultdict(set)
for i,p in enumerate(PAGES):
 for term in p['terms']:index[term].add(START+i)
terms=sorted(index,key=str.casefold);PER=60;INDEX_START=START+len(PAGES)
for k in range(math.ceil(len(terms)/PER)):
 pg=INDEX_START+k;header('Alphabetical index',pg)
 if k==0:C.bookmarkPage('index');C.addOutlineEntry('Alphabetical index','index',0,False)
 C.setFillColor(TEAL);C.setFont('Bold',10);C.drawString(M,H-68,'LOOK UP A TERM');C.setFillColor(INK);C.setFont('Bold',26);C.drawString(M,H-108,'Alphabetical index')
 subset=terms[k*PER:(k+1)*PER]
 for j,term in enumerate(subset):
  col=j//30;row=j%30;x=M+col*(CW/2+8);y=H-147-row*20
  refs=' '.join(f'<link href="#topic-{n-START}" color="#007e87">{n}</link>' for n in sorted(index[term]))
  q=Paragraph('<b>'+safe(term)+'</b>  '+refs,ParagraphStyle('index',fontName='Body',fontSize=8.7,leading=10.5,textColor=INK));_,qh=q.wrap(CW/2-12,100)
  if qh>19:raise ValueError('Index term too long '+term)
  q.drawOn(C,x,y-qh)
 C.showPage()
C.save();(WORK/'layout-check.json').write_text(json.dumps(log,indent=2));(WORK/'manifest.json').write_text(json.dumps({'topics':len(PAGES),'words':sum(len(p['body'].split()) for p in PAGES),'figures':fig,'index_terms':len(index),'contents_pages':TOC_COUNT,'pages':INDEX_START+math.ceil(len(terms)/PER)-1},indent=2));print(OUT);print((WORK/'manifest.json').read_text())

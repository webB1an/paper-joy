"""Deterministic A4 printing packs. All expensive rendering runs locally."""
import argparse, hashlib, json, math, random, shutil
from collections import deque
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics import renderPDF
from reportlab.lib import colors
from svglib.svglib import svg2rlg
from pypdf import PdfReader
from fontTools.ttLib import TTFont as FontToolsFont
from fontTools.varLib.instancer import instantiateVariableFont
import pymupdf
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'output' / 'pdf'
W, H = A4
M = 42

def setup_font():
    path = ROOT / '.local/fonts/NotoSansSC-Regular.ttf'
    if not path.exists():
        variable = FontToolsFont(ROOT / '.local/fonts/NotoSansSC-VF.ttf')
        instantiateVariableFont(variable, {'wght': 400}, inplace=True).save(path)
    pdfmetrics.registerFont(TTFont('NotoSC', str(path)))

def text(c, x, y, s, size=11):
    c.setFont('NotoSC', size); c.setFillGray(0.12); c.drawString(x, y, s)

def frame(c, title, sub, index, total):
    text(c, M, H-48, title, 21)
    text(c, M, H-70, sub, 10)
    c.setLineWidth(.6); c.setStrokeGray(.65); c.line(M,H-83,W-M,H-83)
    text(c,M,28,'纸趣 PaperJoy · A4 黑白 · 建议按实际大小打印',8)
    text(c,W-100,28,f'{index:02d} / {total:02d}',9)
    c.setStrokeGray(0);c.setFillGray(0)

def svg_page(c, source, index):
    frame(c,f'自然涂色 · {source["title"]}','拿起彩笔，为小小世界添上喜欢的颜色。',index,12)
    drawing = svg2rlg(str(ROOT / source['path']))
    if not drawing or drawing.width<=0 or drawing.height<=0:
        raise ValueError(f'Unrenderable source: {source["path"]}')
    # Use exact vector bounds and a generous printable area.
    x1,y1,x2,y2=drawing.getBounds()
    factor=min((W-2*M-32)/(x2-x1),(H-240)/(y2-y1))
    def ink_only(node):
        for item in getattr(node,'contents',[]):
            ink_only(item)
        if hasattr(node,'fillColor') and node.fillColor is not None:
            color=node.fillColor
            if hasattr(color,'red') and max(color.red,color.green,color.blue)-min(color.red,color.green,color.blue)>.08:
                node.fillColor=colors.white
        if hasattr(node,'strokeColor') and node.strokeColor is not None:
            node.strokeColor=colors.black
            if hasattr(node,'strokeWidth'):node.strokeWidth=max(node.strokeWidth or 0,1.1/factor)
    ink_only(drawing)
    dw,dh=(x2-x1)*factor,(y2-y1)*factor
    c.saveState();c.translate((W-dw)/2,110+(H-240-dh)/2);c.scale(factor,factor)
    renderPDF.draw(drawing,c,-x1,-y1);c.restoreState()
    text(c,M,64,'我的名字：____________    日期：____________',10)
    text(c,M,48,f'图稿：Openclipart / {source["author"]} · CC0',7)
    c.showPage()

def make_maze(cols, rows, seed):
    rng=random.Random(seed); edges=set(); visited={(0,0)}; stack=[(0,0)]
    while stack:
        x,y=stack[-1]
        choices=[(nx,ny) for nx,ny in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)] if 0<=nx<cols and 0<=ny<rows and (nx,ny) not in visited]
        if not choices:stack.pop();continue
        nxt=rng.choice(choices);edges.add(tuple(sorted(((x,y),nxt))));visited.add(nxt);stack.append(nxt)
    parents={(0,0):None};queue=deque([(0,0)])
    while queue:
        current=queue.popleft()
        x,y=current
        for nxt in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]:
            if nxt not in parents and tuple(sorted((current,nxt))) in edges:
                parents[nxt]=current;queue.append(nxt)
    finish=(cols-1,rows-1);path=[];p=finish
    while p is not None:path.append(p);p=parents[p]
    path.reverse()
    assert len(visited)==cols*rows and len(edges)==cols*rows-1
    assert all(tuple(sorted((a,b))) in edges for a,b in zip(path,path[1:]))
    return edges,path

def maze_page(c, number, answer=False):
    cols=10+(number//5)*2;rows=cols+2;edges,path=make_maze(cols,rows,20261106+number)
    title=f'分级迷宫 · 第 {number+1:02d} 关'+(' · 答案' if answer else '')
    frame(c,title,'从入口走到出口，沿通道前进，不要穿过墙壁。',number+1+(20 if answer else 0),40)
    cell=min((W-2*M-12)/cols,(H-220)/rows);x0=(W-cols*cell)/2;y0=105
    def center(p):return x0+(p[0]+.5)*cell,y0+(rows-p[1]-.5)*cell
    c.setLineWidth(1.3);c.setStrokeGray(0)
    for y in range(rows):
        for x in range(cols):
            left=x0+x*cell;top=y0+(rows-y)*cell
            if y==0:c.line(left,top,left+cell,top)
            if x==0 and y!=0:c.line(left,top,left,top-cell)
            if y==rows-1 or tuple(sorted(((x,y),(x,y+1)))) not in edges:c.line(left,top-cell,left+cell,top-cell)
            if x==cols-1:
                if y!=rows-1:c.line(left+cell,top,left+cell,top-cell)
            elif tuple(sorted(((x,y),(x+1,y)))) not in edges:c.line(left+cell,top,left+cell,top-cell)
    text(c,x0-4,y0+rows*cell+12,'入口 →',10);text(c,x0+cols*cell-38,y0-20,'→ 出口',10)
    if answer:
        c.setStrokeGray(.45);c.setLineWidth(2);c.setDash(3,2)
        p=c.beginPath();p.moveTo(*center(path[0]))
        for point in path[1:]:p.lineTo(*center(point))
        c.drawPath(p);c.setDash()
    text(c,M,65,'准备：铅笔和橡皮。遇到岔路时，试着先观察再动笔。',10)
    c.showPage()
    return {'number':number+1,'columns':cols,'rows':rows,'seed':20261106+number,'solution':path}

def control_page(c, number):
    titles=['直线小路','波浪小路','折线小山','弧线彩虹','圆圈练习','旋转小路','高低山峰','综合路线']
    frame(c,'控笔练习 · '+titles[number],'从左侧圆点出发，沿虚线慢慢描画。',number+1,12)
    for row in range(6):
        yy=H-145-row*91
        c.setFillGray(0);c.circle(M,yy,3,fill=1,stroke=0)
        c.setStrokeGray(.45);c.setLineWidth(1.6);c.setDash(3,4)
        path=c.beginPath();path.moveTo(M+12,yy)
        for i in range(181):
            t=i/180;x=M+12+t*(W-2*M-12)
            if number==0:offset=0
            elif number==1:offset=17*math.sin(t*8*math.pi)
            elif number==2:offset=22*(1-4*abs((t*5)%1-.5))
            elif number==3:offset=22*abs(math.sin(t*6*math.pi))
            elif number==4:offset=17*math.sin(t*12*math.pi);x+=18*math.sin(t*12*math.pi)
            elif number==5:offset=(8+15*t)*math.sin(t*12*math.pi)
            elif number==6:offset=22*math.sin(t*7*math.pi)*math.sin(t*3*math.pi)
            else:offset=17*math.sin(t*(6+row)*math.pi)
            path.lineTo(x,yy+offset)
        c.drawPath(path);c.setDash()
    c.showPage()

def reward_page(c, number):
    headings=['我的一周小目标','阅读打卡表','整理习惯表','亲子活动记录']
    frame(c,'奖励表 · '+headings[number],'每天完成一个小目标，就在格子里画上喜欢的标记。',9+number,12)
    text(c,M,H-120,'我的名字：____________    本周日期：____________',12)
    text(c,M,H-152,'我的小目标：__________________________________',12)
    top=H-210;label_width=110;cw=(W-2*M-label_width)/7;rh=64
    c.setStrokeGray(.45);c.setLineWidth(.8)
    for r in range(6):c.line(M,top-r*rh,W-M,top-r*rh)
    for x in [M]+[M+label_width+i*cw for i in range(8)]:c.line(x,top,x,top-5*rh)
    text(c,M+12,top-35,'小小行动',12)
    for d in range(7):text(c,M+label_width+d*cw+10,top-35,str(d+1),13)
    for r in range(1,5):text(c,M+12,top-r*rh-35,f'目标 {r}',11)
    text(c,M,top-5*rh-48,'这周我最开心的事：',12)
    c.line(M,top-5*rh-86,W-M,top-5*rh-86)
    text(c,M,72,'给家长：以鼓励为主，让孩子参与制定容易做到的小目标。',10)
    c.showPage()

def manifest(slug,title,summary,category,count,answers,sources):
    path=OUTPUT/slug/'source.pdf';raw=path.read_bytes();pdf=PdfReader(path)
    assert len(pdf.pages)==count
    for page in pdf.pages:
        assert abs(float(page.mediabox.width)-W)<1 and abs(float(page.mediabox.height)-H)<1
    resource={'slug':slug,'title':title,'summary':summary,'categoryId':category,'topicIds':[],
        'tags':['A4打印','黑白省墨','亲子活动'],'ageMin':4,'ageMax':7,'difficulty':'EASY',
        'pageCount':count,'paperSize':'A4','colorMode':'BW','hasAnswers':answers,'materials':['A4纸','铅笔或彩笔'],
        'instructions':'下载 PDF 后选择 A4 纸张、实际大小或 100% 比例打印。请家长先试印一页，检查边距和线条；年龄仅供参考。',
        'coverUrl':'','previewUrls':[],'accessMode':'FREE','status':'REVIEW','sources':sources,'version':1}
    doc={'sourceHash':hashlib.sha256(raw).hexdigest(),'resource':resource,'printReview':'pending_physical_print',
         'sourceFile':'source.pdf','previews':[f'preview-{i+1}.jpg' for i in range(min(4,count))]}
    (path.parent/'manifest.json').write_text(json.dumps(doc,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    document=pymupdf.open(path);thumbs=[]
    for i,page in enumerate(document):
        pix=page.get_pixmap(matrix=pymupdf.Matrix(.32,.32),alpha=False)
        thumb=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
        thumbs.append(ImageOps.expand(thumb,border=2,fill='#cbd5e1'))
        if i<4:
            large=page.get_pixmap(matrix=pymupdf.Matrix(1.15,1.15),alpha=False)
            large.save(path.parent/f'preview-{i+1}.jpg',jpg_quality=82)
    width=max(p.width for p in thumbs);height=max(p.height for p in thumbs);columns=4;rows=math.ceil(len(thumbs)/columns)
    contact=Image.new('RGB',(columns*(width+12)+12,rows*(height+12)+12),'#e8edf2')
    for i,thumb in enumerate(thumbs):contact.paste(thumb,(12+(i%columns)*(width+12),12+(i//columns)*(height+12)))
    contact.save(path.parent/'contact-sheet.png')
    shutil.copy(ROOT/'.local/fonts/OFL.txt',path.parent/'FONT-LICENSE.txt')
    print(f'Validated {slug}: {count} A4 pages, {len(raw)} bytes')

def build():
    setup_font();OUTPUT.mkdir(parents=True,exist_ok=True)
    sources=json.loads((ROOT/'assets/source-materials/print-pack-sources.json').read_text(encoding='utf-8'))
    for slug in ['nature-coloring','graded-mazes','pencil-rewards']:(OUTPUT/slug).mkdir(exist_ok=True)
    c=canvas.Canvas(str(OUTPUT/'nature-coloring/source.pdf'),pagesize=A4,pageCompression=1,invariant=1)
    c.setTitle('纸趣自然涂色 12 页');c.setAuthor('PaperJoy / attributed Openclipart contributors')
    for i,s in enumerate(sources):svg_page(c,s,i+1)
    c.save()
    c=canvas.Canvas(str(OUTPUT/'graded-mazes/source.pdf'),pagesize=A4,pageCompression=1,invariant=1);c.setTitle('纸趣分级迷宫 20 关与答案');c.setAuthor('PaperJoy')
    maze_records=[maze_page(c,n) for n in range(20)]
    for n in range(20):maze_page(c,n,True)
    c.save();(OUTPUT/'graded-mazes/answers.json').write_text(json.dumps(maze_records),encoding='utf-8')
    c=canvas.Canvas(str(OUTPUT/'pencil-rewards/source.pdf'),pagesize=A4,pageCompression=1,invariant=1);c.setTitle('纸趣控笔与奖励表 12 页');c.setAuthor('PaperJoy')
    for n in range(8):control_page(c,n)
    for n in range(4):reward_page(c,n)
    c.save()
    own=[{'title':'PaperJoy 原创程序生成版式','author':'PaperJoy','url':'https://github.com/webB1an/paper-joy','license':'Project-owned original layout'}]
    manifest('nature-coloring','自然与动物涂色 · 12 页','兔子、猫咪、花朵和蝴蝶，清晰线稿，适合亲子涂色。','coloring',12,False,[{k:s[k] for k in ['title','author','url','license','sha256']} for s in sources])
    manifest('graded-mazes','分级迷宫 · 20 关与答案','由易到难的纸上迷宫，20 张活动页及20张对应答案。','maze',40,True,own)
    manifest('pencil-rewards','控笔与奖励表 · 12 页','8 张控笔活动和4张奖励表，支持亲子日常练习与鼓励。','tracing',12,False,own)

if __name__=='__main__':build()

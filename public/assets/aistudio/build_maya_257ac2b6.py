"""Procedural, reproducible Maya GLB builder. Python 3 + numpy + scipy + Pillow.
Usage: python build_maya.py --logo Gradian-Logo-darkmode-min.png --out maya.glb
"""
import argparse, io, json, math, struct, pathlib
import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation

class GLB:
    def __init__(self):
        self.g={'asset':{'version':'2.0','generator':'MAYA Cinematic v3.0'},'scene':0,'scenes':[{'name':'MAYA','nodes':[]}],'nodes':[],'meshes':[],'materials':[],'bufferViews':[],'accessors':[],'animations':[],'buffers':[{}]}; self.b=bytearray(); self.acc_cache={}; self.mesh_cache={}
    def view(self,data,target=None):
        while len(self.b)%4:self.b.append(0)
        i=len(self.g['bufferViews']); d={'buffer':0,'byteOffset':len(self.b),'byteLength':len(data)}
        if target:d['target']=target
        self.g['bufferViews'].append(d); self.b.extend(data); return i
    def acc(self,arr,typ,component=5126,target=None,bounds=False,cache=False):
        dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[component]; a=np.ascontiguousarray(arr,dtype=dtype); data=a.tobytes(); k=(data,typ,component,target,bounds)
        if cache and k in self.acc_cache:return self.acc_cache[k]
        d={'bufferView':self.view(data,target),'componentType':component,'count':len(a),'type':typ}
        if bounds:d.update(min=np.atleast_1d(a.min(axis=0)).tolist(),max=np.atleast_1d(a.max(axis=0)).tolist())
        i=len(self.g['accessors']);self.g['accessors'].append(d)
        if cache:self.acc_cache[k]=i
        return i
    def material(self,name,color,rough=.63,metal=0,**kwargs):
        def lin(x):return x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4
        c=[lin(int(color[i:i+2],16)/255) for i in (0,2,4)]
        m={'name':name,'pbrMetallicRoughness':{'baseColorFactor':c+[1],'roughnessFactor':rough,'metallicFactor':metal}};m.update(kwargs)
        self.g['materials'].append(m);return len(self.g['materials'])-1
    def mesh(self,name,p,n,ix,mat,uv=None):
        p=np.asarray(p,np.float32);n=np.asarray(n,np.float32);ix=np.asarray(ix).reshape(-1)
        # all mesh arrays have outward normals; correct winding when needed
        tri=ix.reshape(-1,3); cross=np.cross(p[tri[:,1]]-p[tri[:,0]],p[tri[:,2]]-p[tri[:,0]]); flip=(cross*n[tri].mean(1)).sum(1)<0;tri[flip]=tri[flip][:,[0,2,1]];ix=tri.reshape(-1)
        attr={'POSITION':self.acc(p,'VEC3',target=34962,bounds=True,cache=True),'NORMAL':self.acc(n,'VEC3',target=34962,cache=True)}
        if uv is not None:attr['TEXCOORD_0']=self.acc(uv,'VEC2',target=34962,cache=True)
        d={'attributes':attr,'indices':self.acc(ix,'SCALAR',5123 if len(p)<65536 else 5125,34963,cache=True),'material':mat}
        self.g['meshes'].append({'name':name,'primitives':[d]});return len(self.g['meshes'])-1
    def node(self,name,parent=None,mesh=None,t=None,r=None,s=None,extras=None):
        d={'name':name};
        if mesh is not None:d['mesh']=mesh
        if t is not None:d['translation']=list(t)
        if r is not None:d['rotation']=list(r)
        if s is not None:d['scale']=list(s)
        if extras is not None:d['extras']=extras
        i=len(self.g['nodes']);self.g['nodes'].append(d)
        if parent is None:self.g['scenes'][0]['nodes'].append(i)
        else:self.g['nodes'][parent].setdefault('children',[]).append(i)
        return i
    def anim(self,name,tracks,extras=None):
        a={'name':name,'samplers':[],'channels':[]};
        for node,path,times,values,interpolation in tracks:
            inp=self.acc(times,'SCALAR',bounds=True,cache=True); out=self.acc(values,'VEC4' if path=='rotation' else 'VEC3',cache=True)
            a['channels'].append({'sampler':len(a['samplers']),'target':{'node':node,'path':path}});a['samplers'].append({'input':inp,'output':out,'interpolation':interpolation})
        if extras:a['extras']=extras
        self.g['animations'].append(a)
    def save(self,path):
        self.g['buffers'][0]['byteLength']=len(self.b);j=json.dumps(self.g,separators=(',',':')).encode();j+=b' '*(-len(j)%4);self.b+=b'\0'*(-len(self.b)%4);data=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(self.b))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(self.b),b'BIN\0')+self.b;pathlib.Path(path).write_bytes(data)

p=argparse.ArgumentParser();p.add_argument('--logo',default=str(pathlib.Path(__file__).with_name('Gradian-Logo-darkmode-min.png')));p.add_argument('--out',default=str(pathlib.Path(__file__).with_name('maya.glb')));args=p.parse_args();g=GLB()
Q=lambda xyz:Rotation.from_euler('xyz',xyz,degrees=True).as_quat().tolist()
M={}
for name,col,rough in [('skin','EDEDF5',.91),('shoe','E5E5F0',.93),('navy','19264D',.94),('navyDark','101B3B',.95),('red','D52130',.91),('white','FFFFFF',.65),('black','19161B',.9),('blush','F1B6C9',.85),('blue','5D9CFA',.56),('yellow','F1B83E',.60),('green','43B96A',.56),('violet','8B43EF',.60),('gray','8591AE',.64),('screen','DCE9FD',.64),('dark','293553',.66)]:M[name]=g.material(name,col,rough)
# Original raster is embedded, unredrawn, preserving the original purple mark and white wordmark.
logo=Image.open(args.logo).convert('RGBA');logo=logo.crop(logo.getbbox());logo.thumbnail((400,76),Image.Resampling.LANCZOS);buf=io.BytesIO();logo.quantize(colors=128,method=Image.Quantize.FASTOCTREE).save(buf,format='PNG',optimize=True);g.g['images']=[{'name':'Original Gradian.me logo','bufferView':g.view(buf.getvalue()),'mimeType':'image/png'}];g.g['samplers']=[{'magFilter':9729,'minFilter':9729,'wrapS':33071,'wrapT':33071}];g.g['textures']=[{'sampler':0,'source':0}];M['logo']=g.material('Gradian.me exact supplied artwork','FFFFFF',.76,alphaMode='MASK',alphaCutoff=.15);g.g['materials'][M['logo']]['pbrMetallicRoughness']['baseColorTexture']={'index':0}

def supergeom(e=1,nlon=32,nlat=20):
    # x/z longitude, Y up, unique poles, no degenerate triangles
    ps=[[0,-1,0]]; ns=[[0,-1,0]]; exp=2/e
    sp=lambda v:np.sign(v)*abs(v)**e
    for j in range(1,nlat):
        lat=-math.pi/2+math.pi*j/nlat
        for i in range(nlon):
            th=2*math.pi*i/nlon;xyz=np.array([sp(math.cos(lat))*sp(math.sin(th)),sp(math.sin(lat)),sp(math.cos(lat))*sp(math.cos(th))]);norm=np.sign(xyz)*np.abs(xyz)**(exp-1);norm/=np.linalg.norm(norm);ps.append(xyz);ns.append(norm)
    top=len(ps);ps.append([0,1,0]);ns.append([0,1,0]);idx=[]
    for i in range(nlon):
        k=(i+1)%nlon;idx.extend([0,1+k,1+i]);
        for j in range(nlat-2):
            a=1+j*nlon+i;b=1+j*nlon+k;c=a+nlon;d=b+nlon;idx.extend([a,b,c,b,d,c])
        a=1+(nlat-2)*nlon+i;b=1+(nlat-2)*nlon+k;idx.extend([a,b,top])
    return ps,ns,idx
geos={'ball':supergeom(1,24,16),'round':supergeom(.70,24,16),'soft':supergeom(.85,24,16),'tiny':supergeom(1,10,6)}
def shape(parent,name,mat,t,s,geo='ball',rot=None):
    k=(geo,mat)
    if k not in g.mesh_cache:g.mesh_cache[k]=g.mesh(geo+'_'+mat,*geos[geo],M[mat])
    return g.node(name,parent,g.mesh_cache[k],t=t,r=Q(rot) if rot else None,s=s)

def tube(parent,name,pts,r,mat,sides=8):
    pts=np.array(pts,float);P=[];N=[];I=[]
    for i,c in enumerate(pts):
        tang=pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)];tang=tang/np.linalg.norm(tang);ref=np.array([0,0,1.]);ref=np.array([0,1,0.]) if abs(tang@ref)>.95 else ref;u=np.cross(tang,ref);u/=np.linalg.norm(u);v=np.cross(tang,u)
        for j in range(sides):
            a=j*2*math.pi/sides;n=u*math.cos(a)+v*math.sin(a);P.append(c+r*n);N.append(n)
    for i in range(len(pts)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides;I.extend([a,b,a+sides,b,b+sides,a+sides])
    # end caps
    for i,tang in [(0,pts[0]-pts[1]),(len(pts)-1,pts[-1]-pts[-2])]:
        tang/=np.linalg.norm(tang);c=len(P);P.append(pts[i]);N.append(tang)
        for j in range(sides):I.extend([c,i*sides+j,i*sides+(j+1)%sides])
    mesh=g.mesh(name,P,N,I,M[mat]);return g.node(name,parent,mesh)

def profile_geom(profile,nlon=48):
    P=[];N=[]
    for j,(y,rx,rz) in enumerate(profile):
        a=profile[max(j-1,0)];b=profile[min(j+1,len(profile)-1)];dy=b[0]-a[0];dx=(b[1]-a[1])/max(dy,1e-6);dz=(b[2]-a[2])/max(dy,1e-6)
        for i in range(nlon):
            th=2*math.pi*i/nlon;si=math.sin(th);co=math.cos(th);P.append([rx*si,y,rz*co]);n=np.array([si/max(rx,1e-4),-(dx*si*si/max(rx,1e-4)+dz*co*co/max(rz,1e-4)),co/max(rz,1e-4)]);N.append(n/np.linalg.norm(n))
    return np.array(P),np.array(N)
def lathe(parent,name,profile,segments,nlon=48):
    P,N=profile_geom(profile,nlon)
    for k,(start,end,mat) in enumerate(segments):
        ix=[]
        for j in range(end-start):
            for i in range(nlon):
                a=j*nlon+i;b=j*nlon+(i+1)%nlon;c=a+nlon;d=b+nlon;ix.extend([a,b,c,b,d,c])
        sl=slice(start*nlon,(end+1)*nlon);mesh=g.mesh(name+'_'+mat,P[sl],N[sl],ix,M[mat]);g.node(name+'_'+str(k),parent,mesh)
    # cap ends with small fan, both hidden or underside of garment
    for j in [0,len(profile)-1]:
        y,rx,rz=profile[j];sign=-1 if j==0 else 1;ps=[[0,y,0]]+P[j*nlon:(j+1)*nlon].tolist();ns=[[0,sign,0]]*len(ps);ix=[]
        for i in range(nlon):ix.extend([0,i+1,1+(i+1)%nlon]);
        g.node(name+'_cap'+str(j),parent,g.mesh(name+'_cap',ps,ns,ix,M[segments[0 if j==0 else -1][2]]))

# The whole visible character uses a compact shared-geometry rigid rig.
root=g.node('MAYA_Root',extras={'front':'+Z','defaultState':'idle','defaultExpression':'neutral'})
body=g.node('TorsoPivot',root,t=[0,.38,0]);head=g.node('HeadPivot',body,t=[0,.77,0])
prof=[(0,.318,.222),(.018,.349,.244),(.06,.355,.251),(.32,.349,.249),(.49,.346,.243),(.58,.333,.230),(.66,.292,.204),(.72,.218,.163),(.75,.156,.126)]
lathe(body,'LongPolo',prof,[(0,3,'navy'),(3,4,'red'),(4,8,'navy')],40)
# Conforming logo decal on the red stripe, original artwork, no tracing.
width=.49;height=width*logo.height/logo.width;yc=.405;P=[];N=[];uv=[];I=[];nx=32;ny=4
for j in range(ny+1):
    v=j/ny;y=yc+(v-.5)*height;rx=np.interp(y,[r[0] for r in prof],[r[1] for r in prof]);rz=np.interp(y,[r[0] for r in prof],[r[2] for r in prof])
    for i in range(nx+1):
        u=i/nx;x=(u-.5)*width;z=rz*math.sqrt(max(0,1-(x/rx)**2))+.003;P.append([x,y,z]);n=np.array([x/rx**2,0,(z-.003)/rz**2]);N.append(n/np.linalg.norm(n));uv.append([u,1-v])
for j in range(ny):
    for i in range(nx):a=j*(nx+1)+i;b=a+1;c=a+nx+1;I.extend([a,b,c,b,c+1,c])
g.node('GradianLogo',body,g.mesh('Gradian original artwork',P,N,I,M['logo'],uv))
# A real folded polo collar: raised neckband, pointed collar leaves, visible
# thickness, a V-shaped opening, placket and buttons; no floating tube strips.
# Neck ring sits at the upper shoulder and is partially covered by the head.
lathe(body,'CollarStand',[(.71,.177,.145),(.742,.181,.147),(.764,.161,.130),(.77,.151,.124)],[(0,3,'navyDark')],20)
def leaf(side):
    # coordinates trace the collar fold from neck seam to a pointed front tip.
    p=np.array([[side*.035,.744,.148],[side*.139,.753,.102],[side*.214,.695,.151],[side*.151,.571,.222],[side*.060,.632,.237],[side*.024,.684,.201]],float)
    # solid fabric wedge: triangulated top fan with subtle thickness
    center=p.mean(0);center[2]+=.013;P=np.vstack([p,center]);N=np.tile([0,.45,.893],(7,1));I=[]
    for i in range(6):I.extend([6,i,(i+1)%6])
    # reverse-facing underside and thickness sidewalls are covered by the shirt
    P2=np.vstack([P,P-[0,.004,.009]]);N2=np.vstack([N,-N]);I2=I+[x+7 for x in I[::-1]]
    for i in range(6):j=(i+1)%6;I2.extend([i,j,i+7,j,j+7,i+7])
    g.node('PointedCollar_'+str(side),body,g.mesh('Folded polo leaf',P2,N2,I2,M['navyDark']))
    # crisp white piping following the leaf's outer hem, with a slim red stripe.
    pts=p[[1,2,3,4]]+[0,.002,.006];tube(body,'WhiteCollarEdge_'+str(side),pts,.0065,'white',5)
    # inset second stripe, following the same seam
    pts2=pts*.94+center*.06+[0,.002,.001];tube(body,'RedCollarEdge_'+str(side),pts2,.0045,'red',5)
for side in [-1,1]:leaf(side)
shape(body,'Placket','navyDark',[0,.593,.230],[.036,.086,.013],'round',rot=[-10,0,0]);shape(body,'ButtonTop','navy',[0,.628,.252],[.011,.011,.006],'tiny');shape(body,'ButtonBottom','navy',[0,.571,.259],[.010,.010,.006],'tiny')
arms=[];elbows=[];shoulders=[]
for side,label in [(-1,'L'),(1,'R')]:
    ar=g.node('Arm_'+label,body,t=[side*.302,.60,0],r=Q([0,0,side*13]));arms.append(ar)
    pr=[(-.195,.097,.100),(-.18,.109,.112),(-.165,.112,.115),(-.145,.116,.119),(-.055,.125,.127),(.025,.116,.119),(.073,.075,.078),(.086,.016,.016)]
    lathe(ar,'Sleeve_'+label,pr,[(0,1,'red'),(1,2,'white'),(2,7,'navy')],24)
    shoulders.append(np.array([side*.302,.60,0]));el=g.node('Elbow_'+label,ar,t=[0,-.185,0]);elbows.append(el)
    shape(el,'ForearmMitten_'+label,'skin',[0,-.129,.007],[.100,.177,.104],'soft')
    le=g.node('Leg_'+label,root,t=[side*.137,.385,0]);shape(le,'LegShape_'+label,'skin',[0,-.135,0],[.119,.193,.124],'soft');shape(le,'Foot_'+label,'skin',[0,-.290,.038],[.132,.101,.158],'soft')
# Opaque head surface atlas: UVs are part of the head mesh. No facial decal,
# depth fighting, intersecting blush planes, or floating mouth geometry.
from PIL import ImageDraw, ImageFont
from scipy.ndimage import map_coordinates
expressions=['neutral','happy','joyful','wink','surprised','thinking','curious','confident','love','proud','concerned','confused','annoyed','tired','sleeping','dizzy','error','finished','approval','searching','yawn','blink']
W,H=640,384;cols,rows=5,5;SS=3; skin=(237,237,245)
rx,ry,rz=.62,.49,.49;expo=.79;cy=.50
# Each tile is a cylindrical/spherical unwrap, with the face at u=.5.
# Draw the design on a frontal canvas then reproject into head UV space.
PW,PH=1200,960; xmin,xmax=-rx,rx;ymin,ymax=cy-ry,cy+ry
sx,sy=np.meshgrid((np.arange(W)+.5)/W,(np.arange(H)+.5)/H);th=(sx-.5)*2*math.pi;la=(.5-sy)*math.pi
sp=lambda x:np.sign(x)*np.abs(x)**expo
xx=rx*sp(np.cos(la))*sp(np.sin(th));yy=cy+ry*sp(np.sin(la));front=np.cos(th)>0
ix=np.clip((xx-xmin)/(xmax-xmin)*(PW-1),0,PW-1);iy=np.clip((ymax-yy)/(ymax-ymin)*(PH-1),0,PH-1)
X,Y=np.meshgrid(np.linspace(xmin,xmax,PW),np.linspace(ymax,ymin,PH))
base=np.zeros((PH,PW,3),np.float32)+skin
for side in [-1,1]:
    k=np.exp(-(((X-side*.345)/.098)**2+((Y-.365)/.060)**2)*1.5)*.48
    base=base*(1-k[...,None])+np.array([235,153,181])*k[...,None]
base=np.uint8(np.clip(base,0,255));atlas=Image.new('RGB',(W*cols,H*rows),skin)
def face_tile(f):
    im=Image.fromarray(base.copy());d=ImageDraw.Draw(im);ink='#211E25'
    def xy(x,y):return ((x-xmin)/(xmax-xmin)*(PW-1),(ymax-y)/(ymax-ymin)*(PH-1))
    def ellipse(x,y,rx,ry,c):d.ellipse((*xy(x-rx,y+ry),*xy(x+rx,y-ry)),fill=c)
    def line(pts,c=ink,w=.017):
        pp=[xy(x,y) for x,y in pts];ww=max(1,round(w/(xmax-xmin)*PW));d.line(pp,fill=c,width=ww,joint='curve')
        for a,b in (pp[0],pp[-1]):d.ellipse((a-ww/2,b-ww/2,a+ww/2,b+ww/2),fill=c)
    def arc(x,y,up=True):line([(x+t*.060,y+(1 if up else -1)*.033*(1-t*t)) for t in np.linspace(-1,1,30)],w=.024)
    for side in [-1,1]:
        x=side*.218;y=.584
        if f in ['happy','confident','proud','finished']:arc(x,y,True)
        elif f in ['sleeping','tired','yawn','blink']:arc(x,y,False)
        elif f=='wink' and side==1:arc(x,y,True)
        elif f=='annoyed':line([(x-.053,y+side*.028),(x+.053,y-side*.028)],w=.025)
        elif f=='love':
            ellipse(x-.025,y+.015,.037,.038,'#D83859');ellipse(x+.025,y+.015,.037,.038,'#D83859');d.polygon([xy(x-.061,y+.005),xy(x+.061,y+.005),xy(x,y-.060)],fill='#D83859')
        elif f=='dizzy':line([(x+(.007+.052*t/(4*math.pi))*math.cos(t),y+(.007+.052*t/(4*math.pi))*math.sin(t)) for t in np.linspace(0,4*math.pi,100)],w=.013)
        else:
            # Round dark eyes: no shiny fake reflection or elongated oval.
            ellipse(x,y,.056,.055 if f not in ['surprised','curious'] else .064,ink)
    # Neutral/thinking/searching have NO mouth. Deliberate restrained expressions.
    if f in ['happy','wink','confident','proud','love','finished','approval']:
        line([(t*.048,.432-.022*(1-t*t)) for t in np.linspace(-1,1,25)],w=.014)
    elif f=='joyful':
        ellipse(0,.432,.051,.036,ink);ellipse(0,.413,.027,.011,'#D9819C')
    elif f in ['concerned','confused','annoyed','tired','error']:
        line([(t*.043,.417+.018*(1-t*t)) for t in np.linspace(-1,1,25)],w=.014)
    elif f in ['surprised','yawn']:ellipse(0,.431,.027 if f=='surprised' else .041,.032 if f=='surprised' else .046,ink)
    arr=np.array(im);tile=np.zeros((H,W,3),np.uint8)+np.uint8(skin);tile[front]=np.stack([map_coordinates(arr[:,:,ch], [iy[front],ix[front]],order=1,mode="nearest") for ch in range(3)],axis=-1);return Image.fromarray(tile)
for i,f in enumerate(expressions):atlas.paste(face_tile(f),((i%cols)*W,(i//cols)*H))
# Lossless indexed PNG keeps the 25-cell texture small, including soft blush.
buf=io.BytesIO();atlas.quantize(colors=128,dither=Image.Dither.NONE).save(buf,format='PNG',optimize=True);g.g['images'].append({'name':'MAYA opaque facial atlas','bufferView':g.view(buf.getvalue()),'mimeType':'image/png'});g.g['textures'].append({'sampler':0,'source':1});M['face']=g.material('FaceAtlas','FFFFFF',.94);g.g['materials'][M['face']]['pbrMetallicRoughness']['baseColorTexture']={'index':1}
# Smoother 48x32 head; duplicate longitude seam for proper atlas mapping.
P=[];N=[];uv=[];I=[];nl,nt=64,40
for j in range(nt+1):
    v=j/nt;lat=(v-.5)*math.pi
    for i in range(nl+1):
        u=i/nl;th=(u-.5)*2*math.pi;x=sp(math.cos(lat))*sp(math.sin(th));y=sp(math.sin(lat));z=sp(math.cos(lat))*sp(math.cos(th));P.append([rx*x,cy+ry*y,rz*z]);n=np.array([np.sign(x)*abs(x)**(2/expo-1)/rx,np.sign(y)*abs(y)**(2/expo-1)/ry,np.sign(z)*abs(z)**(2/expo-1)/rz]);N.append(n/np.linalg.norm(n));uv.append([(u*(W-2)+1)/(W*cols),((1-v)*(H-2)+1)/(H*rows)])
for j in range(nt):
    for i in range(nl):
        a=j*(nl+1)+i;b=a+1;c=a+nl+1;d=c+1
        if j>0:I.extend([a,b,c])
        if j<nt-1:I.extend([b,d,c])
g.node('FaceAtlas',head,g.mesh('Smooth textured head',P,N,I,M['face'],uv))
# Optional state and mood symbols: one shared RGBA atlas and one small mesh.
# Draw icon silhouettes at supersampled resolution; no permanent head accessory.
icons=['dots','question','alert','check','heart','stars','sleep','search','clock','spiral','thumb','idea','anger','confetti','exclaim'];IC=4;IR=4;IW=96;IH=96;K=3
icon_atlas=Image.new('RGBA',(IC*IW,IR*IH));fontpath='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for k,name in enumerate(icons):
    im=Image.new('RGBA',(IW*K,IH*K));d=ImageDraw.Draw(im)
    def box(a):return tuple(round(z*K) for z in a)
    def ell(a,c):d.ellipse(box(a),fill=c)
    def ln(p,c,w):d.line([(round(x*K),round(y*K)) for x,y in p],fill=c,width=round(w*K),joint='curve')
    def txt(t,c,size,at=(48,46)):
        font=ImageFont.truetype(fontpath,round(size*K));d.text((at[0]*K,at[1]*K),t,font=font,fill=c,anchor='mm')
    def star(x,y,r,c):
        pts=[((x+math.sin(i*math.pi/5)*r*(1 if i%2==0 else .43))*K,(y-math.cos(i*math.pi/5)*r*(1 if i%2==0 else .43))*K) for i in range(10)];d.polygon(pts,fill=c)
    if name=='dots':
        d.rounded_rectangle(box((5,23,91,73)),radius=23*K,fill='#518EED');d.polygon([(25*K,69*K),(22*K,83*K),(40*K,69*K)],fill='#518EED')
        for x in (26,48,70):ell((x-6,42,x+6,54),'white')
    elif name=='question':txt('?','#7450D8',82)
    elif name in ['alert','check','exclaim']:
        col={'alert':'#D8494F','check':'#42A96D','exclaim':'#E9AB35'}[name];ell((11,11,85,85),col)
        if name=='check':ln([(28,49),(42,63),(69,34)],'white',9)
        else:txt('!','white',64)
    elif name=='heart':
        ell((11,17,52,59),'#DF4C6D');ell((44,17,85,59),'#DF4C6D');d.polygon([(11*K,43*K),(85*K,43*K),(48*K,83*K)],fill='#DF4C6D')
    elif name=='stars':star(37,53,30,'#E9B43E');star(73,24,17,'#F4CD66');star(77,72,11,'#F4CD66')
    elif name=='sleep':txt('z','#5982D7',52,(35,61));txt('z','#7C9BE3',37,(68,31))
    elif name=='search':
        ell((12,12,67,67),'#5C76B6');ell((20,20,59,59),'#DCEBFA');ln([(60,60),(81,81)],'#354979',10)
    elif name=='clock':ell((12,12,84,84),'#8090AE');ell((20,20,76,76),'#E9EEF8');ln([(48,29),(48,48),(62,54)],'#354979',6)
    elif name=='spiral':ln([(48+(3+34*t/(5*math.pi))*math.cos(t),48+(3+34*t/(5*math.pi))*math.sin(t)) for t in np.linspace(0,5*math.pi,150)],'#657AC1',7)
    elif name=='thumb':
        d.rounded_rectangle(box((15,44,31,80)),radius=5*K,fill='#5785DC');d.rounded_rectangle(box((33,39,77,79)),radius=11*K,fill='#5785DC');d.rounded_rectangle(box((39,14,56,53)),radius=8*K,fill='#5785DC')
    elif name=='idea':ell((20,9,76,65),'#F0B83A');d.rounded_rectangle(box((36,60,60,82)),radius=5*K,fill='#A68B58');ln([(39,72),(57,72)],'#FFF2CC',3)
    elif name=='anger':
        for dx,dy in [(-1,-1),(-1,1),(1,-1),(1,1)]:ln([(48+dx*29,48+dy*8),(48+dx*8,48+dy*8),(48+dx*8,48+dy*29)],'#D94B57',7)
    elif name=='confetti':
        for j in range(9):
            a=j*2*math.pi/9;ln([(48+22*math.cos(a),48+22*math.sin(a)),(48+37*math.cos(a),48+37*math.sin(a))],['#E9B43E','#D94B57','#6C91DC'][j%3],5)
    icon_atlas.paste(im.resize((IW,IH),Image.Resampling.LANCZOS),((k%IC)*IW,(k//IC)*IH))
buf=io.BytesIO();icon_atlas.quantize(colors=128,method=Image.Quantize.FASTOCTREE).save(buf,format='PNG',optimize=True);g.g['images'].append({'name':'State and mood icon atlas','bufferView':g.view(buf.getvalue()),'mimeType':'image/png'});g.g['textures'].append({'sampler':0,'source':2});M['icon']=g.material('StatusIconAtlas','FFFFFF',.98,alphaMode='MASK',alphaCutoff=.22,doubleSided=True);g.g['materials'][M['icon']]['pbrMetallicRoughness']['baseColorTexture']={'index':2}
# A compact floating sign above the upper-right head corner; hidden in idle.
badge=g.node('StatusIcon',head,t=[.46,1.00,.34],s=[0,0,0]);g.node('StatusIconAtlas',badge,g.mesh('State icon quad',[[-.18,-.18,0],[.18,-.18,0],[-.18,.18,0],[.18,.18,0]],[[0,0,1]]*4,[0,1,2,1,3,2],M['icon'],[[0,1/IR],[1/IC,1/IR],[0,0],[1/IC,0]]))
state_icons={'working':'dots','chat':'dots','question':'question','searching':'search','approval':'thumb','error':'alert','finished':'check','ratelimit':'clock','sleeping':'sleep','dizzy':'spiral','create':'idea','celebrate':'confetti'}
face_icons={'love':'heart','proud':'stars','surprised':'exclaim','confused':'spiral','annoyed':'anger','sleeping':'sleep','dizzy':'spiral','error':'alert','finished':'check','approval':'thumb','searching':'search','curious':'question','yawn':'sleep','joyful':'stars'}
# Named clips, short low-keyframe tracks. No repeated facial animation channels.
S={'idle':(8,'loop','neutral'),'working':(3,'loop','neutral'),'thinking':(4,'loop','thinking'),'searching':(3.2,'loop','curious'),'approval':(2.6,'loop','approval'),'question':(3.6,'loop','curious'),'error':(2.5,'loop','error'),'finished':(2.2,'once','finished'),'ratelimit':(4,'loop','concerned'),'sleeping':(7,'loop','sleeping'),'dizzy':(3,'loop','dizzy'),'chat':(3,'loop','happy'),'wave':(2.8,'once','happy'),'analyze':(4,'loop','thinking'),'present':(3.6,'loop','confident'),'create':(3.4,'loop','joyful'),'organize':(4,'loop','neutral'),'teach':(3.4,'loop','confident'),'support':(3.2,'loop','happy'),'celebrate':(2.6,'once','joyful'),'laptop':(3.5,'loop','neutral')}
# Analytic, continuous motion sampled densely. Two-bone IK for chin contact.
# Local -Y is the rest direction of both arm segments.
def aim(v):return Rotation.align_vectors([np.asarray(v)/np.linalg.norm(v)],[[0,-1,0]])[0]
def chin_pose(hr,w):
    # Anchor the mitten to the tilted head, just below the chin. Bend elbow out.
    target=np.array([0,.77,0])+Rotation.from_euler('xyz',hr,degrees=True).apply([.145,.065,.319]);origin=shoulders[1];delta=target-origin;dist=np.linalg.norm(delta);v=delta/dist;L1=.185;L2=.184;dist=min(dist,L1+L2-.005);target=origin+v*dist
    outward=np.array([1.,-.28,.12]);outward-=v*(outward@v);outward/=np.linalg.norm(outward);along=(L1*L1-L2*L2+dist*dist)/(2*dist);height=math.sqrt(max(0,L1*L1-along*along));joint=origin+along*v+height*outward
    upper=aim(joint-origin);lower=aim(target-joint);return upper.as_quat().tolist(),(upper.inv()*lower).as_quat().tolist()
for state,(d,loop,mood) in S.items():
    times=np.linspace(0,d,max(3,int(d*12)+1) if state!='idle' else 17);B=[];H=[];A=[[],[]];E=[[],[]]
    for t in times:
        u=t/d;w=math.sin(2*math.pi*u);v=math.sin(4*math.pi*u);p=math.sin(math.pi*u)**2;hr=[.15*w,.35*w,.25*w];br=[0,0,0];ar=[[-1,0,-13],[-1,0,13]];el=[[0,0,0],[0,0,0]]
        if state=='idle':hr=[.14*w,.28*w,.35*p];br=[0,0,.10*p]
        elif state in ('working','laptop','organize'):hr=[5+1.2*w,1.4*w,0];ar=[[-15+2*w,0,-14],[-15-2*w,0,14]];el=[[-40+4*v,0,0],[-40-4*v,0,0]]
        elif state in ('thinking','analyze'):hr=[4+1.0*w,2*w,-5+1.2*w]
        elif state=='searching':hr=[-1,14*w,2*w]
        elif state=='approval':hr=[3+5*w,0,0];ar[1]=[-19,0,27];el[1]=[-48,0,3]
        elif state=='question':hr=[-3,3*w,7];ar=[[-12,0,-28],[-12,0,28]];el=[[-30,0,-5],[-30,0,5]]
        elif state=='error':hr=[3,4*w,0]
        elif state=='finished':hr=[-4*p,0,0];ar[1]=[-18*p,0,13+36*p];el[1]=[-28*p,0,0]
        elif state=='ratelimit':hr=[4,0,-3]
        elif state=='sleeping':hr=[8+.8*w,0,-5]
        elif state=='dizzy':hr=[3*w,6*w,8*w];br=[0,0,2*w]
        elif state=='chat':hr=[1,2*w,1*w];ar[1]=[-14+3*w,0,23+4*w];el[1]=[-27+5*v,0,0]
        elif state=='wave':hr=[0,0,-3*p];ar[1]=[-4*p,0,13+68*p];el[1]=[-5*p,0,20*p+20*v*p]
        elif state in ('present','create','teach','support'):hr=[-2,2*w,-2];ar[1]=[-20+2*w,0,37+4*w];el[1]=[-23+4*w,0,0]
        elif state=='celebrate':hr=[-5*p,0,2*w*p];ar=[[-5*p,0,-13-87*p],[-5*p,0,13+87*p]];el=[[-9*p,0,-8*p],[-9*p,0,8*p]]
        B.append(Q(br));H.append(Q(hr))
        for i in range(2):
            if i==1 and state in ('thinking','analyze'):a,e=chin_pose(hr,w);A[i].append(a);E[i].append(e)
            else:A[i].append(Q(ar[i]));E[i].append(Q(el[i]))
    tracks=[]
    for n,arr in [(body,B),(head,H),(arms[0],A[0]),(arms[1],A[1]),(elbows[0],E[0]),(elbows[1],E[1])]:
        if np.allclose(arr,arr[0]):tracks.append((n,'rotation',[0,d],[arr[0],arr[0]],'LINEAR'))
        else:tracks.append((n,'rotation',times,arr,'LINEAR'))
    g.anim(state,tracks,{'category':'state','playback':loop,'suggestedExpression':mood})
# Mesh sharing, reduced JSON overhead and removal of unused materials.
used=sorted({p['material'] for m in g.g['meshes'] for p in m['primitives']});remap={old:i for i,old in enumerate(used)};g.g['materials']=[g.g['materials'][i] for i in used]
for m in g.g['meshes']:
    for p in m['primitives']:p['material']=remap[p['material']]
# Combine static mesh primitives on each parent by material, baking local transforms.
# Leave all animated pivots and the runtime-swappable FaceAtlas node intact.
# The shared primitives already deduplicate geometry; avoid duplicating geometry to batch.
g.g['extras']={'MAYA':{'version':'3.0.0','states':{k:{'duration':v[0],'playback':v[1],'expression':v[2]} for k,v in S.items()},'expressions':expressions[:-1],'atlas':{'columns':cols,'rows':rows,'tileOrder':expressions,'node':'FaceAtlas'},'iconAtlas':{'columns':IC,'rows':IR,'tileOrder':icons,'node':'StatusIconAtlas','pivot':'StatusIcon'},'stateIcons':state_icons,'expressionIcons':face_icons,'logo':'Original provided artwork resized, not redrawn','defaultState':'idle','defaultExpression':'neutral'}}
g.save(args.out);print('wrote',args.out,len(pathlib.Path(args.out).read_bytes()),'bytes;',len(g.g['nodes']),'nodes;',len(g.g['meshes']),'meshes;',len(g.g['animations']),'animations')

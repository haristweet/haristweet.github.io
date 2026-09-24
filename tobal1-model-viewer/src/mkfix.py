import struct, json
class Bits:
    def __init__(s): s.buf=bytearray(); s.pos=0
    def w(s,val,n):
        for k in range(n):
            bit=(val>>k)&1
            byte=s.pos>>3
            while len(s.buf)<=byte: s.buf.append(0)
            if bit: s.buf[byte]|=1<<(s.pos&7)
            s.pos+=1
def compress_mode0(data):
    b=Bits(); b.w(0x0b,8); total=len(data)
    b.w(total&0xffff,16); b.w(total>>16,8)
    rem=total; off=0
    while rem>0:
        chunk=min(rem,256); rem-=chunk
        b.w(0,4)
        for i in range((chunk+3)//4):
            grp=data[off+i*4:off+i*4+4]; grp=grp+bytes(4-len(grp))
            b.w(struct.unpack('<I',grp)[0],32)
        off+=chunk
    return bytes(b.buf)

def make_block():
    # blk を組み立ててから、先頭8バイトを外したものが「部分0の中身」
    blk=bytearray(0x400)
    DL=0x40
    verts=[(0,0,0),(120,0,0),(0,120,0),(0,0,120)]   # 平面にせず、どの向きからも見えるように
    VP=0x100; CP=0x140; FP=0x180; BONE=0x1a0
    struct.pack_into('<i',blk,0x10,FP-16)          # h(4) 面
    struct.pack_into('<i',blk,0x14,VP-16)          # h(5) 頂点
    struct.pack_into('<i',blk,0x1c,CP-16)          # h(7) 色
    struct.pack_into('<i',blk,0x20,-4)             # ヘッダを飛び越す
    struct.pack_into('<i',blk,0x24,DL-0x20)
    struct.pack_into('<I',blk,0x2c,BONE)           # 骨の表のあるところ
    o=DL
    struct.pack_into('<ii',blk,o,-3,1); o+=8                 # 関節 1
    struct.pack_into('<iiii',blk,o,2,0,4,0); o+=16           # 頂点 4つ（色つき）
    struct.pack_into('<ii',blk,o,32,2); o+=8                 # 三角形 2枚
    struct.pack_into('<ii',blk,o,0,0)                        # 終わり
    for i,(x,y,z) in enumerate(verts): struct.pack_into('<hhhh',blk,VP+i*8,x,y,z,0)
    for i in range(4): blk[CP+i*4:CP+i*4+4]=bytes([200,150,100,0])
    blk[FP+0:FP+4]=bytes([0,1,2,0])
    blk[FP+4:FP+8]=bytes([0,1,3,0])
    struct.pack_into('<I',blk,BONE+0x2c,41*8)                # 骨の数×8
    for k in range(41): struct.pack_into('<hhhh',blk,BONE+0x30+k*8,0,-30*(k%4),0,0)
    return bytes(blk[8:])                                    # 先頭8バイトはビューア側で足す

def pack(parts):
    n=len(parts); head=4+4*(n+1); offs=[head]
    for p in parts: offs.append(offs[-1]+len(p))
    out=struct.pack('<I',n)+b''.join(struct.pack('<I',o) for o in offs)+b''.join(parts)
    return out

def vram_part():
    w,h=8,4
    body=struct.pack('<HHHHHH',64,32,0,0,w,h)+bytes(w*h*2)
    return struct.pack('<I',1)+body

def make_block_variant():
    """トバル2 とは並びが違うモデル（頂点/面/色の位置が語2/3/4、描画命令が 0x18、ずらしなし）"""
    blk=bytearray(0x400)
    DL=0x18
    verts=[(10,-20,30),(120,0,0),(0,120,0),(0,0,120)]
    VP=0x100; CP=0x140; FP=0x180
    struct.pack_into('<I',blk,0x08,VP)     # 語2 = 頂点
    struct.pack_into('<I',blk,0x0c,FP)     # 語3 = 面
    struct.pack_into('<I',blk,0x10,CP)     # 語4 = 色
    o=DL
    struct.pack_into('<ii',blk,o,-3,1); o+=8
    struct.pack_into('<iiii',blk,o,2,0,4,0); o+=16
    struct.pack_into('<ii',blk,o,32,2); o+=8
    struct.pack_into('<ii',blk,o,0,0)
    for i,(x,y,z) in enumerate(verts): struct.pack_into('<hhhh',blk,VP+i*8,x,y,z,0)
    for i in range(4): blk[CP+i*4:CP+i*4+4]=bytes([200,150,100,0])
    blk[FP+0:FP+4]=bytes([0,1,2,0])
    blk[FP+4:FP+8]=bytes([0,1,3,0])
    return bytes(blk[8:])

def make_block_tobal1():
    """実物のトバルNo.1 で見えたヘッダ形を模したもの。
       先頭が 0x90000000、語1 (=0x14) の先に「位置」が4つ並び、位置はデータ先頭からの相対"""
    blk=bytearray(0x800)
    DL=0x140; VP=0x300; FP=0x400; CP=0x480     # blk の中での位置
    struct.pack_into('<I',blk,0x08,0x90000000) # データ語0 = 印
    struct.pack_into('<I',blk,0x0c,0x14)       # データ語1 = 位置表のあるところ
    # データ語5..8（= blk 0x1c..0x28）に位置。値はデータ先頭からの相対なので blk 位置 - 8
    for i,v in enumerate([DL-8,VP-8,FP-8,CP-8]): struct.pack_into('<I',blk,0x1c+i*4,v)
    verts=[(15,-25,35),(130,0,0),(0,130,0),(0,0,130),(130,130,0)]
    o=DL
    struct.pack_into('<ii',blk,o,-3,1); o+=8
    struct.pack_into('<iiii',blk,o,2,0,len(verts),0); o+=16
    struct.pack_into('<ii',blk,o,32,3); o+=8
    struct.pack_into('<ii',blk,o,0,0)
    for i,(x,y,z) in enumerate(verts): struct.pack_into('<hhhh',blk,VP+i*8,x,y,z,0)
    for i in range(len(verts)): blk[CP+i*4:CP+i*4+4]=bytes([190,140,90,0])
    blk[FP+0:FP+4]=bytes([0,1,2,0]); blk[FP+4:FP+8]=bytes([0,1,3,0]); blk[FP+8:FP+12]=bytes([1,4,2,0])
    return bytes(blk[8:])

open('fixture_model_t1.bin','wb').write(pack([compress_mode0(make_block_tobal1()),b'\x00'*32,vram_part(),b'\x00'*16]))
open('fixture_model_v2.bin','wb').write(pack([compress_mode0(make_block_variant()),b'\x00'*32,vram_part(),b'\x00'*16]))
def make_t1_part(nv=51, ntri=64):
    """実物 sector 5927 の部品の形。面は 12バイトで1枚、u32×3 が頂点番号の4倍"""
    VERT=0x38; NORM=VERT+nv*8; FACE=NORM+nv*8
    FB=ntri*12
    COL=FACE+FB; END=COL+nv*4
    b=bytearray(END)
    struct.pack_into('<4I', b, 0, FACE, VERT, NORM, COL)
    struct.pack_into('<3I', b, 0x10, 5, 2, 0)
    struct.pack_into('<2I', b, 0x1c, nv, nv)
    struct.pack_into('<4I', b, 0x24, 10, 20, 11, 33)   # 実物と同じ並び（20+11+33=64）
    struct.pack_into('<I',  b, 0x34, 0)
    for i in range(nv):
        struct.pack_into('<hhhh', b, VERT+i*8, (i%7)*40-120, (i//7)*35-100, (i%5)*30-60, 0)
        struct.pack_into('<hhhh', b, NORM+i*8, 0, 4096, 0, 0)
        b[COL+i*4:COL+i*4+4]=bytes([200-(i%100), 150, 100+(i%100), 0])
    for k in range(ntri):
        a=(k*3)%nv; c=(k*3+1)%nv; e=(k*3+2)%nv
        struct.pack_into('<3I', b, FACE+k*12, a*4, c*4, e*4)
    return bytes(b)

def make_t1_part_n(nv=80, nface=50):
    """キャラクター本体の部品。面は「頂点番号 u32(4倍)×3か4 ＋ 法線 int16 x,y,z,0」。
    三角形20バイト・四角形24バイトが混ざって並ぶ（実物 sector 5927 の +0x0034 と同じ）"""
    import math
    sides=[4 if k%3 else 3 for k in range(nface)]
    FB=sum(n*4+8 for n in sides)
    VERT=0x38; NORM=VERT+nv*8; FACE=NORM+nv*8; COL=FACE+FB; END=COL+nv*4
    b=bytearray(END)
    struct.pack_into('<4I', b, 0, FACE, VERT, NORM, COL)
    struct.pack_into('<3I', b, 0x10, 5, 1, 0)
    for i in range(nv):
        t=i/nv*6.283; r=90+(i%5)*12
        struct.pack_into('<hhhh', b, VERT+i*8,
                         int(r*math.cos(t)), (i//8)*40-160, int(r*math.sin(t)), 0)
        struct.pack_into('<hhhh', b, NORM+i*8, 0, 4096, 0, 0)
        b[COL+i*4:COL+i*4+4]=bytes([210-(i%80), 160, 120+(i%80), 0])
    p=FACE
    for k,n in enumerate(sides):
        for j in range(n): struct.pack_into('<I', b, p+j*4, ((k*2+j)%nv)*4)
        a=k/nface*6.283
        v=(math.cos(a), math.sin(a)*0.3, math.sin(a)*0.95)
        l=math.hypot(*v) or 1
        struct.pack_into('<hhhh', b, p+n*4, *[int(c*4096/l) for c in v], 0)
        p+=n*4+8
    assert p==COL
    return bytes(b)

def make_t1_model():
    """0x90000000 のモデル。部品を4つ並べ、先頭に「個数＋位置」を置く"""
    parts=[make_t1_part(51),make_t1_part(48),make_t1_part_n(80,50),make_t1_part(33)]
    head=0x40
    offs=[]; body=bytearray()
    for p in parts:
        offs.append(head+len(body)); body+=p
        while len(body)%4: body.append(0)
    d=bytearray(head)+body
    struct.pack_into('<I', d, 0x00, 0x90000000)
    struct.pack_into('<I', d, 0x04, 0x3c)
    struct.pack_into('<I', d, 0x08, len(offs))
    for i,o in enumerate(offs): struct.pack_into('<I', d, 0x0c+i*4, o)
    struct.pack_into('<I', d, 0x0c+len(offs)*4, 0)
    return bytes(d)

# ページ側で通しの確認をするための一式
t1file=pack([compress_mode0(make_t1_model()), b'\x00'*32])
arc=bytearray(b'dummy'.ljust(2048, b'\0'))
arc+=t1file+bytes((-len(t1file))%2048)
arc+=bytes(2048)
open('fixture_t1_arc.bin','wb').write(arc)
exe=bytearray(0x800+0x2000)
exe[0:8]=b'PS-X EXE'
struct.pack_into('<I',exe,0x18,0x80010000); struct.pack_into('<I',exe,0x1c,0x2000)
open('fixture_t1_exe.bin','wb').write(exe)

model=compress_mode0(make_block())
file0=pack([model,b'\x00'*32,vram_part(),b'\x00'*16])
open('fixture_model.bin','wb').write(file0)

# 偽のアーカイブと実行ファイル（ファイル表さがしの確認用）
entries=[]; arc=bytearray(); sector=0
for i in range(200):
    data=file0 if i%3==0 else bytes([i&0xff])*(1000+i*7)
    entries.append((sector,len(data)))
    pad=(-len(data))%2048
    arc+=data+bytes(pad); sector+=(len(data)+pad)//2048
open('fixture_arc.bin','wb').write(arc)

TEXT=0x80010000; TBL=0x800CD660
exe=bytearray(0x800+0xC0000)
exe[0:8]=b'PS-X EXE'
struct.pack_into('<I',exe,0x10,0x80020000)
struct.pack_into('<I',exe,0x18,TEXT)
struct.pack_into('<I',exe,0x1c,0xC0000)
base=0x800+(TBL-TEXT)
for i,(sec,size) in enumerate(entries):
    struct.pack_into('<II',exe,base+i*8,sec,(size<<8)|(3 if i%3==0 else 5))
open('fixture_exe.bin','wb').write(exe)
print(json.dumps({'model_file':len(file0),'arc':len(arc),'exe':len(exe),'table_off':base,'entries':len(entries)}))

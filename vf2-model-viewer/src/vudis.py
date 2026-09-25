# PS2 の VU1 のプログラムを読む（逆アセンブル）。python3 vudis.py disc/states/01_akira_lau/vu1MicroMem.bin [始め 終わり（VU の番地、8 の倍数）]
# 本体の名前の表の番地（gfxDefaultVU1code 0x1f2000 から。0x800 バイトごとに 8 バイトの VIF の区切り）を VU の番地に直して、名札を付ける
import struct, sys, re
BC='xyzw'
def dest(w): d=w>>21&15; return '.'+''.join(c for i,c in enumerate('xyzw') if d>>(3-i)&1) if d else ''
def upper(w):
    fl=('[I]' if w>>31&1 else '')+('[E]' if w>>30&1 else '')+('[M]' if w>>29&1 else '')+('[D]' if w>>28&1 else '')+('[T]' if w>>27&1 else '')
    ft,fs,fd,op=w>>16&31,w>>11&31,w>>6&31,w&63; D=dest(w)
    b=BC[op&3]
    names={0:'ADD',1:'SUB',2:'MADD',3:'MSUB',4:'MAX',5:'MINI',6:'MUL'}
    if op<0x1c: return f'{names[op>>2]}{b}{D} vf{fd:02d},vf{fs:02d},vf{ft:02d}{b}'+fl
    t={0x1c:'MULq',0x1d:'MAXi',0x1e:'MULi',0x1f:'MINIi',0x20:'ADDq',0x21:'MADDq',0x22:'ADDi',0x23:'MADDi',0x24:'SUBq',0x25:'MSUBq',0x26:'SUBi',0x27:'MSUBi',
       0x28:'ADD',0x29:'MADD',0x2a:'MUL',0x2b:'MAX',0x2c:'SUB',0x2d:'MSUB',0x2e:'OPMSUB',0x2f:'MINI'}
    if op in t:
        n=t[op]
        if n[-1] in 'qi' and len(n)<=6: return f'{n}{D} vf{fd:02d},vf{fs:02d},{n[-1].upper()}'+fl
        return f'{n}{D} vf{fd:02d},vf{fs:02d},vf{ft:02d}'+fl
    if op>=0x3c:
        o=((w>>6&31)<<2)|(w&3)
        if o<0x10: return f'{["ADDA","SUBA","MADDA","MSUBA"][o>>2]}{BC[o&3]}{D} ACC,vf{fs:02d},vf{ft:02d}{BC[o&3]}'+fl
        s={0x10:'ITOF0',0x11:'ITOF4',0x12:'ITOF12',0x13:'ITOF15',0x14:'FTOI0',0x15:'FTOI4',0x16:'FTOI12',0x17:'FTOI15'}
        if o in s: return f'{s[o]}{D} vf{ft:02d},vf{fs:02d}'+fl
        if 0x18<=o<0x1c: return f'MULA{BC[o&3]}{D} ACC,vf{fs:02d},vf{ft:02d}{BC[o&3]}'+fl
        s={0x1c:'MULAq',0x1d:'ABS',0x1e:'MULAi',0x1f:'CLIPw',0x20:'ADDAq',0x21:'MADDAq',0x22:'ADDAi',0x23:'MADDAi',0x24:'SUBAq',0x25:'MSUBAq',0x26:'SUBAi',0x27:'MSUBAi',
           0x28:'ADDA',0x29:'MADDA',0x2a:'MULA',0x2c:'SUBA',0x2d:'MSUBA',0x2e:'OPMULA',0x2f:'NOP'}
        n=s.get(o,'?%02x'%o)
        if n=='NOP': return 'NOP'+fl
        if n=='ABS': return f'ABS{D} vf{ft:02d},vf{fs:02d}'+fl
        if n=='CLIPw': return f'CLIPw.xyz vf{fs:02d},vf{ft:02d}w'+fl
        if n[-1] in 'qi': return f'{n}{D} ACC,vf{fs:02d},{n[-1].upper()}'+fl
        return f'{n}{D} ACC,vf{fs:02d},vf{ft:02d}'+fl
    return '?up%02x'%op
def s11(v): return v-2048 if v&1024 else v
def lower(w,pc,iflag,labels):
    if iflag: return 'LOI %g'%struct.unpack('<f',struct.pack('<I',w))[0]
    if w==0x8000033c: return 'NOP'
    it,is_,fd,D=w>>16&31,w>>11&31,w>>6&31,dest(w)
    if w>>25==0x40:
        op=w&63
        t={0x30:'IADD',0x31:'ISUB',0x32:'IADDI',0x34:'IAND',0x35:'IOR'}
        if op in t:
            if op==0x32: return f'IADDI vi{it:02d},vi{is_:02d},{(fd-32 if fd&16 else fd)}'
            return f'{t[op]} vi{fd:02d},vi{is_:02d},vi{it:02d}'
        if op>=0x3c:
            o=((w>>6&31)<<2)|(w&3)
            s={0x30:'MOVE',0x31:'MR32',0x34:'LQI',0x35:'SQI',0x36:'LQD',0x37:'SQD',0x38:'DIV',0x39:'SQRT',0x3a:'RSQRT',0x3b:'WAITQ',0x3c:'MTIR',0x3d:'MFIR',
               0x3e:'ILWR',0x3f:'ISWR',0x40:'RNEXT',0x41:'RGET',0x42:'RINIT',0x43:'RXOR',0x64:'MFP',0x68:'XTOP',0x69:'XITOP',0x6c:'XGKICK',
               0x70:'ESADD',0x71:'ERSADD',0x72:'ELENG',0x73:'ERLENG',0x74:'EATANxy',0x75:'EATANxz',0x76:'ESUM',0x78:'ESQRT',0x79:'ERSQRT',0x7a:'ERCPR',0x7b:'WAITP',0x7c:'ESIN',0x7d:'EATAN',0x7e:'EEXP'}
            n=s.get(o,'?lo%02x'%o); fsf=BC[w>>21&3]; ftf=BC[w>>23&3]
            if n in('MOVE','MR32'): return f'{n}{D} vf{it:02d},vf{is_:02d}'
            if n in('LQI','LQD'): return f'{n}{D} vf{it:02d},(vi{is_:02d}{"++" if n=="LQI" else "--"})'
            if n in('SQI','SQD'): return f'{n}{D} vf{is_:02d},(vi{it:02d}{"++" if n=="SQI" else "--"})'
            if n=='DIV': return f'DIV Q,vf{is_:02d}{fsf},vf{it:02d}{ftf}'
            if n in('SQRT','RSQRT'): return f'{n} Q,'+(f'vf{is_:02d}{fsf},' if n=='RSQRT' else '')+f'vf{it:02d}{ftf}'
            if n=='MTIR': return f'MTIR vi{it:02d},vf{is_:02d}{fsf}'
            if n=='MFIR': return f'MFIR{D} vf{it:02d},vi{is_:02d}'
            if n in('ILWR','ISWR'): return f'{n}{D} vi{it:02d},(vi{is_:02d})'
            if n=='XGKICK': return f'XGKICK vi{is_:02d}'
            if n in('XTOP','XITOP'): return f'{n} vi{it:02d}'
            if n=='MFP': return f'MFP{D} vf{it:02d},P'
            if n in('WAITQ','WAITP'): return n
            if n[0]=='E': return f'{n} P,vf{is_:02d}'+(fsf if n in('ESQRT','ERSQRT','ERCPR','ESIN','EATAN','EEXP') else '')
            return f'{n} vf{it:02d},vf{is_:02d}'
        return '?lo40_%02x'%op
    op=w>>25; imm=s11(w&2047)
    tgt=lambda: labels.get(pc+8+imm*8,'%04x'%(pc+8+imm*8))
    if op==0x00: return f'LQ{D} vf{it:02d},{imm}(vi{is_:02d})'
    if op==0x01: return f'SQ{D} vf{is_:02d},{imm}(vi{it:02d})'
    if op==0x04: return f'ILW{D} vi{it:02d},{imm}(vi{is_:02d})'
    if op==0x05: return f'ISW{D} vi{it:02d},{imm}(vi{is_:02d})'
    if op in(0x08,0x09):
        v=((w>>21&15)<<11)|(w&2047); return f'{"IADDIU" if op==8 else "ISUBIU"} vi{it:02d},vi{is_:02d},{v}'
    fc={0x10:'FCEQ',0x11:'FCSET',0x12:'FCAND',0x13:'FCOR',0x14:'FSEQ',0x15:'FSSET',0x16:'FSAND',0x17:'FSOR',0x18:'FMEQ',0x1a:'FMAND',0x1b:'FMOR',0x1c:'FCGET'}
    if op in fc:
        if op in(0x10,0x11,0x12,0x13): return f'{fc[op]} vi01,0x{w&0xffffff:06x}'
        if op in(0x14,0x15,0x16,0x17): return f'{fc[op]} vi{it:02d},0x{((w>>10&0x800)|(w&0x7ff)):x}'
        return f'{fc[op]} vi{it:02d},vi{is_:02d}'
    if op==0x20: return f'B {tgt()}'
    if op==0x21: return f'BAL vi{it:02d},{tgt()}'
    if op==0x24: return f'JR vi{is_:02d}'
    if op==0x25: return f'JALR vi{it:02d},vi{is_:02d}'
    br={0x28:'IBEQ',0x29:'IBNE',0x2c:'IBLTZ',0x2d:'IBGTZ',0x2e:'IBLEZ',0x2f:'IBGEZ'}
    if op in br: return f'{br[op]} vi{it:02d},vi{is_:02d},{tgt()}' if op in(0x28,0x29) else f'{br[op]} vi{is_:02d},{tgt()}'
    return '?lo%02x'%op
def labels_from_syms(path='disc/x/vusyms.txt'):
    lab={}
    for l in open(path):
        a,_,n=l.split(); a=int(a,16)
        if not n.startswith('_$') or a<0x1f2008: continue
        rel=a-0x1f2008; vu=rel-8*(rel//0x808)
        lab[vu]=n[2:]
    return lab
if __name__=='__main__':
    code=open(sys.argv[1],'rb').read(); lab=labels_from_syms()
    a0=int(sys.argv[2],16) if len(sys.argv)>2 else 0; a1=int(sys.argv[3],16) if len(sys.argv)>3 else len(code)
    for pc in range(a0,a1,8):
        lo,up=struct.unpack_from('<II',code,pc)
        if pc in lab: print(f'\n{lab[pc]}:')
        print(f'{pc:04x}  {upper(up):40s} {lower(lo,pc,up>>31&1,lab)}')

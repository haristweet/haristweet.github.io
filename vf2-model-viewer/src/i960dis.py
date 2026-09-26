# i960（Model 2 の主 CPU）の逆アセンブラー。アーケードのプログラム＝PS2 の IC12_15 の展開後（disc/bin/IC12_15.dec。番地 0 から）
#   python3 i960dis.py disc/bin/IC12_15.dec 始め(16進) [命令数]
# 形式: CTRL（上位 0x00〜1f）・COBR（0x20〜3f）・REG（0x58〜7f、下位の番号は bit7-10）・MEM（0x80〜ff。MEMB は 32bit の変位が続くことがある）
import struct, sys

CTRL = {0x08:'b',0x09:'call',0x0a:'ret',0x0b:'bal',0x10:'bno',0x11:'bg',0x12:'be',0x13:'bge',0x14:'bl',0x15:'bne',0x16:'ble',0x17:'bo',
        0x18:'faultno',0x19:'faultg',0x1a:'faulte',0x1b:'faultge',0x1c:'faultl',0x1d:'faultne',0x1e:'faultle',0x1f:'faulto'}
COBR = {0x20:'testno',0x21:'testg',0x22:'teste',0x23:'testge',0x24:'testl',0x25:'testne',0x26:'testle',0x27:'testo',
        0x30:'bbc',0x31:'cmpobg',0x32:'cmpobe',0x33:'cmpobge',0x34:'cmpobl',0x35:'cmpobne',0x36:'cmpoble',0x37:'bbs',
        0x38:'cmpibno',0x39:'cmpibg',0x3a:'cmpibe',0x3b:'cmpibge',0x3c:'cmpibl',0x3d:'cmpibne',0x3e:'cmpible',0x3f:'cmpibo'}
MEM = {0x80:'ldob',0x82:'stob',0x84:'bx',0x85:'balx',0x86:'callx',0x88:'ldos',0x8a:'stos',0x8c:'lda',0x90:'ld',0x92:'st',
       0x98:'ldl',0x9a:'stl',0xa0:'ldt',0xa2:'stt',0xb0:'ldq',0xb2:'stq',0xc0:'ldib',0xc2:'stib',0xc8:'ldis',0xca:'stis'}
REG = {0x580:'notbit',0x581:'and',0x582:'andnot',0x583:'setbit',0x584:'notand',0x586:'xor',0x587:'or',0x588:'nor',0x589:'xnor',
       0x58a:'not',0x58b:'ornot',0x58c:'clrbit',0x58d:'notor',0x58e:'nand',0x58f:'alterbit',0x590:'addo',0x591:'addi',0x592:'subo',
       0x593:'subi',0x598:'shro',0x59a:'shrdi',0x59b:'shri',0x59c:'shlo',0x59d:'rotate',0x59e:'shli',0x5a0:'cmpo',0x5a1:'cmpi',
       0x5a2:'concmpo',0x5a3:'concmpi',0x5a4:'cmpinco',0x5a5:'cmpinci',0x5a6:'cmpdeco',0x5a7:'cmpdeci',0x5ac:'scanbyte',0x5ae:'chkbit',
       0x5b0:'addc',0x5b2:'subc',0x5cc:'mov',0x5dc:'movl',0x5ec:'movt',0x5fc:'movq',0x610:'atmod',0x612:'atadd',0x640:'spanbit',
       0x641:'scanbit',0x645:'modac',0x650:'modify',0x651:'extract',0x654:'modtc',0x655:'modpc',0x660:'calls',0x66b:'mark',
       0x66c:'fmark',0x66d:'flushreg',0x66f:'syncf',0x670:'emul',0x671:'ediv',0x701:'mulo',0x708:'remo',0x70b:'divo',0x741:'muli',
       0x748:'remi',0x749:'modi',0x74b:'divi',
       0x674:'cvtir',0x675:'cvtilr',0x676:'scalerl',0x677:'scaler',0x680:'atanr',0x681:'logepr',0x682:'logr',0x683:'remr',0x684:'cmpor',
       0x685:'cmpr',0x688:'sqrtr',0x689:'expr',0x68a:'logbnr',0x68b:'roundr',0x68c:'sinr',0x68d:'cosr',0x68e:'tanr',0x68f:'classr',
       0x690:'atanrl',0x691:'logeprl',0x692:'logrl',0x693:'remrl',0x694:'cmporl',0x695:'cmprl',0x698:'sqrtrl',0x699:'exprl',
       0x69a:'logbnrl',0x69b:'roundrl',0x69c:'sinrl',0x69d:'cosrl',0x69e:'tanrl',0x69f:'classrl',0x6c0:'cvtri',0x6c1:'cvtril',
       0x6c2:'cvtzri',0x6c3:'cvtzril',0x6c9:'movr',0x6d9:'movrl',0x6e1:'movre',0x6e2:'cpysre',0x6e3:'cpyrsre',
       0x78b:'divr',0x78c:'mulr',0x78d:'subr',0x78f:'addr',0x79b:'divrl',0x79c:'mulrl',0x79d:'subrl',0x79f:'addrl'}
RN = ['pfp','sp','rip','r3','r4','r5','r6','r7','r8','r9','r10','r11','r12','r13','r14','r15',
      'g0','g1','g2','g3','g4','g5','g6','g7','g8','g9','g10','g11','g12','g13','g14','fp']
FR = ['fp0','fp1','fp2','fp3']

def sx(v, bits):
    return v - (1 << bits) if v & (1 << (bits - 1)) else v

def dis(code, a):
    """番地 a の1命令。 (文字列, 長さ, 飛び先 or None)"""
    w = struct.unpack_from('<I', code, a)[0]; op = w >> 24
    if op < 0x20:
        d = sx(w & 0xfffffc, 24); t = a + d
        n = CTRL.get(op, '?ctrl%02x' % op)
        return (n if op == 0x0a else '%s 0x%x' % (n, t)), 4, (None if op == 0x0a else t)
    if op < 0x40:
        s1 = (w >> 19) & 31; s2 = (w >> 14) & 31; m1 = (w >> 13) & 1; d = sx(w & 0x1ffc, 13); t = a + d
        n = COBR.get(op, '?cobr%02x' % op)
        a1 = str(s1) if m1 else RN[s1]
        if op < 0x28: return '%s %s' % (n, RN[s1]), 4, None
        return '%s %s,%s,0x%x' % (n, a1, RN[s2], t), 4, t
    if op < 0x80:
        o = (op << 4) | ((w >> 7) & 15)
        dst = (w >> 19) & 31; s2 = (w >> 14) & 31; s1 = w & 31
        m1 = (w >> 11) & 1; m2 = (w >> 12) & 1; m3 = (w >> 13) & 1; sf1 = (w >> 5) & 1; sf2 = (w >> 6) & 1
        n = REG.get(o, '?reg%03x' % o)
        fl = (n.endswith('r') or n.endswith('rl')) and n not in ('or','xor','nor','notor','ornot') or n in ('movre', 'cpysre', 'cpyrsre')
        def opd(r, m, sf):
            if m: return (FR[r] if r < 4 else ('0.0' if r == 16 else '1.0' if r == 22 else '?f%d' % r)) if (fl and sf == 0) else str(r)
            return RN[r]
        A = opd(s1, m1, sf1); B = opd(s2, m2, sf2); C = (FR[dst] if (fl and m3 and dst < 4) else (str(dst) if m3 else RN[dst]))
        if n in ('mov', 'movl', 'movt', 'movq', 'not', 'movr', 'movrl', 'scanbit', 'spanbit', 'sqrtr', 'cvtir', 'cvtri', 'cvtzri'): return '%s %s,%s' % (n, A, C), 4, None
        if n in ('cmpo', 'cmpi', 'cmpr', 'cmprl', 'cmpor', 'chkbit', 'concmpo', 'concmpi'): return '%s %s,%s' % (n, A, B), 4, None
        if n in ('calls', 'mark', 'fmark', 'flushreg', 'syncf'): return '%s %s' % (n, A), 4, None
        return '%s %s,%s,%s' % (n, A, B, C), 4, None
    # MEM
    n = MEM.get(op, '?mem%02x' % op); sd = (w >> 19) & 31; ab = (w >> 14) & 31
    if not (w >> 12) & 1:  # MEMA
        off = w & 0xfff
        ea = ('0x%x(%s)' % (off, RN[ab])) if (w >> 13) & 1 else ('0x%x' % off)
        ln = 4
    else:
        mode = (w >> 10) & 15; sc = 1 << ((w >> 7) & 7); ix = w & 31; ln = 4; disp = None
        if mode in (5, 12, 13, 14, 15): disp = struct.unpack_from('<I', code, a + 4)[0]; ln = 8
        if mode == 4: ea = '(%s)' % RN[ab]
        elif mode == 5: ea = '0x%x(ip)' % (a + 8 + sx(disp, 32))
        elif mode == 7: ea = '(%s)[%s*%d]' % (RN[ab], RN[ix], sc)
        elif mode == 12: ea = '0x%x' % disp
        elif mode == 13: ea = '0x%x(%s)' % (disp, RN[ab])
        elif mode == 14: ea = '0x%x[%s*%d]' % (disp, RN[ix], sc)
        elif mode == 15: ea = '0x%x(%s)[%s*%d]' % (disp, RN[ab], RN[ix], sc)
        else: ea = '?mode%d' % mode
    if n in ('bx', 'balx', 'callx'): return '%s %s' % (n, ea), ln, None
    if n.startswith('st'): return '%s %s,%s' % (n, RN[sd], ea), ln, None
    return '%s %s,%s' % (n, ea, RN[sd]), ln, None

if __name__ == '__main__':
    code = open(sys.argv[1], 'rb').read(); a = int(sys.argv[2], 16); n = int(sys.argv[3]) if len(sys.argv) > 3 else 60
    for _ in range(n):
        s, ln, _t = dis(code, a); print('%06x  %08x  %s' % (a, struct.unpack_from('<I', code, a)[0], s)); a += ln

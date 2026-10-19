# R3000 の逆アセンブル（capstone）。python3 mipsdis.py ファイル 読み込み番地 [始め 数] / --ref 番地…（lui+即値でその番地を作る所を探す）
import sys, struct, capstone
f, base = sys.argv[1], int(sys.argv[2], 16); d = open(f, 'rb').read()
md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 + capstone.CS_MODE_LITTLE_ENDIAN)
def dis(a, n):
    o = a - base
    for i in md.disasm(d[o:o + n * 4], a): print(f'{i.address:08x}: {i.mnemonic} {i.op_str}')
if sys.argv[3] == '--ref':
    want = [int(x, 16) for x in sys.argv[4:]]
    W = [struct.unpack_from('<I', d, i)[0] for i in range(0, len(d) - 3, 4)]
    hi = {}
    for k, w in enumerate(W):
        op, rs, rt, imm = w >> 26, (w >> 21) & 31, (w >> 16) & 31, w & 0xffff
        if op == 15: hi[rt] = (imm << 16, k); continue
        if rs in hi and k - hi[rs][1] < 24 and op in (9, 13, 35, 43, 33, 37, 32, 36, 40, 41):
            v = hi[rs][0] + (imm if op == 13 else (imm - 65536 if imm & 0x8000 else imm))
            v &= 0xffffffff
            for x in want:
                if x <= v < x + 0x40: print(f'{base + k * 4:08x}: {v:08x} (+{v - x:x})')
else:
    dis(int(sys.argv[3], 16), int(sys.argv[4]) if len(sys.argv) > 4 else 40)

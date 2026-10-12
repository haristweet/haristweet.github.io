# 逆アセンブルした行を正規表現で探す。python3 mipsgrep.py ファイル 読み込み番地 正規表現
import sys, re, capstone
f, base, pat = sys.argv[1], int(sys.argv[2], 16), re.compile(sys.argv[3])
d = open(f, 'rb').read(); md = capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS32 + capstone.CS_MODE_LITTLE_ENDIAN)
st = 0x800 if d[:8] == b'PS-X EXE' else 0
for o in range(st, len(d) - 3, 4):
    for i in md.disasm(d[o:o + 4], base + o):
        s = f'{i.mnemonic} {i.op_str}'
        if pat.search(s): print(f'{i.address:08x}: {s}')

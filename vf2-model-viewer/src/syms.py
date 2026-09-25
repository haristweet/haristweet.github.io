# 本体 SLPM_625.47 の名前の表（.symtab）を読む。python3 syms.py disc/x/SLPM_625.47 [正規表現]
import struct, sys, re
def syms(d):
    shoff = struct.unpack_from('<I', d, 0x20)[0]; es, num, stx = struct.unpack_from('<HHH', d, 0x2e)
    sh = [struct.unpack_from('<10I', d, shoff + i * es) for i in range(num)]
    st = [s for s in sh if s[1] == 2][0]; strt = sh[st[6]][4]; out = {}
    for i in range(st[5] // 16):
        n, val, size = struct.unpack_from('<III', d, st[4] + i * 16)
        e = d.index(b'\0', strt + n); out[d[strt + n:e].decode()] = (val, size)
    return out
if __name__ == '__main__':
    s = syms(open(sys.argv[1], 'rb').read()); pat = re.compile(sys.argv[2] if len(sys.argv) > 2 else '')
    for k, (v, z) in sorted(s.items(), key=lambda x: x[1][0]):
        if pat.search(k): print(f'{v:08x} {z:6x} {k}')

# CVM（CRI ROFS）の中の ISO9660 を読む。python3 cvm.py disc/x/BIN.CVM [出力フォルダ]
import sys, struct, os
def files(d):
    base = d.find(b'\x01CD001') - 16 * 2048
    sec = lambda l, n=1: d[base + l * 2048: base + (l + n) * 2048]
    out = []
    def walk(l, s, path):
        data = sec(l, (s + 2047) // 2048); p = 0
        while p < len(data):
            L = data[p]
            if L == 0: p = (p // 2048 + 1) * 2048; continue
            el, es = struct.unpack_from('<I', data, p + 2)[0], struct.unpack_from('<I', data, p + 10)[0]
            fl, nl = data[p + 25], data[p + 32]; nm = data[p + 33:p + 33 + nl]
            if nm not in (b'\0', b'\1'):
                n = nm.decode('ascii', 'replace').split(';')[0]
                if fl & 2: walk(el, es, path + n + '/')
                else: out.append((path + n, d[base + el * 2048: base + el * 2048 + es]))
            p += L
    root = sec(16)[156:190]
    walk(struct.unpack_from('<I', root, 2)[0], struct.unpack_from('<I', root, 10)[0], '/')
    return out
if __name__ == '__main__':
    fs = files(open(sys.argv[1], 'rb').read())
    if len(sys.argv) > 2:
        os.makedirs(sys.argv[2], exist_ok=True)
        for n, b in fs: open(os.path.join(sys.argv[2], n.strip('/')), 'wb').write(b)
    else:
        for n, b in fs: print(len(b), n)

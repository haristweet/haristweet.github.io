# PS2 CD（MODE2/2352）の ISO9660 を読む。python3 iso.py disc/vf2.bin [取り出すパス 出力]
import sys, struct
SEC = 2352
def rd(f, lba, n=1):
    out = b''
    for i in range(n):
        f.seek((lba + i) * SEC + 24); out += f.read(2048)
    return out
def walk(f, lba, size, path, acc):
    data = rd(f, lba, (size + 2047) // 2048); p = 0
    while p < len(data):
        l = data[p]
        if l == 0: p = (p // 2048 + 1) * 2048; continue
        elba, esz = struct.unpack_from('<I', data, p + 2)[0], struct.unpack_from('<I', data, p + 10)[0]
        flags, nl = data[p + 25], data[p + 32]
        name = data[p + 33:p + 33 + nl]
        if name not in (b'\0', b'\1'):
            n = name.decode('ascii', 'replace').split(';')[0]
            if flags & 2: walk(f, elba, esz, path + n + '/', acc)
            else: acc.append((path + n, elba, esz))
        p += l
def files(f):
    pvd = rd(f, 16); root = pvd[156:190]
    acc = []; walk(f, struct.unpack_from('<I', root, 2)[0], struct.unpack_from('<I', root, 10)[0], '/', acc); return acc
if __name__ == '__main__':
    f = open(sys.argv[1], 'rb'); fs = files(f)
    if len(sys.argv) > 3:
        for n, l, s in fs:
            if n == sys.argv[2]: open(sys.argv[3], 'wb').write(rd(f, l, (s + 2047) // 2048)[:s])
    else:
        for n, l, s in fs: print(f'{l:7d} {s:10d} {n}')

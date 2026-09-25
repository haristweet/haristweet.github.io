# CRICMP 2.10 の展開。本体 SLPM_625.47 の 0x1547c0（外側）と 0x154e80（16項目の組）を写したもの。
import struct, sys
def unpack(src):
    assert src[:6] == b'CRICMP'
    size = struct.unpack_from('<I', src, 0x14)[0]
    p = struct.unpack_from('<I', src, 0x18)[0] + 2
    ver = float(src[8:12].split(b'\0')[0])
    if ver > 2.0: n = struct.unpack_from('>I', src, p)[0]; p += 4
    else: n = struct.unpack_from('>H', src, p)[0]; p += 2
    out = bytearray()
    def group(p, items):
        flags = struct.unpack_from('>H', src, p)[0]; p += 2; r = 0
        for i in range(items):
            w = struct.unpack_from('>H', src, p)[0]; p += 2
            if flags >> i & 1:
                out.append(w >> 8); out.append(w & 255)
            elif w & 0xf000 == 0:
                out.extend(out[-1:] * (w + 3))
            else:
                off, ln = w & 0xfff, (w >> 12) + 2
                for _ in range(ln): out.append(out[-off])
        return p, r
    for _ in range(n): p, _r = group(p, 16)
    trim = struct.unpack_from('b', src, p)[0]; rest = src[p + 1]; p += 2
    if rest > 0: p, _r = group(p, rest)
    if trim > 0: del out[len(out) - trim:]
    return bytes(out), size
if __name__ == '__main__':
    import os
    bad = 0
    for f in sys.argv[1:]:
        b, size = unpack(open(f, 'rb').read())
        if len(b) != size: bad += 1; print('合わない', f, len(b), size)
        open(f[:-4] + '.dec', 'wb').write(b)
    print(len(sys.argv) - 1, 'ファイル', bad, '件合わない')

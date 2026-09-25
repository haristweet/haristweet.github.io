# OBJ_*.CMP（展開後）を読む。面のつなぎ方は本体 SLPM_625.47 の 0x1c9cc0 を写したもの。
import struct
def models(d):
    n = struct.unpack_from('<I', d, 0)[0]; p = 4; out = []
    for k in range(n):
        mid = struct.unpack_from('<I', d, p)[0]; p += 4; ch = []
        for c in range(4):
            L = struct.unpack_from('<I', d, p)[0]; ch.append(d[p + 4:p + 4 + L]); p + 0; p += 4 + L
        out.append((mid, ch))
    assert p == len(d)
    return out
def polys(g):
    # 返り値: [(頭の語, 法線, [頂点…])]
    out = []; P0 = P1 = None
    for r in range(0, len(g) - 39, 40):
        h = struct.unpack_from('<I', g, r)[0]
        f = struct.unpack_from('<9f', g, r + 4)
        n, A, B = f[0:3], f[3:6], f[6:9]
        kind, link = h & 3, (h >> 8) & 3
        if kind == 0: break
        if link == 0: P0, P1 = A, B; continue
        out.append((h, n, [P0, P1, A] if kind == 2 else [P0, P1, B, A]))
        if link == 2: P0, P1 = A, B
        elif link == 1: P1 = A
        elif link == 3: P0 = B
    return out

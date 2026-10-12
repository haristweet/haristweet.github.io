# 場面ごとのプログラム（GAME.BIN など）がメモリのどこに読まれるかを、jal の飛び先と関数の頭（addiu sp,sp,-n）の位置が合う番地から決める。
# python3 ovl.py disc/x/GAME.BIN …
import sys, struct, collections
for f in sys.argv[1:]:
    d = open(f, 'rb').read()
    W = [struct.unpack_from('<I', d, i)[0] for i in range(0, len(d) - 3, 4)]
    pro = {i * 4 for i, w in enumerate(W) if w >> 16 == 0x27bd and (w & 0x8000)}
    js = [((w & 0x3ffffff) << 2) | 0x80000000 for w in W if w >> 26 == 3]
    c = collections.Counter()
    for t in set(js):
        for p in pro: c[t - p] += 1
    best = c.most_common(3)
    print(f, ' '.join(f'{b & 0xffffffff:08x}({n})' for b, n in best), 'jal', len(set(js)))

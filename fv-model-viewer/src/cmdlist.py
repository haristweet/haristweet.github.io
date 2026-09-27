# コマンド表（XXX_CMND.FTS）の文章を読む: python3 cmdlist.py disc/bin/GRACE_CMND.FTS
# 文章は EUC-JP の 0 終わりの文字列を順に詰めた並び（最初は「★」）。そのすぐ前に位置の表がある（ここでは使わない）。
# 文字列: [★, キャラの名前と凡例…, 技の名前, 入力, 技の名前, 入力, …]（入力は <X_20> で始まる。<GFX_P> などはボタンの絵）
import sys
def read(path):
    d=open(path,'rb').read(); t=d.find(b'<X_200>'); base=d.rfind(b'\xa1\xfa\x00',0,t)
    return [x.decode('euc_jp',errors='replace') for x in d[base:].split(b'\x00') if x]
if __name__=='__main__':
    for k,s in enumerate(read(sys.argv[1])): print(k,s)

# PCSX2 のセーブステート（.p2s＝zip、中身は zstd 圧縮）を取り出す。python3 p2s.py disc/states/x.p2s [出力フォルダ]
import zipfile, zstandard, sys, os
def extract(path, out):
    os.makedirs(out, exist_ok=True); z = zipfile.ZipFile(path)
    for i in z.infolist():
        raw = z.fp; raw.seek(i.header_offset); h = raw.read(30)
        n, e = int.from_bytes(h[26:28], 'little'), int.from_bytes(h[28:30], 'little')
        raw.seek(i.header_offset + 30 + n + e); data = raw.read(i.compress_size)
        if i.compress_type == 93: data = zstandard.ZstdDecompressor().decompress(data, max_output_size=i.file_size)
        elif i.compress_type != 0: raise ValueError(i.compress_type)
        open(os.path.join(out, i.filename), 'wb').write(data)
if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else sys.argv[1][:-4])

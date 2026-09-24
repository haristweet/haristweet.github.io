order=[('pre.js',None),
 ('skel.js','骨格（トバル2から。No.1 で違っていたらここを直す）'),
 ('disc.js','ディスクの読み取り（.bin / .iso / .chd）'),
 ('open.js',None),
 ('xa.js','XA-ADPCM の展開'),
 ('bgm.js',None),
 ('pack.js','入れ子とゲーム独自の圧縮'),
 ('table.js',None),
 ('mips.js','実行ファイルのコードを読む'),
 ('scan.js',None),
 ('model.js','モデル（描画命令の列）'),
 ('fit.js',None),
 ('vram1.js',None),
 ('model1.js',None),
 ('gl.js','WebGL'),
 ('app.js',None),
 ('survey.js',None),
 ('survey2.js',None),
 ('bone.js',None),
 ('mem.js',None),
 ('tex1.js',None),
 ('save.js','保存'),
 ('shot.js',None),
 ('tail.js',None)]
import os
listed={f for f,_ in order}
onDisk={f for f in os.listdir('.') if f.endswith('.js')
        and not f.startswith('_') and f not in {'test.mjs','browser.mjs','bundle.js'}}
missing=onDisk-listed
assert not missing, "組み立てに入っていない .js があります: %s"%sorted(missing)
out=[open('head.html',encoding='utf-8').read()]
for f,banner in order:
    if banner: out.append("// ============================================================\n//  %s\n// ============================================================"%banner)
    out.append(open(f,encoding='utf-8').read().rstrip('\n'))
out.append("</script>\n</body>\n</html>")
open('index.html','w',encoding='utf-8').write('\n'.join(out)+'\n')
s=open('index.html',encoding='utf-8').read()
open('bundle.js','w',encoding='utf-8').write(s.split('<script>',1)[1].rsplit('</script>',1)[0])
print(len(s),'bytes')

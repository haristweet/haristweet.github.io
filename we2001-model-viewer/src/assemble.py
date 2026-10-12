# ソースを決まった順に連結して ../index.html を作る（1枚のページ）
order=['wdisc.js','tmd.js','anim.js','tex.js','look.js','photo.js','wgl.js','wapp.js']
out=[open('head.html',encoding='utf-8').read()]
for f in order: out.append(open(f,encoding='utf-8').read().rstrip('\n'))
out.append("</script>\n</body>\n</html>")
s='\n'.join(out)+'\n'
open('../index.html','w',encoding='utf-8').write(s)
print(len(s),'bytes')

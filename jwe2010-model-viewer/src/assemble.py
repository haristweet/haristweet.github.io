# ソースを決まった順に連結して ../index.html を作る（1枚のページ）
order=['fzstd.js','we12.js','p2s.js','jw.js','wgl.js','app.js']
out=[open('head.html',encoding='utf-8').read()]
for f in order: out.append(open(f,encoding='utf-8').read().rstrip('\n'))
out.append("</script>\n</body>\n</html>")
s='\n'.join(out)+'\n'
open('../index.html','w',encoding='utf-8').write(s)
print(len(s),'bytes')

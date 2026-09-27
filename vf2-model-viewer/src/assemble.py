# ソースを決まった順に連結して ../index.html を作る（1枚のページ）
order=['zstd.js','p2s.js','vdisc.js','cricmp.js','obj.js','tex.js','scene.js','m2scr.js','discview.js','build.js','arcade.js','ee.js','motion.js','vgl.js','FVX','cross.js','vapp.js']
# FVX: FV ビューア（../../fv-model-viewer/src）のソースを 1 つの関数の中に包んだもの（VF2 と同じ名前の関数がぶつからないように）。
# 2P を FV のキャラに入れ替える cross.js が使う。arcade.js・cricmp.js・obj.js・p2s.js は VF2 と同じものなので包まずに共通で使う
FV='../../fv-model-viewer/src/'
FV_FILES=['fdisc.js','tex.js','scene.js','build.js','ee.js','motion.js','fvmoves.js','fvarc.js','vgl.js']
FV_EXPORT=['discOpen','sceneColors','sceneLight','sceneAssignCommon','sceneMesh','motEngine','motAttach','motApply','motPickScene','FV_MOVES','cmdStrings','cmdPretty','fvArcPages','fvArcMips','vglNew']
for f in ['arcade.js','cricmp.js','obj.js','p2s.js']:
  assert open(f,'rb').read()==open(FV+f,'rb').read(), f+' が FV と違う'
out=[open('head.html',encoding='utf-8').read()]
for f in order:
  if f=='FVX': out.append('const FVX=(()=>{\n'+'\n'.join(open(FV+x,encoding='utf-8').read().rstrip('\n') for x in FV_FILES)+'\nreturn {'+','.join(FV_EXPORT)+'};\n})();')
  else: out.append(open(f,encoding='utf-8').read().rstrip('\n'))
out.append("</script>\n</body>\n</html>")
s='\n'.join(out)+'\n'
open('../index.html','w',encoding='utf-8').write(s)
print(len(s),'bytes')

# app.js / open.js / scan.js から、DOM を使わない部分をテスト用に切り出す（毎回やり直して古くならないように）
src=open('app.js',encoding='utf-8').read()
def grab(sig):
    i=src.index(sig); d=0; j=i
    while True:
        if src[j]=='{': d+=1
        elif src[j]=='}':
            d-=1
            if d==0: break
        j+=1
    return src[i:j+1]
open('_buildModel.js','w',encoding='utf-8').write(grab('function buildModel(raw){')+'\n'+grab('function buildModelInner(raw,info){')+'\n'+grab('function t1BonesFit(d,objs,info){')+'\n'+grab('function tryBody(out){')+'\n'+grab('function finishT1(r1,info,parts,b){')+'\n'+grab('function collectDump(blk,info){'))
open('_scoreTables.js','w',encoding='utf-8').write(
  'const GOOD_KIND={model:1,pack:1,lz:1,tim:1};\n'
  + grab('async function scoreOne(t){') + '\n'
  + grab('async function scoreTables(tables){'))
o=open('open.js',encoding='utf-8').read()
open('_arcpick.js','w',encoding='utf-8').write(o[o.index('const isStream='):o.index('async function openSource(')])
open('_scan.js','w',encoding='utf-8').write(open('scan.js',encoding='utf-8').read())
open('_fit.js','w',encoding='utf-8').write(open('fit.js',encoding='utf-8').read()+'\n'+open('vram1.js',encoding='utf-8').read())
print("extracted")

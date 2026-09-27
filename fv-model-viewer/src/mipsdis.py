# 本体（SLPM_626.06）の MIPS（R5900）を逆アセンブルする。python3 mipsdis.py disc/x/SLPM_626.06 始め 数（capstone を使う）
import sys, capstone
d=open(sys.argv[1],'rb').read(); a=int(sys.argv[2],16); n=int(sys.argv[3]) if len(sys.argv)>3 else 40
md=capstone.Cs(capstone.CS_ARCH_MIPS, capstone.CS_MODE_MIPS64+capstone.CS_MODE_LITTLE_ENDIAN)
code=d[a-0x100000+0x80:a-0x100000+0x80+n*4]
p=a
for i in range(n):
    w=code[i*4:i*4+4]; ins=list(md.disasm(w,a+i*4))
    print('%06x  %s  %s'%(a+i*4, w[::-1].hex(), (ins[0].mnemonic+' '+ins[0].op_str) if ins else '?'))

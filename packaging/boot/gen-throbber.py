#!/usr/bin/env python3
"""Regenerate the eDEX-OS plymouth spinner frames (throbber 30 + animation 36).
Same design as stock Ubuntu (32x32 ring) but in the eDEX green palette.
Usage: python3 gen-throbber.py <outdir>"""
import sys, os
from PIL import Image, ImageDraw
SIZE=32; CX=CY=15.5; OUTER=12; INNER=8.5
DIM=(0x00,0x99,0x66); BRIGHT=(0x00,0xff,0x9f); ARC=100
def ring(deg):
    im=Image.new("RGBA",(SIZE,SIZE),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.arc([CX-OUTER,CY-OUTER,CX+OUTER,CY+OUTER],0,360,fill=DIM+(180,),width=4)
    d.arc([CX-OUTER,CY-OUTER,CX+OUTER,CY+OUTER],deg,deg+ARC,fill=BRIGHT+(255,),width=4)
    return im
out=sys.argv[1]; os.makedirs(out+"/throbber",exist_ok=True); os.makedirs(out+"/animation",exist_ok=True)
for n in (30,36):
    for i in range(n):
        ring(360*i/n).save(f"{out}/{'throbber' if n==30 else 'animation'}/{('throbber' if n==30 else 'animation')}-{i+1:04d}.png")
print("ok ->", out)

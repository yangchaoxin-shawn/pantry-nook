"""把本轮生成的纸面原图制成底图和随主题着色的透明纤维层。"""
from pathlib import Path
import argparse

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
args = parser.parse_args()
scan = ROOT/'assets/paper-v6.webp'
Image.open(args.source).convert('RGB').save(scan, quality=88, method=6)
pixels = np.asarray(Image.open(scan).convert('RGB')).astype(float)
luminance = pixels @ np.array([.2126, .7152, .0722])
alpha = np.clip((248-luminance)*2, 0, 70).astype('uint8')
rgba = np.zeros((*alpha.shape, 4), dtype='uint8')
rgba[:, :, :3] = [108, 97, 65]
rgba[:, :, 3] = alpha
layer = np.array(Image.fromarray(rgba).resize((640, 640), Image.Resampling.LANCZOS))
layer[:, :, 3] = (layer[:, :, 3]//4)*4
Image.fromarray(layer).save(ROOT/'assets/paper-grain-v6.webp', quality=88, method=6)
print('Paper scan and transparent fiber layer prepared.')

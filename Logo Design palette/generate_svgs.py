import os
import base64

base_dir = r'C:\Users\Work\Desktop\GitHub\Chain Verify'
brand_dir = os.path.join(base_dir, 'brand')
web_public_dir = os.path.join(base_dir, 'apps', 'web', 'public')
web_app_dir = os.path.join(base_dir, 'apps', 'web', 'src', 'app')

with open(os.path.join(brand_dir, 'chainverify-symbol.png'), 'rb') as f:
    b64_symbol = base64.b64encode(f.read()).decode('utf-8')

with open(os.path.join(brand_dir, 'chainverify-logo-horizontal.png'), 'rb') as f:
    b64_logo_horiz = base64.b64encode(f.read()).decode('utf-8')

with open(os.path.join(brand_dir, 'chainverify-logo-full.png'), 'rb') as f:
    b64_logo_full = base64.b64encode(f.read()).decode('utf-8')

# 1. Standalone SVG for chainverify-icon.svg / web tab icon
svg_icon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="ChainVerify icon" preserveAspectRatio="xMidYMid meet">
  <title>ChainVerify Icon</title>
  <image href="data:image/png;base64,{b64_symbol}" x="3" y="3" width="94" height="94" preserveAspectRatio="xMidYMid meet"/>
</svg>'''

for path in [
    os.path.join(web_public_dir, 'chainverify-icon.svg'),
    os.path.join(web_app_dir, 'icon.svg'),
    os.path.join(brand_dir, 'favicon.svg'),
    os.path.join(brand_dir, 'chainverify-symbol.svg'),
]:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(svg_icon)

# 2. Horizontal logo SVG
svg_logo_horiz = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1784 320" role="img" aria-label="ChainVerify logo" preserveAspectRatio="xMidYMid meet">
  <title>ChainVerify Logo</title>
  <image href="data:image/png;base64,{b64_logo_horiz}" x="0" y="0" width="1784" height="320" preserveAspectRatio="xMidYMid meet"/>
</svg>'''

for path in [
    os.path.join(web_public_dir, 'chainverify-logo.svg'),
    os.path.join(brand_dir, 'logo-horizontal.svg'),
    os.path.join(brand_dir, 'chainverify-logo-horizontal.svg')
]:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(svg_logo_horiz)

# 3. Full stacked logo SVG
svg_logo_full = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1289 1104" role="img" aria-label="ChainVerify full logo" preserveAspectRatio="xMidYMid meet">
  <title>ChainVerify Full Logo</title>
  <image href="data:image/png;base64,{b64_logo_full}" x="0" y="0" width="1289" height="1104" preserveAspectRatio="xMidYMid meet"/>
</svg>'''

with open(os.path.join(brand_dir, 'logo-primary.svg'), 'w', encoding='utf-8') as f:
    f.write(svg_logo_full)

print("All SVGs written successfully!")

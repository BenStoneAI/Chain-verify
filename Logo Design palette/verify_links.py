import os
import re

base_dir = r'C:\Users\Work\Desktop\GitHub\Chain Verify'
src_dir = os.path.join(base_dir, 'apps', 'web', 'src')

routes = set([
    '/', '/admin', '/audit-proof', '/audit-proof/welcome', 
    '/contact', '/invoice-proof', '/invoice-proof/welcome', 
    '/privacy', '/security', '/verify-api', '/verify-api/docs', 
    '/verify-api/welcome'
])

link_regex = re.compile(r'href=[\'"]([^\'"]+)[\'"]')
broken_links = []

for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith(('.tsx', '.ts')):
            fpath = os.path.join(root, file)
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read()
            for match in link_regex.finditer(content):
                target = match.group(1)
                if target.startswith('#') or target.startswith('http') or target.startswith('mailto:') or target.startswith('data:'):
                    continue
                clean_target = target.split('?')[0].rstrip('/')
                if not clean_target:
                    clean_target = '/'
                if clean_target not in routes:
                    broken_links.append((fpath, target))

print(f"Broken links found: {len(broken_links)}")
for p, t in broken_links:
    print(f"  {p} -> {t}")

purple_regex = re.compile(r'purple|violet|fuchsia|#7c3aed|#6d28d9|#5b21b6|#8b5cf6|#a78bfa|#c4b5fd|#ddd6fe|#4c1d95|#2e1065|#8a2be2|#9333ea|#a855f7|#c084fc', re.IGNORECASE)
purple_matches = []
for root, dirs, files in os.walk(src_dir):
    for file in files:
        if file.endswith(('.tsx', '.ts', '.css')):
            fpath = os.path.join(root, file)
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read()
            found = purple_regex.findall(content)
            if found:
                purple_matches.append((fpath, found))

print(f"Purple matches found in src: {len(purple_matches)}")
for p, m in purple_matches:
    print(f"  {p} -> {m}")

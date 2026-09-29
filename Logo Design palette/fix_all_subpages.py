import os

base_dir = r'C:\Users\Work\Desktop\GitHub\Chain Verify\apps\web\src'

def update_file(rel_path, replaces):
    fpath = os.path.join(base_dir, rel_path)
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()
    for old, new in replaces:
        content = content.replace(old, new)
    with open(fpath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated {rel_path}")

# 1. admin.css
update_file(r'app\admin\admin.css', [
    ('background: var(--cv-violet);', 'background: var(--cv-cyan); color: #0a0a0f;'),
    ('background: var(--cv-violet);\n  color: white;', 'background: var(--cv-cyan);\n  color: #0a0a0f;'),
])

# 2. audit-proof.css
update_file(r'app\audit-proof\audit-proof.css', [
    ('--shadow-glow-purple: 0 0 50px rgba(34, 211, 238, 0.18);', '--shadow-glow-cyan: 0 0 50px rgba(34, 211, 238, 0.18);'),
    ('var(--shadow-glow-purple)', 'var(--shadow-glow-cyan)'),
])

# 3. invoice-proof.css
update_file(r'app\invoice-proof\invoice-proof.css', [
    ('--shadow-glow-purple: 0 0 40px rgba(255, 180, 92, 0.22);', '--shadow-glow-amber: 0 0 40px rgba(255, 180, 92, 0.22);'),
    ('var(--shadow-glow-purple)', 'var(--shadow-glow-amber)'),
    ('linear-gradient(135deg, var(--accent) 0%, #5B3FE0 100%)', 'linear-gradient(135deg, var(--accent) 0%, #0D9488 100%)'),
])

# 4. verify-api.css
update_file(r'app\verify-api\verify-api.css', [
    ('--accent:         #8B5CF6;', '--accent:         #00E5FF;'),
    ('--accent-strong:  #A78BFA;', '--accent-strong:  #14B8A6;'),
    ('--accent-soft:    #C4B5FD;', '--accent-soft:    #67E8F9;'),
    ('--accent-dim:     rgba(139, 92, 246, 0.16);', '--accent-dim:     rgba(0, 229, 255, 0.16);'),
    ('--accent-wire:    rgba(139, 92, 246, 0.32);', '--accent-wire:    rgba(0, 229, 255, 0.32);'),
    ('--shadow-glow-purple: 0 0 50px rgba(139, 92, 246, 0.18);', '--shadow-glow-cyan: 0 0 50px rgba(0, 229, 255, 0.18);'),
    ('var(--shadow-glow-purple)', 'var(--shadow-glow-cyan)'),
    ('--syn-key:  #C4B5FD;', '--syn-key:  #67E8F9;'),
    ('--syn-bool: #F0A8F0;', '--syn-bool: #14B8A6;'),
    ('rgba(139, 92, 246,', 'rgba(0, 229, 255,'),
    ('rgba(139,92,246,', 'rgba(0,229,255,'),
    ('rgba(139, 92, 246, 0.28)', 'rgba(0, 229, 255, 0.28)'),
    ('rgba(139, 92, 246, 0.38)', 'rgba(0, 229, 255, 0.38)'),
    ('.btn-primary {\n  background: var(--accent); color: #fff;', '.btn-primary {\n  background: linear-gradient(135deg, #00E5FF, #0D9488); color: #0A0A0F;'),
    ('.tier.featured .tcta {\n  background: var(--accent); border-color: var(--accent); color: #fff;', '.tier.featured .tcta {\n  background: linear-gradient(135deg, #00E5FF, #0D9488); border-color: var(--accent); color: #0A0A0F; font-weight: 700;'),
    ('.tier.featured::before {\n  content: "Most popular";\n  position: absolute;\n  top: -10px; right: 16px;\n  font-family: var(--font-mono);\n  font-size: 10px;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  padding: 4px 10px;\n  background: var(--accent);\n  color: #fff;', '.tier.featured::before {\n  content: "Most popular";\n  position: absolute;\n  top: -10px; right: 16px;\n  font-family: var(--font-mono);\n  font-size: 10px;\n  letter-spacing: 0.14em;\n  text-transform: uppercase;\n  padding: 4px 10px;\n  background: linear-gradient(135deg, #00E5FF, #0D9488);\n  color: #0A0A0F;')
])

# 5. docs/page.tsx
update_file(r'app\verify-api\docs\page.tsx', [
    ('violet', 'cyan'),
    ('Violet', 'Cyan'),
])

# 6. VerifyAPISandbox.tsx
update_file(r'components\proof\VerifyAPISandbox.tsx', [
    ('#8B5CF6', '#00E5FF'),
    ('#8b5cf6', '#00e5ff'),
])

# 7. InvoiceProofClient.tsx
update_file(r'components\proof\InvoiceProofClient.tsx', [
    ('purple', 'cyan'),
    ('/start/invoice-proof', '/invoice-proof'),
])

# 8. SoftwareDeliveryForm.tsx
update_file(r'components\proof\SoftwareDeliveryForm.tsx', [
    ('/login?redirect=/verify-api', '/verify-api'),
])

print("All color and link updates completed successfully!")

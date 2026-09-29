import os
import base64

base_dir = r'C:\Users\Work\Desktop\GitHub\Chain Verify'
brand_dir = os.path.join(base_dir, 'brand')
palette_dir = os.path.join(base_dir, 'Logo Design palette')

def get_b64(path):
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

b64_full = get_b64(os.path.join(brand_dir, 'chainverify-logo-full.png'))
b64_horiz = get_b64(os.path.join(brand_dir, 'chainverify-logo-horizontal.png'))
b64_horiz_tag = get_b64(os.path.join(brand_dir, 'chainverify-wordmark-tagline.png'))
b64_symbol = get_b64(os.path.join(brand_dir, 'chainverify-symbol.png'))
b64_wordmark = get_b64(os.path.join(brand_dir, 'chainverify-wordmark.png'))
b64_icon16 = get_b64(os.path.join(brand_dir, 'assets', 'icon-16.png'))
b64_icon32 = get_b64(os.path.join(brand_dir, 'assets', 'icon-32.png'))
b64_icon48 = get_b64(os.path.join(brand_dir, 'assets', 'icon-48.png'))
b64_icon64 = get_b64(os.path.join(brand_dir, 'assets', 'icon-64.png'))
b64_icon180 = get_b64(os.path.join(brand_dir, 'assets', 'icon-180.png'))
b64_icon512 = get_b64(os.path.join(brand_dir, 'assets', 'icon-512.png'))
b64_apple = get_b64(os.path.join(brand_dir, 'apple-touch-icon.png'))

html_template = f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChainVerify — New Cyan & Teal Design Palette Review</title>
  <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,{b64_icon32}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {{
      --cv-bg: #0A0A0F;
      --cv-bg-2: #0E1118;
      --cv-surface: rgba(17, 21, 31, 0.78);
      --cv-surface-solid: #11151F;
      --cv-surface-raised: #171D29;
      --cv-border: rgba(157, 170, 197, 0.16);
      --cv-border-bright: rgba(0, 229, 255, 0.35);
      --cv-text: #F8F9FC;
      --cv-text-muted: #8F9DB2;
      --cv-text-faint: #657287;
      
      /* New Brand Identity Spectrum - STRICTLY ZERO PURPLE */
      --cv-brand-cyan: #00E5FF;
      --cv-brand-teal: #14B8A6;
      --cv-brand-teal-deep: #0D9488;
      --cv-verified: #67E8F9;
      --cv-brand-white: #F8F9FC;
      
      /* Semantic Product Colors */
      --cv-verify-api: #14B8A6;
      --cv-audit-proof: #22D3EE;
      --cv-invoice-proof: #FFB45C;
      --cv-success: #10B981;
      
      --cv-font-sans: 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;
      --cv-font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      
      --cv-radius-ctrl: 12px;
      --cv-radius-card: 18px;
      --cv-radius-pill: 999px;
      
      --cv-shadow-glow: 0 0 32px rgba(0, 229, 255, 0.22);
      --cv-shadow-teal: 0 0 32px rgba(20, 184, 166, 0.22);
    }}
    
    html[data-theme="light"] {{
      --cv-bg: #F4F7FB;
      --cv-bg-2: #FFFFFF;
      --cv-surface: rgba(255, 255, 255, 0.88);
      --cv-surface-solid: #FFFFFF;
      --cv-surface-raised: #E9EEF6;
      --cv-border: rgba(35, 48, 74, 0.14);
      --cv-border-bright: rgba(13, 148, 136, 0.35);
      --cv-text: #0B1020;
      --cv-text-muted: #506078;
      --cv-text-faint: #748199;
      --cv-shadow-glow: 0 12px 36px rgba(0, 229, 255, 0.14);
    }}
    
    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }}
    
    body {{
      background: var(--cv-bg);
      color: var(--cv-text);
      font-family: var(--cv-font-sans);
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
      transition: background 0.3s ease, color 0.3s ease;
    }}
    
    /* Background Ambient Glows - Cyan and Teal ONLY */
    .ambient-glow {{
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 0;
      overflow: hidden;
    }}
    .glow-1 {{
      position: absolute;
      top: -150px;
      right: -100px;
      width: 750px;
      height: 750px;
      background: radial-gradient(circle, rgba(0, 229, 255, 0.12) 0%, rgba(20, 184, 166, 0.08) 45%, transparent 70%);
      filter: blur(80px);
    }}
    .glow-2 {{
      position: absolute;
      top: 40%;
      left: -150px;
      width: 650px;
      height: 650px;
      background: radial-gradient(circle, rgba(13, 148, 136, 0.12) 0%, rgba(0, 229, 255, 0.06) 45%, transparent 70%);
      filter: blur(90px);
    }}
    
    /* Container */
    .container {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 24px;
      position: relative;
      z-index: 1;
    }}
    
    /* Top Sticky Control Bar */
    .top-bar {{
      position: sticky;
      top: 16px;
      z-index: 100;
      margin: 16px auto 32px;
      padding: 12px 20px;
      background: var(--cv-surface);
      backdrop-filter: blur(20px) saturate(160%);
      border: 1px solid var(--cv-border);
      border-radius: var(--cv-radius-card);
      box-shadow: 0 16px 40px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }}
    .brand-pill {{
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: inherit;
    }}
    .brand-pill img {{
      height: 34px;
      object-fit: contain;
    }}
    .review-tag {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--cv-font-mono);
      background: rgba(0, 229, 255, 0.12);
      color: var(--cv-brand-cyan);
      border: 1px solid rgba(0, 229, 255, 0.3);
      padding: 4px 10px;
      border-radius: var(--cv-radius-pill);
      letter-spacing: 0.05em;
    }}
    .review-tag .dot {{
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--cv-brand-cyan);
      box-shadow: 0 0 10px var(--cv-brand-cyan);
      animation: pulse 2s infinite;
    }}
    @keyframes pulse {{
      0%, 100% {{ opacity: 1; transform: scale(1); }}
      50% {{ opacity: 0.5; transform: scale(1.2); }}
    }}
    
    .nav-links {{
      display: flex;
      gap: 8px;
    }}
    .nav-link {{
      color: var(--cv-text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      padding: 6px 12px;
      border-radius: 8px;
      transition: all 0.2s ease;
    }}
    .nav-link:hover, .nav-link.active {{
      color: var(--cv-text);
      background: rgba(255, 255, 255, 0.06);
    }}
    
    .theme-toggle-btn {{
      background: var(--cv-surface-raised);
      border: 1px solid var(--cv-border);
      color: var(--cv-text);
      padding: 8px 14px;
      border-radius: var(--cv-radius-ctrl);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s ease;
    }}
    .theme-toggle-btn:hover {{
      border-color: var(--cv-brand-cyan);
      box-shadow: 0 0 16px rgba(0, 229, 255, 0.2);
    }}
    
    /* Hero Header - NEW CYAN TO TEAL GRADIENT, ZERO PURPLE */
    .hero {{
      text-align: center;
      padding: 48px 0 64px;
    }}
    .kicker {{
      font-family: var(--cv-font-mono);
      font-size: 11px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--cv-brand-cyan);
      margin-bottom: 16px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 229, 255, 0.08);
      border: 1px solid rgba(0, 229, 255, 0.24);
      padding: 6px 14px;
      border-radius: var(--cv-radius-pill);
    }}
    .hero h1 {{
      font-size: clamp(38px, 5.5vw, 68px);
      font-weight: 850;
      letter-spacing: -0.04em;
      line-height: 1.05;
      margin-bottom: 20px;
    }}
    .hero h1 .grad {{
      background: linear-gradient(135deg, #00E5FF 0%, #14B8A6 55%, #0D9488 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }}
    .hero p {{
      max-width: 680px;
      margin: 0 auto 32px;
      font-size: 18px;
      color: var(--cv-text-muted);
      line-height: 1.6;
    }}
    
    /* Section Headings */
    .section {{
      margin-bottom: 80px;
      scroll-margin-top: 100px;
    }}
    .section-header {{
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      margin-bottom: 28px;
      border-bottom: 1px solid var(--cv-border);
      padding-bottom: 16px;
    }}
    .section-title {{
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.03em;
      display: flex;
      align-items: center;
      gap: 12px;
    }}
    .section-title span.badge {{
      font-size: 11px;
      font-family: var(--cv-font-mono);
      background: rgba(0, 229, 255, 0.14);
      color: var(--cv-brand-cyan);
      border: 1px solid rgba(0, 229, 255, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-weight: 600;
    }}
    .section-desc {{
      color: var(--cv-text-muted);
      font-size: 14px;
    }}
    
    /* Cards Grid */
    .grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
    }}
    .grid-3 {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
    }}
    .grid-4 {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 18px;
    }}
    
    .card {{
      background: var(--cv-surface);
      border: 1px solid var(--cv-border);
      border-radius: var(--cv-radius-card);
      padding: 24px;
      backdrop-filter: blur(12px);
      transition: transform 0.24s ease, border-color 0.24s ease, box-shadow 0.24s ease;
      position: relative;
      overflow: hidden;
    }}
    .card:hover {{
      transform: translateY(-3px);
      border-color: var(--cv-border-bright);
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.3);
    }}
    
    /* Logo Preview Box */
    .logo-preview-box {{
      border-radius: var(--cv-radius-ctrl);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 36px 20px;
      margin-bottom: 16px;
      min-height: 180px;
      position: relative;
      overflow: hidden;
    }}
    .box-dark {{
      background: radial-gradient(circle at center, #11151F 0%, #0A0A0F 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }}
    .box-light {{
      background: radial-gradient(circle at center, #FFFFFF 0%, #E9EEF6 100%);
      border: 1px solid rgba(0, 0, 0, 0.08);
    }}
    .box-checker {{
      background-image: linear-gradient(45deg, rgba(255,255,255,0.04) 25%, transparent 25%), 
                        linear-gradient(-45deg, rgba(255,255,255,0.04) 25%, transparent 25%), 
                        linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.04) 75%), 
                        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.04) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
      background-color: #0E1218;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }}
    .logo-meta {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 12px;
    }}
    .logo-title {{
      font-weight: 700;
      font-size: 15px;
    }}
    .logo-spec {{
      font-family: var(--cv-font-mono);
      font-size: 11px;
      color: var(--cv-text-muted);
    }}
    
    /* Browser Tab Mockup */
    .browser-mockup {{
      background: #171B26;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--cv-radius-card);
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      margin-bottom: 28px;
    }}
    .browser-chrome {{
      background: #0D1017;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }}
    .window-dots {{
      display: flex;
      gap: 6px;
    }}
    .w-dot {{
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }}
    .w-red {{ background: #FF5F56; }}
    .w-yellow {{ background: #FFBD2E; }}
    .w-green {{ background: #27C93F; }}
    
    .tab-bar {{
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
    }}
    .browser-tab {{
      display: flex;
      align-items: center;
      gap: 9px;
      background: #171B26;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-bottom: none;
      padding: 7px 16px;
      border-radius: 10px 10px 0 0;
      font-size: 12px;
      font-weight: 600;
      color: #F8F9FC;
      max-width: 320px;
      box-shadow: 0 -2px 10px rgba(0,0,0,0.2);
    }}
    .tab-icon {{
      width: 18px;
      height: 18px;
      object-fit: contain;
      filter: drop-shadow(0 0 6px rgba(0, 229, 255, 0.45));
    }}
    .browser-url-bar {{
      display: flex;
      align-items: center;
      gap: 10px;
      background: #090B10;
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 8px;
      padding: 5px 14px;
      font-family: var(--cv-font-mono);
      font-size: 11px;
      color: #8F9DB2;
      flex: 1;
      max-width: 480px;
    }}
    .browser-viewport {{
      padding: 32px 24px;
      background: #0A0A0F;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }}
    
    /* Icon Scale Matrix */
    .icon-matrix {{
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      gap: 20px;
      padding: 30px 16px;
      background: var(--cv-surface-raised);
      border-radius: var(--cv-radius-ctrl);
      border: 1px solid var(--cv-border);
    }}
    .icon-cell {{
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
    }}
    .icon-cell img {{
      object-fit: contain;
      filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4));
    }}
    .icon-size-label {{
      font-family: var(--cv-font-mono);
      font-size: 10px;
      color: var(--cv-text-muted);
    }}
    
    /* Swatches */
    .swatch-card {{
      display: flex;
      flex-direction: column;
      border-radius: var(--cv-radius-card);
      border: 1px solid var(--cv-border);
      overflow: hidden;
      background: var(--cv-surface);
      cursor: pointer;
      transition: all 0.2s ease;
    }}
    .swatch-card:hover {{
      transform: translateY(-3px);
      box-shadow: 0 12px 28px rgba(0,0,0,0.3);
    }}
    .swatch-color {{
      height: 90px;
      width: 100%;
      position: relative;
    }}
    .swatch-body {{
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }}
    .swatch-name {{
      font-weight: 700;
      font-size: 13px;
    }}
    .swatch-hex {{
      font-family: var(--cv-font-mono);
      font-size: 12px;
      color: var(--cv-text-muted);
    }}
    .swatch-role {{
      font-size: 11px;
      color: var(--cv-text-faint);
    }}
    
    /* Live UI Preview Components - STRICTLY CYAN TO TEAL GRADIENT */
    .live-navbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 24px;
      border: 1px solid var(--cv-border);
      border-radius: var(--cv-radius-card);
      background: rgba(10, 10, 15, 0.82);
      backdrop-filter: blur(20px);
      margin-bottom: 24px;
    }}
    .live-cta {{
      background: linear-gradient(135deg, #00E5FF 0%, #14B8A6 55%, #0D9488 100%);
      color: #0A0A0F;
      font-weight: 800;
      font-size: 13px;
      padding: 9px 20px;
      border-radius: var(--cv-radius-ctrl);
      border: none;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 229, 255, 0.35);
      transition: all 0.2s ease;
    }}
    .live-cta:hover {{
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0, 229, 255, 0.5);
    }}
    .live-secondary {{
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--cv-border);
      color: var(--cv-text);
      font-weight: 600;
      font-size: 13px;
      padding: 9px 18px;
      border-radius: var(--cv-radius-ctrl);
      cursor: pointer;
      transition: all 0.2s ease;
    }}
    .live-secondary:hover {{
      border-color: var(--cv-brand-cyan);
      background: rgba(255, 255, 255, 0.08);
    }}
    
    /* Proof Record Card */
    .proof-record {{
      background: linear-gradient(145deg, #11151F, #0A0A0F);
      border: 1px solid rgba(0, 229, 255, 0.3);
      border-radius: var(--cv-radius-card);
      padding: 24px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 229, 255, 0.08);
      position: relative;
    }}
    .proof-badge {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-family: var(--cv-font-mono);
      font-size: 11px;
      font-weight: 700;
      color: #10B981;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 4px 10px;
      border-radius: var(--cv-radius-pill);
    }}
    .proof-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }}
    .proof-id {{
      font-family: var(--cv-font-mono);
      font-size: 12px;
      color: var(--cv-text-muted);
    }}
    .proof-claim {{
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 14px;
      color: #F8F9FC;
    }}
    .proof-evidence-grid {{
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 14px;
    }}
    .evidence-item {{
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.05);
      padding: 10px;
      border-radius: 10px;
      font-size: 11px;
    }}
    .evidence-label {{
      color: var(--cv-text-faint);
      font-family: var(--cv-font-mono);
      font-size: 9px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }}
    .evidence-val {{
      font-family: var(--cv-font-mono);
      color: var(--cv-brand-cyan);
      word-break: break-all;
    }}
    
    /* Table */
    .table-container {{
      overflow-x: auto;
      border: 1px solid var(--cv-border);
      border-radius: var(--cv-radius-card);
      background: var(--cv-surface);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }}
    th {{
      background: var(--cv-surface-raised);
      padding: 12px 18px;
      font-weight: 700;
      border-bottom: 1px solid var(--cv-border);
      color: var(--cv-text-muted);
      font-family: var(--cv-font-mono);
      font-size: 11px;
      text-transform: uppercase;
    }}
    td {{
      padding: 12px 18px;
      border-bottom: 1px solid var(--cv-border);
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
    
    /* Toast */
    .toast {{
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10B981;
      color: white;
      padding: 10px 18px;
      border-radius: var(--cv-radius-ctrl);
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.3s ease;
      pointer-events: none;
      z-index: 1000;
    }}
    .toast.show {{
      opacity: 1;
      transform: translateY(0);
    }}
    
    @media (max-width: 768px) {{
      .grid-2, .grid-3, .grid-4 {{
        grid-template-columns: 1fr;
      }}
      .top-bar {{
        flex-direction: column;
        align-items: stretch;
      }}
      .icon-matrix {{
        flex-wrap: wrap;
      }}
    }}
  </style>
</head>
<body>

  <div class="ambient-glow">
    <div class="glow-1"></div>
    <div class="glow-2"></div>
  </div>

  <div class="container">
    
    <!-- Top Bar -->
    <header class="top-bar">
      <a href="#hero" class="brand-pill">
        <img src="data:image/png;base64,{b64_horiz}" alt="ChainVerify">
        <span class="review-tag"><span class="dot"></span> ZERO PURPLE · 100% CYAN &amp; TEAL</span>
      </a>
      
      <nav class="nav-links">
        <a href="#logos" class="nav-link active">Logo Suite</a>
        <a href="#tabicon" class="nav-link">Web Tab Icon</a>
        <a href="#palette" class="nav-link">Palette Tokens</a>
        <a href="#ui-preview" class="nav-link">UI Components</a>
        <a href="#inventory" class="nav-link">Asset Files</a>
      </nav>
      
      <button class="theme-toggle-btn" id="themeToggle">
        <span id="themeIcon">☀️</span> <span id="themeLabel">Light Mode</span>
      </button>
    </header>

    <!-- Hero -->
    <section class="hero" id="hero">
      <div class="kicker">New Design Palette · Zero Purple</div>
      <h1>ChainVerify <span class="grad">New Design Palette</span> &amp; Logo Suite</h1>
      <p>
        Clean infrastructure-grade palette: <strong>Electric Cyan (#00E5FF)</strong> to <strong>Deep Teal (#0D9488)</strong>, 
        soft white chrome letterforms, and pure graphite black canvas.
      </p>
      <div style="display: flex; justify-content: center; gap: 14px; flex-wrap: wrap;">
        <a href="#tabicon" class="live-cta" style="text-decoration:none;">View Web Tab Icon Demo</a>
        <a href="#ui-preview" class="live-secondary" style="text-decoration:none;">Inspect Live UI Components</a>
      </div>
    </section>

    <!-- Section 1: Logo Suite -->
    <section class="section" id="logos">
      <div class="section-header">
        <div>
          <h2 class="section-title">Brand Logo Suite <span class="badge">UPDATED</span></h2>
          <p class="section-desc">Cropped from NEW LOGO and Colors.png with Electric Cyan to Teal gradient</p>
        </div>
      </div>
      
      <div class="grid-2">
        <!-- Horizontal Lockup -->
        <div class="card">
          <div class="logo-preview-box box-dark">
            <img src="data:image/png;base64,{b64_horiz}" alt="Horizontal Logo" style="max-height: 80px; max-width: 90%; object-fit: contain;">
          </div>
          <div class="logo-meta">
            <span class="logo-title">Horizontal Navbar Lockup (Dark)</span>
            <span class="logo-spec">1746 × 320 px (PNG / SVG)</span>
          </div>
          <p style="font-size: 12px; color: var(--cv-text-muted); margin-top: 6px;">
            Primary lockup for top-navigation headers, product shells, and marketing headers.
          </p>
        </div>

        <div class="card">
          <div class="logo-preview-box box-light">
            <img src="data:image/png;base64,{b64_horiz}" alt="Horizontal Logo Light" style="max-height: 80px; max-width: 90%; object-fit: contain;">
          </div>
          <div class="logo-meta">
            <span class="logo-title">Horizontal Lockup (Light Mode)</span>
            <span class="logo-spec">High Contrast Chrome + Teal</span>
          </div>
          <p style="font-size: 12px; color: var(--cv-text-muted); margin-top: 6px;">
            Chrome borders and deep teal maintain crisp contrast on light backgrounds.
          </p>
        </div>

        <!-- Master Full Lockup -->
        <div class="card">
          <div class="logo-preview-box box-dark" style="min-height: 240px;">
            <img src="data:image/png;base64,{b64_full}" alt="Full Logo" style="max-height: 190px; max-width: 90%; object-fit: contain;">
          </div>
          <div class="logo-meta">
            <span class="logo-title">Master Vertical Lockup</span>
            <span class="logo-spec">1286 × 1037 px (PNG / SVG)</span>
          </div>
          <p style="font-size: 12px; color: var(--cv-text-muted); margin-top: 6px;">
            Complete signature mark with CV emblem, wordmark, and cyan-teal tagline.
          </p>
        </div>

        <!-- Wordmark with Tagline -->
        <div class="card">
          <div class="logo-preview-box box-checker" style="min-height: 240px;">
            <img src="data:image/png;base64,{b64_horiz_tag}" alt="Wordmark with Tagline" style="max-height: 100px; max-width: 95%; object-fit: contain;">
          </div>
          <div class="logo-meta">
            <span class="logo-title">Wordmark &amp; Tagline</span>
            <span class="logo-spec">Cyan to Teal Accent Underlines</span>
          </div>
          <p style="font-size: 12px; color: var(--cv-text-muted); margin-top: 6px;">
            Editorial and hero lockup featuring the Electric Cyan underline.
          </p>
        </div>
      </div>
    </section>

    <!-- Section 2: Web Tab Icon & Favicons -->
    <section class="section" id="tabicon">
      <div class="section-header">
        <div>
          <h2 class="section-title">Web Tab Icon &amp; Favicon Suite <span class="badge">ACTIVE</span></h2>
          <p class="section-desc">Browser tab simulation with the new Electric Cyan CV mark</p>
        </div>
      </div>

      <!-- Real World Browser Mockup -->
      <div class="browser-mockup">
        <div class="browser-chrome">
          <div class="window-dots">
            <span class="w-dot w-red"></span>
            <span class="w-dot w-yellow"></span>
            <span class="w-dot w-green"></span>
          </div>
          <div class="tab-bar">
            <div class="browser-tab">
              <img src="data:image/png;base64,{b64_icon32}" class="tab-icon" alt="Tab Icon">
              <span>ChainVerify — Independent Proof for AI</span>
              <span style="font-size: 10px; opacity: 0.6; margin-left: auto;">✕</span>
            </div>
          </div>
          <div class="browser-url-bar">
            <span>🔒</span> https://chainverify.org/
          </div>
        </div>
        <div class="browser-viewport">
          <div style="display: flex; align-items: center; gap: 20px;">
            <img src="data:image/png;base64,{b64_symbol}" style="height: 64px; object-fit: contain;" alt="CV Mark">
            <div>
              <div style="font-size: 18px; font-weight: 800; color: #F8F9FC;">Active Browser Tab Integration</div>
              <div style="font-size: 12px; color: var(--cv-text-muted);">
                Configured with <code>favicon.ico</code> (16/32/48/64), <code>icon.svg</code>, and Apple Touch Icon.
              </div>
            </div>
          </div>
          <span class="review-tag"><span class="dot"></span> 100% TAB LEGIBILITY</span>
        </div>
      </div>

      <!-- Scale Matrix -->
      <div class="card" style="margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: 700; margin-bottom: 16px;">Multi-Resolution Icon Matrix</h3>
        <div class="icon-matrix">
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_icon16}" width="16" height="16" alt="16x16">
            <span class="icon-size-label">16×16 px<br>(Standard Tab)</span>
          </div>
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_icon32}" width="32" height="32" alt="32x32">
            <span class="icon-size-label">32×32 px<br>(Retina Tab)</span>
          </div>
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_icon48}" width="48" height="48" alt="48x48">
            <span class="icon-size-label">48×48 px<br>(Desktop Shortcut)</span>
          </div>
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_icon64}" width="64" height="64" alt="64x64">
            <span class="icon-size-label">64×64 px<br>(Bookmark)</span>
          </div>
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_apple}" width="80" height="80" alt="180x180" style="border-radius: 18px;">
            <span class="icon-size-label">180×180 px<br>(Apple Touch)</span>
          </div>
          <div class="icon-cell">
            <img src="data:image/png;base64,{b64_icon512}" width="100" height="100" alt="512x512">
            <span class="icon-size-label">512×512 px<br>(PWA / Store)</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3: Palette & Design Tokens -->
    <section class="section" id="palette">
      <div class="section-header">
        <div>
          <h2 class="section-title">New Color Palette &amp; Tokens <span class="badge">NO PURPLE</span></h2>
          <p class="section-desc">Exact values from NewDesign.md (Click any card to copy hex code)</p>
        </div>
      </div>

      <h3 style="font-size: 14px; font-family: var(--cv-font-mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--cv-brand-cyan); margin-bottom: 14px;">1. Brand Identity Spectrum</h3>
      <div class="grid-4" style="margin-bottom: 28px;">
        <div class="swatch-card" onclick="copyHex('#00E5FF')">
          <div class="swatch-color" style="background: #00E5FF;"></div>
          <div class="swatch-body">
            <span class="swatch-name">Electric Cyan</span>
            <span class="swatch-hex">#00E5FF</span>
            <span class="swatch-role">Brand Primary / V Highlight</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#14B8A6')">
          <div class="swatch-color" style="background: #14B8A6;"></div>
          <div class="swatch-body">
            <span class="swatch-name">Bright Teal</span>
            <span class="swatch-hex">#14B8A6</span>
            <span class="swatch-role">Mid-Gradient / VerifyAPI</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#0D9488')">
          <div class="swatch-color" style="background: #0D9488;"></div>
          <div class="swatch-body">
            <span class="swatch-name">Deep Teal</span>
            <span class="swatch-hex">#0D9488</span>
            <span class="swatch-role">Gradient End / Secondary Accents</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#67E8F9')">
          <div class="swatch-color" style="background: #67E8F9;"></div>
          <div class="swatch-body">
            <span class="swatch-name">Ice Cyan</span>
            <span class="swatch-hex">#67E8F9</span>
            <span class="swatch-role">Luminous Verified Accent</span>
          </div>
        </div>
      </div>

      <h3 style="font-size: 14px; font-family: var(--cv-font-mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--cv-brand-teal); margin-bottom: 14px;">2. Surface &amp; Environment Tokens</h3>
      <div class="grid-4" style="margin-bottom: 28px;">
        <div class="swatch-card" onclick="copyHex('#0A0A0F')">
          <div class="swatch-color" style="background: #0A0A0F; border: 1px solid rgba(255,255,255,0.08);"></div>
          <div class="swatch-body">
            <span class="swatch-name">Graphite Black</span>
            <span class="swatch-hex">#0A0A0F</span>
            <span class="swatch-role">Global Site / App Canvas</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#11151F')">
          <div class="swatch-color" style="background: #11151F; border: 1px solid rgba(255,255,255,0.08);"></div>
          <div class="swatch-body">
            <span class="swatch-name">Raised Graphite</span>
            <span class="swatch-hex">#11151F</span>
            <span class="swatch-role">Cards &amp; Panels</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#171D29')">
          <div class="swatch-color" style="background: #171D29; border: 1px solid rgba(255,255,255,0.08);"></div>
          <div class="swatch-body">
            <span class="swatch-name">Deep Graphite</span>
            <span class="swatch-hex">#171D29</span>
            <span class="swatch-role">Proof Records / Elevated</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#8F9DB2')">
          <div class="swatch-color" style="background: #8F9DB2;"></div>
          <div class="swatch-body">
            <span class="swatch-name">Cool Slate</span>
            <span class="swatch-hex">#8F9DB2</span>
            <span class="swatch-role">Secondary Text / Metadata</span>
          </div>
        </div>
      </div>

      <h3 style="font-size: 14px; font-family: var(--cv-font-mono); text-transform: uppercase; letter-spacing: 0.1em; color: var(--cv-invoice-proof); margin-bottom: 14px;">3. Semantic Product Palette</h3>
      <div class="grid-3">
        <div class="swatch-card" onclick="copyHex('#14B8A6')">
          <div class="swatch-color" style="background: #14B8A6;"></div>
          <div class="swatch-body">
            <span class="swatch-name">VerifyAPI Accent</span>
            <span class="swatch-hex">#14B8A6 (Bright Teal)</span>
            <span class="swatch-role">API verification badges &amp; limits</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#22D3EE')">
          <div class="swatch-color" style="background: #22D3EE;"></div>
          <div class="swatch-body">
            <span class="swatch-name">AuditProof Accent</span>
            <span class="swatch-hex">#22D3EE (Soft Cyan)</span>
            <span class="swatch-role">Immutable audit trail &amp; verification</span>
          </div>
        </div>

        <div class="swatch-card" onclick="copyHex('#FFB45C')">
          <div class="swatch-color" style="background: #FFB45C;"></div>
          <div class="swatch-body">
            <span class="swatch-name">InvoiceProof Accent</span>
            <span class="swatch-hex">#FFB45C (Warm Amber)</span>
            <span class="swatch-role">Invoice risk scoring &amp; fraud alerts</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 4: Live UI Components Preview -->
    <section class="section" id="ui-preview">
      <div class="section-header">
        <div>
          <h2 class="section-title">Interactive UI Components <span class="badge">ELECTRIC CYAN &amp; TEAL</span></h2>
          <p class="section-desc">Experience the redesigned navigation, hero elements, and proof records</p>
        </div>
      </div>

      <!-- Live Navbar Demo -->
      <div class="live-navbar">
        <div style="display: flex; align-items: center; gap: 14px;">
          <img src="data:image/png;base64,{b64_horiz}" alt="ChainVerify" style="height: 30px; object-fit: contain;">
        </div>
        <div style="display: flex; gap: 24px; font-size: 13px; font-weight: 500; color: var(--cv-text-muted);">
          <span style="color: var(--cv-text); cursor: pointer;">VerifyAPI</span>
          <span style="cursor: pointer;">AuditProof</span>
          <span style="cursor: pointer;">InvoiceProof</span>
          <span style="cursor: pointer;">Pricing</span>
          <span style="cursor: pointer;">Docs</span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="live-secondary">API Keys</button>
          <button class="live-cta">Start Free Proof</button>
        </div>
      </div>

      <!-- Signature Proof Record Object -->
      <div class="proof-record" style="margin-bottom: 24px;">
        <div class="proof-header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span class="proof-badge">● VERIFIED PROOF</span>
            <span class="proof-id">id: prf_9b7e3f80c1d2_live</span>
          </div>
          <div style="font-size: 11px; font-family: var(--cv-font-mono); color: var(--cv-brand-cyan);">
            LATENCY: 42ms · CONSENSUS: 100%
          </div>
        </div>

        <div class="proof-claim">
          Autonomous Agent Execution &amp; Settlement Verified on ChainVerify Rails
        </div>

        <div class="proof-evidence-grid">
          <div class="evidence-item">
            <div class="evidence-label">Execution Hash</div>
            <div class="evidence-val">0x8f2d...3c99a</div>
          </div>
          <div class="evidence-item">
            <div class="evidence-label">Human Review Gate</div>
            <div class="evidence-val" style="color: #10B981;">PASSED (Zero Anomaly)</div>
          </div>
          <div class="evidence-item">
            <div class="evidence-label">Cryptographic Proof</div>
            <div class="evidence-val">SHA-256 Validated</div>
          </div>
        </div>
      </div>

      <!-- 3 Products Mini Cards -->
      <div class="grid-3">
        <div class="card" style="border-top: 3px solid var(--cv-verify-api);">
          <div style="font-size: 11px; font-family: var(--cv-font-mono); color: var(--cv-verify-api); margin-bottom: 6px;">PRODUCT 01</div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">VerifyAPI</h3>
          <p style="font-size: 13px; color: var(--cv-text-muted); line-height: 1.5;">
            Zero-friction verification API for AI agents and code generators. Instant signed proof receipts for programmatic pipelines.
          </p>
        </div>

        <div class="card" style="border-top: 3px solid var(--cv-audit-proof);">
          <div style="font-size: 11px; font-family: var(--cv-font-mono); color: var(--cv-audit-proof); margin-bottom: 6px;">PRODUCT 02</div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">AuditProof</h3>
          <p style="font-size: 13px; color: var(--cv-text-muted); line-height: 1.5;">
            Immutable evidence dossier for enterprise compliance, legal reviews, and AI model safety audits with portable verification packages.
          </p>
        </div>

        <div class="card" style="border-top: 3px solid var(--cv-invoice-proof);">
          <div style="font-size: 11px; font-family: var(--cv-font-mono); color: var(--cv-invoice-proof); margin-bottom: 6px;">PRODUCT 03</div>
          <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px;">InvoiceProof</h3>
          <p style="font-size: 13px; color: var(--cv-text-muted); line-height: 1.5;">
            Continuous AP invoice fraud detection, bank change anomaly monitoring, and payment rail validation before funds leave escrow.
          </p>
        </div>
      </div>
    </section>

    <!-- Section 5: Asset Inventory -->
    <section class="section" id="inventory">
      <div class="section-header">
        <div>
          <h2 class="section-title">Generated Asset Inventory <span class="badge">ON DISK</span></h2>
          <p class="section-desc">All production assets generated and placed in their respective project directories</p>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Destination Path</th>
              <th>Format / Dimensions</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>favicon.ico</strong></td>
              <td><code>apps/web/public/favicon.ico</code></td>
              <td>ICO (16, 32, 48, 64)</td>
              <td>Browser web tab icon &amp; legacy support</td>
            </tr>
            <tr>
              <td><strong>chainverify-icon.svg</strong></td>
              <td><code>apps/web/public/chainverify-icon.svg</code></td>
              <td>SVG (100×100)</td>
              <td>Vector web tab icon &amp; App Router icon</td>
            </tr>
            <tr>
              <td><strong>icon-16 / 32 / 48 / 64.png</strong></td>
              <td><code>apps/web/public/</code></td>
              <td>PNG (16px, 32px, 48px, 64px)</td>
              <td>Multi-resolution browser tab icons</td>
            </tr>
            <tr>
              <td><strong>apple-touch-icon.png</strong></td>
              <td><code>apps/web/public/apple-touch-icon.png</code></td>
              <td>PNG (180×180 on Dark)</td>
              <td>iOS home screen &amp; Safari web clip</td>
            </tr>
            <tr>
              <td><strong>chainverify-logo-horizontal.png</strong></td>
              <td><code>apps/web/public/</code> &amp; <code>brand/</code></td>
              <td>PNG (1746×320)</td>
              <td>Main site navigation header lockup</td>
            </tr>
            <tr>
              <td><strong>chainverify-symbol.png</strong></td>
              <td><code>apps/web/public/</code> &amp; <code>brand/</code></td>
              <td>PNG (842×783)</td>
              <td>Master high-resolution CV emblem</td>
            </tr>
            <tr>
              <td><strong>chainverify-logo-full.png</strong></td>
              <td><code>brand/</code></td>
              <td>PNG (1286×1037)</td>
              <td>Full stacked logo with tagline</td>
            </tr>
            <tr>
              <td><strong>ChainVerifyMark.tsx</strong></td>
              <td><code>apps/web/src/components/brand/</code></td>
              <td>React Component</td>
              <td>Updated to render new CV mark</td>
            </tr>
            <tr>
              <td><strong>site.css</strong></td>
              <td><code>apps/web/src/app/site.css</code></td>
              <td>CSS Tokens</td>
              <td>Electric Cyan &amp; Teal tokens, zero purple</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer style="text-align: center; padding: 48px 0 80px; border-top: 1px solid var(--cv-border); color: var(--cv-text-muted); font-size: 13px;">
      <p>ChainVerify Design System Review · Stella Subagent · Prepared for Ben Stone</p>
      <p style="margin-top: 6px; font-size: 11px; font-family: var(--cv-font-mono); color: var(--cv-text-faint);">
        All files saved locally in repository. Strictly zero purple. No remote git push performed.
      </p>
    </footer>

  </div>

  <div class="toast" id="toast">Copied hex code to clipboard!</div>

  <script>
    // Theme Switcher
    const toggleBtn = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const themeLabel = document.getElementById('themeLabel');
    const html = document.documentElement;

    toggleBtn.addEventListener('click', () => {{
      const current = html.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      themeIcon.textContent = next === 'dark' ? '☀️' : '🌙';
      themeLabel.textContent = next === 'dark' ? 'Light Mode' : 'Dark Mode';
    }});

    // Toast copy helper
    function copyHex(hex) {{
      navigator.clipboard.writeText(hex).then(() => {{
        const toast = document.getElementById('toast');
        toast.textContent = `Copied ${hex} to clipboard!`;
        toast.classList.add('show');
        setTimeout(() => {{
          toast.classList.remove('show');
        }}, 2000);
      }}).catch(err => {{
        console.log('Copy failed:', err);
      }});
    }}
  </script>
</body>
</html>
'''

# Write to repo root
with open(os.path.join(base_dir, 'demo-preview.html'), 'w', encoding='utf-8') as f:
    f.write(html_template)

# Also write to apps/web/public/demo-preview.html so it can be served via Next.js if desired
with open(os.path.join(base_dir, 'apps', 'web', 'public', 'demo-preview.html'), 'w', encoding='utf-8') as f:
    f.write(html_template)

print('demo-preview.html written successfully with zero purple!')

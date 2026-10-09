import os
import base64

base_dir = r'C:\Users\Work\Desktop\GitHub\Chain Verify'
brand_dir = os.path.join(base_dir, 'brand')

def get_b64(rel_path):
    with open(os.path.join(brand_dir, rel_path), 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

b64_horiz = get_b64('chainverify-logo-horizontal.png')
b64_symbol = get_b64('chainverify-symbol.png')
b64_icon32 = get_b64(os.path.join('assets', 'icon-32.png'))

html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
  <title>ChainVerify — Spatial 3D Proof Engine &amp; Technical Verification Dossier</title>
  <link rel="icon" type="image/png" sizes="32x32" href="data:image/png;base64,{b64_icon32}">
  
  <!-- Modern Typography (Inter & JetBrains Mono) -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
  
  <!-- Three.js and GSAP with ScrollTrigger -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/ScrollTrigger.min.js"></script>

  <style>
    :root {{
      --bg-graphite: #0A0A0F;
      --bg-canvas: #0E1118;
      --card-glass: rgba(17, 21, 31, 0.84);
      --card-glass-mobile: rgba(11, 15, 25, 0.94);
      --surface-1: #11151F;
      --surface-2: #171D29;
      --text-main: #F8F9FC;
      --text-muted: #8F9DB2;
      --text-faint: #657287;
      
      /* New Cyan & Teal Palette - Strictly Zero Purple */
      --cyan-energy: #00E5FF;
      --teal-mid: #14B8A6;
      --teal-deep: #0D9488;
      --cyan-highlight: #67E8F9;
      --emerald-success: #10B981;
      --warm-amber: #FFB45C;
      --soft-cyan: #22D3EE;
      
      --border-subtle: rgba(157, 170, 197, 0.16);
      --border-cyan: rgba(0, 229, 255, 0.38);
      --radius-ctrl: 12px;
      --radius-card: 18px;
      --radius-pill: 9999px;
    }}

    * {{
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }}

    html, body {{
      width: 100%;
      min-height: 100%;
      background-color: var(--bg-graphite);
      color: var(--text-main);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      overflow-x: hidden;
      touch-action: pan-y;
    }}

    /* Fixed WebGL 3D Canvas */
    #webgl-container {{
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1;
      pointer-events: auto;
    }}

    /* Depth Vignette Overlay */
    .viewport-overlay {{
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2;
      pointer-events: none;
      background: radial-gradient(circle at 50% 50%, transparent 50%, rgba(10, 10, 15, 0.85) 100%);
    }}

    /* Fixed Brand Navigation Header */
    header.brand-nav {{
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      z-index: 50;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.25rem 3rem;
      background: linear-gradient(180deg, rgba(10, 10, 15, 0.92) 0%, rgba(10, 10, 15, 0) 100%);
      pointer-events: none;
    }}

    .brand-group {{
      display: flex;
      align-items: center;
      gap: 1.25rem;
      pointer-events: auto;
    }}

    .brand-logo-img {{
      height: 36px;
      width: auto;
      object-fit: contain;
      filter: drop-shadow(0 0 16px rgba(0, 229, 255, 0.35));
      transition: transform 0.25s ease;
    }}
    .brand-logo-img:hover {{
      transform: scale(1.03);
    }}

    .engine-chip {{
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      padding: 0.32rem 0.8rem;
      border-radius: var(--radius-pill);
      background: rgba(0, 229, 255, 0.08);
      border: 1px solid rgba(0, 229, 255, 0.28);
      color: var(--cyan-energy);
      letter-spacing: 0.06em;
      white-space: nowrap;
    }}

    .pulse-indicator {{
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--cyan-energy);
      box-shadow: 0 0 10px var(--cyan-energy);
      animation: pulse-ring 2.2s infinite cubic-bezier(0.4, 0, 0.6, 1);
    }}

    @keyframes pulse-ring {{
      0%, 100% {{ opacity: 0.4; transform: scale(0.85); }}
      50% {{ opacity: 1; transform: scale(1.25); }}
    }}

    .nav-actions {{
      display: flex;
      align-items: center;
      gap: 0.75rem;
      pointer-events: auto;
    }}

    .btn-chip {{
      background: rgba(23, 29, 41, 0.85);
      border: 1px solid var(--border-subtle);
      color: var(--text-muted);
      font-family: 'Inter', sans-serif;
      font-size: 0.8rem;
      font-weight: 600;
      padding: 0.55rem 1.1rem;
      min-height: 44px;
      min-width: 44px;
      border-radius: var(--radius-ctrl);
      cursor: pointer;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      transition: all 0.22s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
    }}

    .btn-chip:hover {{
      border-color: var(--border-cyan);
      color: #FFFFFF;
      background: rgba(30, 41, 59, 0.9);
      box-shadow: 0 0 16px rgba(0, 229, 255, 0.2);
    }}

    .btn-chip.active {{
      border-color: var(--cyan-energy);
      color: var(--cyan-energy);
      background: rgba(0, 229, 255, 0.12);
    }}

    .btn-primary-cta {{
      background: linear-gradient(135deg, #00E5FF 0%, #14B8A6 55%, #0D9488 100%);
      color: #0A0A0F;
      border: none;
      font-family: 'Inter', sans-serif;
      font-size: 0.82rem;
      font-weight: 800;
      padding: 0.55rem 1.35rem;
      min-height: 44px;
      border-radius: var(--radius-ctrl);
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 229, 255, 0.35);
      transition: all 0.22s ease;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      white-space: nowrap;
      text-decoration: none;
    }}
    .btn-primary-cta:hover {{
      transform: translateY(-2px);
      box-shadow: 0 12px 32px rgba(0, 229, 255, 0.55);
    }}

    /* Fixed Stage Navigation Sidebar (Desktop) */
    .stage-rail {{
      position: fixed;
      right: 3rem;
      top: 50%;
      transform: translateY(-50%);
      z-index: 40;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      pointer-events: auto;
    }}

    .stage-rail-item {{
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 1rem;
      cursor: pointer;
      min-height: 36px;
      padding: 4px 0;
    }}

    .stage-rail-text {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-faint);
      opacity: 0;
      transform: translateX(12px);
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      pointer-events: none;
      white-space: nowrap;
    }}

    .stage-rail-item:hover .stage-rail-text,
    .stage-rail-item.active .stage-rail-text {{
      opacity: 1;
      transform: translateX(0);
      color: var(--cyan-energy);
    }}

    .stage-rail-dot {{
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #1E293B;
      border: 1px solid rgba(255, 255, 255, 0.15);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }}

    .stage-rail-item:hover .stage-rail-dot {{
      border-color: var(--cyan-energy);
      transform: scale(1.2);
    }}

    .stage-rail-item.active .stage-rail-dot {{
      background: var(--cyan-energy);
      border-color: #FFFFFF;
      box-shadow: 0 0 14px var(--cyan-energy);
      transform: scale(1.45);
    }}

    /* Story Sections for ScrollTrigger */
    .storyline-container {{
      position: relative;
      z-index: 10;
      pointer-events: none;
      width: 100%;
    }}

    .story-stage {{
      min-height: 100vh;
      display: flex;
      align-items: center;
      padding: 4rem 10vw;
      pointer-events: none;
      box-sizing: border-box;
    }}

    .story-card {{
      pointer-events: auto;
      width: 100%;
      max-width: 520px;
      background: var(--card-glass);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-card);
      padding: 2.25rem 2.5rem;
      box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.85), 0 0 1px 1px rgba(255, 255, 255, 0.05);
      position: relative;
      overflow: hidden;
      transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s ease;
    }}

    .story-card:hover {{
      border-color: var(--border-cyan);
      box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 229, 255, 0.18);
    }}

    .story-card::before {{
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(180deg, var(--cyan-energy), rgba(0, 229, 255, 0));
    }}

    .story-stage:nth-child(5) .story-card::before {{
      background: linear-gradient(180deg, var(--emerald-success), rgba(16, 185, 129, 0));
    }}

    .stage-header-badge {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.74rem;
      font-weight: 700;
      color: var(--cyan-energy);
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 0.85rem;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }}

    .story-stage:nth-child(5) .stage-header-badge {{
      color: var(--emerald-success);
    }}

    .story-card h2 {{
      font-size: clamp(1.45rem, 3.2vw, 1.95rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      color: #FFFFFF;
      margin-bottom: 1rem;
      line-height: 1.22;
    }}

    .story-card p {{
      color: var(--text-muted);
      font-size: clamp(0.88rem, 1.8vw, 0.96rem);
      line-height: 1.68;
      margin-bottom: 0.85rem;
    }}

    .story-card p:last-of-type {{
      margin-bottom: 1.35rem;
    }}

    .pill-group {{
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }}

    .data-pill {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.72rem;
      padding: 0.38rem 0.7rem;
      background: rgba(23, 29, 41, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 6px;
      color: #CBD5E1;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      transition: all 0.2s ease;
    }}

    .data-pill.scan {{
      border-color: rgba(0, 229, 255, 0.4);
      color: var(--cyan-highlight);
      background: rgba(0, 229, 255, 0.09);
    }}

    .data-pill.success {{
      border-color: rgba(16, 185, 129, 0.45);
      color: #6EE7B7;
      background: rgba(16, 185, 129, 0.14);
    }}

    /* Bottom Interactive Scrub Bar */
    .dock-scrubber {{
      position: fixed;
      bottom: 1.75rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 50;
      display: flex;
      align-items: center;
      gap: 1.35rem;
      background: var(--card-glass);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-pill);
      padding: 0.65rem 1.6rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.75), 0 0 20px rgba(0, 229, 255, 0.12);
      pointer-events: auto;
      max-width: 90vw;
    }}

    .play-toggle-btn {{
      width: 38px;
      height: 38px;
      min-width: 38px;
      min-height: 38px;
      border-radius: 50%;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.35);
      color: var(--cyan-energy);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      transition: all 0.2s ease;
    }}

    .play-toggle-btn:hover, .play-toggle-btn:active {{
      background: rgba(0, 229, 255, 0.3);
      transform: scale(1.08);
    }}

    .scrub-track-area {{
      display: flex;
      align-items: center;
      gap: 1rem;
    }}

    .stage-counter {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      color: var(--text-muted);
      min-width: 140px;
      font-weight: 600;
      white-space: nowrap;
    }}

    .scrub-rail {{
      width: 240px;
      height: 8px;
      background: #1E293B;
      border-radius: 4px;
      position: relative;
      cursor: pointer;
      touch-action: none;
    }}

    .scrub-fill {{
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      background: linear-gradient(90deg, var(--cyan-energy), var(--teal-mid));
      border-radius: 4px;
      width: 0%;
      pointer-events: none;
    }}

    .scrub-thumb {{
      position: absolute;
      top: 50%;
      left: 0%;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #FFFFFF;
      box-shadow: 0 0 14px var(--cyan-energy);
      transform: translate(-50%, -50%);
      cursor: grab;
      pointer-events: none;
    }}

    .hint-label {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--text-faint);
      white-space: nowrap;
    }}

    /* Floating In-Scene Hover Tooltip */
    #hover-hud {{
      position: fixed;
      pointer-events: none;
      z-index: 100;
      background: rgba(17, 21, 31, 0.94);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid var(--cyan-energy);
      box-shadow: 0 12px 30px rgba(0, 229, 255, 0.25);
      border-radius: 12px;
      padding: 0.9rem 1.15rem;
      min-width: 240px;
      opacity: 0;
      transform: translate(16px, 16px);
      transition: opacity 0.2s ease;
    }}

    #hover-hud.visible {{
      opacity: 1;
    }}

    .hud-title-bar {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      font-weight: 700;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.45rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 0.35rem;
    }}

    .hud-line {{
      display: flex;
      justify-content: space-between;
      gap: 1.25rem;
      font-size: 0.72rem;
      margin-top: 0.25rem;
    }}

    .hud-line span:first-child {{
      color: var(--text-faint);
    }}

    .hud-line span:last-child {{
      color: var(--cyan-energy);
      font-family: 'JetBrains Mono', monospace;
    }}

    /* Deep Proof Node Inspector Card */
    #proof-inspector-card {{
      position: fixed;
      top: 50%;
      right: 3.5rem;
      transform: translateY(-50%) translateX(20px);
      z-index: 95;
      width: 400px;
      max-width: 90vw;
      background: rgba(17, 21, 31, 0.96);
      backdrop-filter: blur(28px);
      -webkit-backdrop-filter: blur(28px);
      border: 1px solid rgba(0, 229, 255, 0.4);
      border-radius: 20px;
      padding: 2rem;
      box-shadow: 0 35px 70px -15px rgba(0, 0, 0, 0.9), 0 0 35px rgba(0, 229, 255, 0.18);
      opacity: 0;
      pointer-events: none;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }}

    #proof-inspector-card.open {{
      opacity: 1;
      pointer-events: auto;
      transform: translateY(-50%) translateX(0);
    }}

    .inspector-close-btn {{
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.25rem;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      transition: all 0.2s ease;
    }}

    .inspector-close-btn:hover, .inspector-close-btn:active {{
      color: #FFFFFF;
      background: rgba(0, 229, 255, 0.2);
      border-color: var(--cyan-energy);
    }}

    .inspector-top-meta {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.7rem;
      color: var(--cyan-energy);
      margin-bottom: 0.25rem;
      letter-spacing: 0.08em;
    }}

    .inspector-title {{
      font-size: 1.25rem;
      font-weight: 800;
      color: #FFFFFF;
      margin-bottom: 1.25rem;
    }}

    .inspector-metric-box {{
      margin-bottom: 0.85rem;
      background: rgba(10, 10, 15, 0.75);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 0.75rem 1rem;
    }}

    .metric-label {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.65rem;
      text-transform: uppercase;
      color: var(--text-faint);
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }}

    .metric-value {{
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.82rem;
      color: #F1F5F9;
      word-break: break-all;
    }}

    .verified-seal-badge {{
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: rgba(16, 185, 129, 0.14);
      border: 1px solid rgba(16, 185, 129, 0.45);
      color: var(--emerald-success);
      font-weight: 700;
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.78rem;
      font-family: 'JetBrains Mono', monospace;
      margin-top: 0.25rem;
    }}

    /* Static WebGL Fallback Container */
    #static-fallback-container {{
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 1;
      background: radial-gradient(circle at 50% 40%, #11151F 0%, #0A0A0F 100%);
      pointer-events: none;
    }}

    .static-proof-state {{
      display: none;
      position: fixed;
      bottom: 5.5rem;
      left: 3rem;
      background: var(--card-glass);
      border: 1px solid var(--border-subtle);
      border-radius: 14px;
      padding: 1.15rem 1.4rem;
      z-index: 45;
      max-width: 340px;
      backdrop-filter: blur(20px);
    }}

    body.reduced-motion .static-proof-state {{
      display: block;
    }}

    /* ========================================================= */
    /* RESPONSIVE BREAKPOINTS (Mobile, Tablet, Desktop)          */
    /* ========================================================= */

    /* Tablet & Medium Screens (< 1024px) */
    @media (max-width: 1024px) {{
      header.brand-nav {{
        padding: 1rem 2rem;
      }}
      .story-stage {{
        padding: 4rem 6vw;
      }}
      .stage-rail {{
        right: 1.5rem;
      }}
    }}

    /* Mobile & Small Tablets (< 768px) */
    @media (max-width: 768px) {{
      header.brand-nav {{
        padding: 0.85rem 1.25rem;
        background: rgba(10, 10, 15, 0.95);
      }}
      .brand-logo-img {{
        height: 28px;
      }}
      .engine-chip {{
        display: none; /* Keep header ultra clean on phones */
      }}
      .btn-chip {{
        padding: 0.45rem 0.75rem;
        font-size: 0.75rem;
      }}
      .btn-primary-cta {{
        padding: 0.45rem 0.9rem;
        font-size: 0.78rem;
      }}
      
      .stage-rail {{
        display: none; /* Hidden on touch phones */
      }}

      /* Mobile Stacking & Card Presentation */
      .story-stage {{
        padding: 5.5rem 1rem 5.5rem 1rem;
        align-items: flex-end; /* Position story cards in bottom viewport half */
        justify-content: center;
        min-height: 100vh;
      }}

      .story-card {{
        max-width: 100%;
        background: var(--card-glass-mobile);
        border: 1px solid rgba(0, 229, 255, 0.28);
        border-radius: 16px;
        padding: 1.5rem 1.35rem;
        margin-bottom: 2rem;
      }}

      .story-card h2 {{
        font-size: 1.35rem;
        margin-bottom: 0.75rem;
      }}

      .story-card p {{
        font-size: 0.88rem;
        line-height: 1.58;
      }}

      .dock-scrubber {{
        bottom: 1rem;
        width: calc(100vw - 1.5rem);
        padding: 0.55rem 0.9rem;
        gap: 0.75rem;
        justify-content: space-between;
      }}

      .hint-label {{
        display: none;
      }}

      .stage-counter {{
        font-size: 0.7rem;
        min-width: 105px;
      }}

      .scrub-rail {{
        width: 110px;
      }}

      #proof-inspector-card {{
        width: calc(100vw - 2rem);
        right: 1rem;
        padding: 1.4rem;
        border-radius: 16px;
      }}

      .static-proof-state {{
        left: 1rem;
        right: 1rem;
        max-width: calc(100vw - 2rem);
        bottom: 5.2rem;
      }}
    }}

    /* Ultra-compact Phones (<= 390px, e.g. 320px - 375px) */
    @media (max-width: 390px) {{
      header.brand-nav {{
        padding: 0.75rem 0.85rem;
      }}
      .brand-logo-img {{
        height: 24px;
      }}
      .btn-chip {{
        padding: 0.4rem 0.6rem;
        font-size: 0.72rem;
      }}
      .story-stage {{
        padding: 5rem 0.75rem 5rem 0.75rem;
      }}
      .story-card {{
        padding: 1.25rem 1.1rem;
      }}
      .story-card h2 {{
        font-size: 1.22rem;
      }}
      .story-card p {{
        font-size: 0.84rem;
      }}
      .data-pill {{
        font-size: 0.68rem;
        padding: 0.3rem 0.55rem;
      }}
      .dock-scrubber {{
        padding: 0.45rem 0.75rem;
      }}
      .scrub-rail {{
        width: 80px;
      }}
      .stage-counter {{
        font-size: 0.65rem;
        min-width: 90px;
      }}
    }}
  </style>
</head>
<body>

  <!-- WebGL 3D Canvas -->
  <div id="webgl-container"></div>
  <div id="static-fallback-container" aria-hidden="true"></div>
  <div class="viewport-overlay"></div>

  <!-- Header Navigation -->
  <header class="brand-nav">
    <div class="brand-group">
      <img src="data:image/png;base64,{b64_horiz}" alt="ChainVerify" class="brand-logo-img">
      <div class="engine-chip">
        <div class="pulse-indicator"></div>
        <span>PROOF ENGINE &bull; WebGL Spatial Horizon</span>
      </div>
    </div>

    <div class="nav-actions">
      <button id="btn-motion-toggle" class="btn-chip" title="Toggle Motion Preferences" aria-label="Toggle Motion">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
        <span id="motion-btn-text">Motion On</span>
      </button>
      <button id="btn-reset-view" class="btn-chip" title="Reset 3D Camera" aria-label="Reset Camera View">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
        <span>Reset</span>
      </button>
      <a class="btn-primary-cta" href="/verify-api#proof">
        <span>Live Proof Demo</span> &rarr;
      </a>
    </div>
  </header>

  <!-- Right Stage Progress Rail (Desktop) -->
  <nav class="stage-rail" aria-label="Verification Story Stages">
    <div class="stage-rail-item active" data-stage="0">
      <span class="stage-rail-text">01 // Collect</span>
      <div class="stage-rail-dot"></div>
    </div>
    <div class="stage-rail-item" data-stage="1">
      <span class="stage-rail-text">02 // Check</span>
      <div class="stage-rail-dot"></div>
    </div>
    <div class="stage-rail-item" data-stage="2">
      <span class="stage-rail-text">03 // Cross-Check</span>
      <div class="stage-rail-dot"></div>
    </div>
    <div class="stage-rail-item" data-stage="3">
      <span class="stage-rail-text">04 // Create Proof</span>
      <div class="stage-rail-dot"></div>
    </div>
    <div class="stage-rail-item" data-stage="4">
      <span class="stage-rail-text">05 // Connect Proof</span>
      <div class="stage-rail-dot"></div>
    </div>
  </nav>

  <!-- Main Scrollable Storyline -->
  <main class="storyline-container">
    
    <!-- Stage 1 -->
    <section class="story-stage" id="stage-1">
      <div class="story-card">
        <div class="stage-header-badge">STAGE 01 &bull; COLLECT THE EVIDENCE</div>
        <h2>Bring Everything Together</h2>
        <p>ChainVerify gathers the evidence that matters before anything is verified — invoices, browser activity, system data, webhooks, and other records.</p>
        <p>Each item is captured with information about where it came from and when it was created, creating a reliable starting point for verification.</p>
        <div class="pill-group">
          <span class="data-pill"><span style="color:#00E5FF">&bull;</span> invoices</span>
          <span class="data-pill"><span style="color:#00E5FF">&bull;</span> browser activity</span>
          <span class="data-pill"><span style="color:#00E5FF">&bull;</span> system data</span>
          <span class="data-pill"><span style="color:#00E5FF">&bull;</span> webhooks</span>
          <span class="data-pill"><span style="color:#00E5FF">&bull;</span> fiscal records</span>
        </div>
      </div>
    </section>

    <!-- Stage 2 -->
    <section class="story-stage" id="stage-2">
      <div class="story-card">
        <div class="stage-header-badge">STAGE 02 &bull; CHECK THE EVIDENCE</div>
        <h2>Inspect Every Detail</h2>
        <p>ChainVerify examines each piece of evidence to confirm that it is authentic and hasn't been changed.</p>
        <p>It checks things like digital fingerprints, signatures, timestamps, and source information before allowing the evidence to move forward.</p>
        <div class="pill-group">
          <span class="data-pill scan">DIGITAL FINGERPRINTS</span>
          <span class="data-pill scan">SIGNATURES</span>
          <span class="data-pill scan">TIMESTAMPS</span>
          <span class="data-pill scan">SOURCE PROVENANCE</span>
        </div>
      </div>
    </section>

    <!-- Stage 3 -->
    <section class="story-stage" id="stage-3">
      <div class="story-card">
        <div class="stage-header-badge">STAGE 03 &bull; CROSS-CHECK THE RESULTS</div>
        <h2>Verify It From Multiple Sources</h2>
        <p>ChainVerify doesn't rely on a single check.</p>
        <p>It compares evidence across different systems — such as AI activity, invoices and accounting records, browser evidence, and audit records — to make sure the information agrees. Those independent checks come together to create one trusted result.</p>
        <div class="pill-group">
          <span class="data-pill">AI Activity &bull; VerifyAPI</span>
          <span class="data-pill">Invoices &bull; InvoiceProof</span>
          <span class="data-pill">Audit Records &bull; AuditProof</span>
          <span class="data-pill">Browser Evidence</span>
        </div>
      </div>
    </section>

    <!-- Stage 4 -->
    <section class="story-stage" id="stage-4">
      <div class="story-card">
        <div class="stage-header-badge">STAGE 04 &bull; CREATE THE PROOF</div>
        <h2>Turn Evidence Into Verifiable Proof</h2>
        <p>Once the evidence checks out, ChainVerify combines it into a permanent proof record.</p>
        <p>The proof contains the information needed to show what was verified, where the evidence came from, and that it has not been altered.</p>
        <div class="pill-group">
          <span class="data-pill success">&#x2713; PROOF RECORD CREATED</span>
          <span class="data-pill success">&#x2713; UNALTERED MERKLE ROOT</span>
          <span class="data-pill success">&#x2713; EVIDENCE ANCHORED</span>
        </div>
      </div>
    </section>

    <!-- Stage 5 -->
    <section class="story-stage" id="stage-5">
      <div class="story-card">
        <div class="stage-header-badge">STAGE 05 &bull; CONNECT THE PROOF</div>
        <h2>Build a Trusted Chain of Evidence</h2>
        <p>Each verified proof becomes part of a connected record that can be checked again later.</p>
        <p>That gives businesses, auditors, applications, and AI agents a clear way to answer: What happened? Where did the evidence come from? Was it verified? Can we prove it?</p>
        <div class="pill-group">
          <span class="data-pill success" style="background: rgba(16, 185, 129, 0.2); border-color: var(--emerald-success); color: #FFFFFF;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
            TRUSTED CHAIN OF EVIDENCE &bull; SEALED
          </span>
        </div>
      </div>
    </section>

  </main>

  <!-- Interactive Bottom Scrub Dock -->
  <footer class="dock-scrubber">
    <button class="play-toggle-btn" id="play-btn" title="Toggle Auto Playback" aria-label="Play or pause animation">
      <span id="play-symbol">&#9658;</span>
    </button>
    <div class="scrub-track-area">
      <div class="stage-counter" id="stage-readout">STAGE 1 / 5 &bull; COLLECT</div>
      <div class="scrub-rail" id="timeline-rail" title="Drag or tap to scrub verification sequence" role="slider" aria-valuemin="0" aria-valuemax="4" aria-valuenow="0">
        <div class="scrub-fill" id="scrub-fill"></div>
        <div class="scrub-thumb" id="scrub-thumb"></div>
      </div>
    </div>
    <div class="hint-label">DRAG TIMELINE &bull; HOVER 3D NODES &bull; CLICK TO INSPECT</div>
  </footer>

  <!-- Hover Probing HUD -->
  <div id="hover-hud">
    <div class="hud-title-bar">
      <span id="hud-name">INVOICE.PDF</span>
      <span style="color:var(--cyan-energy); font-size:0.65rem;">&bull; PROBE ACTIVE</span>
    </div>
    <div class="hud-line"><span>TYPE</span><span id="hud-type">Accounts Payable</span></div>
    <div class="hud-line"><span>HASH</span><span id="hud-hash">8c4a...71ef</span></div>
    <div class="hud-line"><span>STATUS</span><span id="hud-status">Ingesting evidence</span></div>
  </div>

  <!-- Detailed Proof Node Inspector -->
  <aside id="proof-inspector-card">
    <button class="inspector-close-btn" id="inspector-close-btn" aria-label="Close inspector">&times;</button>
    <div class="inspector-top-meta">// VERIFIED AUDIT RECORD</div>
    <div class="inspector-title" id="inspector-title">Invoice Proof Node</div>

    <div class="inspector-metric-box">
      <div class="metric-label">SOURCE</div>
      <div class="metric-value" id="insp-source">invoice.pdf &bull; Accounts Payable</div>
    </div>
    <div class="inspector-metric-box">
      <div class="metric-label">SHA-256 HASH</div>
      <div class="metric-value" id="insp-hash">8c4a92e10ff48b1392da71ef99c15d74</div>
    </div>
    <div class="inspector-metric-box">
      <div class="metric-label">TIMESTAMP</div>
      <div class="metric-value" id="insp-time">Verified (2026-09-29T12:00:00Z)</div>
    </div>
    <div class="inspector-metric-box">
      <div class="metric-label">EVIDENCE ATTESTATION</div>
      <div class="metric-value" id="insp-evidence">5 multi-source records</div>
    </div>
    <div class="inspector-metric-box">
      <div class="metric-label">VERIFICATION STATUS</div>
      <div class="verified-seal-badge">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
        Cryptographically intact &bull; Consensus Locked
      </div>
    </div>
  </aside>

  <!-- Static State Fallback for Reduced Motion -->
  <div class="static-proof-state">
    <div style="font-family:'JetBrains Mono',monospace; font-size:0.75rem; color:var(--cyan-energy); margin-bottom:0.35rem;">
      ACCESSIBILITY FALLBACK ACTIVE
    </div>
    <p style="font-size:0.8rem; color:var(--text-muted); line-height:1.45;">
      Motion animations paused per your system preferences. Displaying the stabilized ChainVerify immutable proof consensus network.
    </p>
  </div>

  <!-- Three.js + GSAP Core Engine Script -->
  <script>
    const container = document.getElementById('webgl-container');
    let scene, camera, renderer;
    let mainRig, evidenceRig, orbitalRig, particleRig, hexCoreRig, chainNetRig;
    let ctScanPlane;
    let raycaster, mouse = new THREE.Vector2(-100, -100);
    
    let isMouseDown = false;
    let prevMouseX = 0, prevMouseY = 0;
    let manualRotX = 0, manualRotY = 0;
    let parallaxTargetX = 0, parallaxTargetY = 0;
    let parallaxCurrentX = 0, parallaxCurrentY = 0;

    let timelineProgress = 0.0;
    let isPlaying = false;
    let isReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let isMobile = window.innerWidth < 768;

    const evidenceItems = [
      {{ id: 'invoice', name: 'invoice.pdf', type: 'AP Ledger', hash: '8c4a92...71ef', fullHash: '8c4a92e10ff48b1392da71ef99c15d7426b68019', records: '5 invoice line items', origin: new THREE.Vector3(-14, 7, 10) }},
      {{ id: 'browser', name: 'browser.capture', type: 'DOM State', hash: '3f71c4...9a02', fullHash: '3f71c48bb019e4811a2f9a027c9940188bb3d211', records: '14 DOM state nodes', origin: new THREE.Vector3(15, 8, 8) }},
      {{ id: 'audit', name: 'audit.json', type: 'Telemetry Trail', hash: 'e201b8...54df', fullHash: 'e201b8f54128dd71923054df61280a8274f9911e', records: '48 ledger entries', origin: new THREE.Vector3(-12, -7, 11) }},
      {{ id: 'receipt', name: 'receipt.png', type: 'Fiscal Slip', hash: '9b33a1...c014', fullHash: '9b33a18e001923485764c0142b78119001ee5a66', records: '1 fiscal slip', origin: new THREE.Vector3(14, -8, 6) }},
      {{ id: 'api', name: 'api.event', type: 'Signed Webhook', hash: 'a104f7...38e9', fullHash: 'a104f71882001955374838e9fa0142948c2018ea', records: '1 signed webhook event', origin: new THREE.Vector3(0, 13, 13) }}
    ];

    const evidenceMeshes = [];
    let connectingTraces = [];
    let ctScanLabels = [];
    let particleSystem;
    let centralHexPrism, innerEvidenceLattice, coreHaloRing;
    let chainHexNodes = [];
    let chainStrandBeams = [];

    function generateDocumentTexture(spec) {{
      const cvs = document.createElement('canvas');
      cvs.width = 512;
      cvs.height = 640;
      const ctx = cvs.getContext('2d');

      ctx.fillStyle = '#11151F';
      ctx.fillRect(0, 0, 512, 640);

      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, 504, 632);

      ctx.fillStyle = '#171D29';
      ctx.fillRect(0, 0, 512, 110);

      ctx.fillStyle = '#00E5FF';
      ctx.beginPath();
      ctx.arc(60, 55, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0A0A0F';
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(spec.id.substring(0, 2).toUpperCase(), 60, 55);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 28px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(spec.name, 105, 50);

      ctx.fillStyle = '#8F9DB2';
      ctx.font = '16px "JetBrains Mono", monospace';
      ctx.fillText(spec.type.toUpperCase(), 105, 82);

      if (spec.id === 'invoice') {{
        ctx.fillStyle = '#1E293B';
        ctx.fillRect(45, 140, 422, 35);
        ctx.fillStyle = '#64748B';
        ctx.font = '15px "JetBrains Mono", monospace';
        ctx.fillText('INVOICE #CV-89410  |  DUE: NET 30', 55, 162);

        for (let y = 200; y < 450; y += 45) {{
          ctx.fillStyle = '#171D29';
          ctx.fillRect(45, y, 422, 30);
          ctx.fillStyle = '#00E5FF';
          ctx.fillRect(400, y + 8, 50, 14);
        }}
      }} else if (spec.id === 'browser') {{
        ctx.fillStyle = '#0A0A0F';
        ctx.fillRect(45, 140, 422, 40);
        ctx.fillStyle = '#00E5FF';
        ctx.font = '14px "JetBrains Mono", monospace';
        ctx.fillText('https://chainverify.org/evidence', 60, 165);

        for (let y = 210; y < 460; y += 38) {{
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(60 + (y % 3) * 20, y, 260, 16);
        }}
      }} else if (spec.id === 'audit') {{
        ctx.fillStyle = '#0A0A0F';
        ctx.fillRect(45, 140, 422, 330);
        ctx.fillStyle = '#14B8A6';
        ctx.font = '15px "JetBrains Mono", monospace';
        ctx.fillText('{{ "event": "EVIDENCE_CAPTURED",', 60, 180);
        ctx.fillText('  "sender": "0x7a2...1b9",', 60, 215);
        ctx.fillText('  "stateRoot": "0x981fae...",', 60, 250);
        ctx.fillText('  "verified": true }}', 60, 285);
      }} else {{
        for (let y = 150; y < 460; y += 40) {{
          ctx.fillStyle = '#1E293B';
          ctx.fillRect(45, y, 180 + Math.sin(y) * 140, 16);
        }}
      }}

      ctx.fillStyle = '#0A0A0F';
      ctx.fillRect(40, 520, 432, 75);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 520, 432, 75);

      ctx.fillStyle = '#00E5FF';
      ctx.font = '15px "JetBrains Mono", monospace';
      ctx.fillText('SHA-256: ' + spec.hash, 55, 552);

      ctx.fillStyle = '#8F9DB2';
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.fillText('STATUS: RAW UNSEALED PAYLOAD', 55, 576);

      const texture = new THREE.CanvasTexture(cvs);
      texture.anisotropy = Math.min(8, renderer ? renderer.capabilities.getMaxAnisotropy() : 4);
      return texture;
    }}

    function generateCTLabel(text) {{
      const cvs = document.createElement('canvas');
      cvs.width = 256;
      cvs.height = 70;
      const ctx = cvs.getContext('2d');

      ctx.fillStyle = 'rgba(10, 10, 15, 0.9)';
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 3;

      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(4, 4, 248, 62, 12) : ctx.rect(4, 4, 248, 62);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 35);

      const texture = new THREE.CanvasTexture(cvs);
      const spriteMat = new THREE.SpriteMaterial({{ map: texture, transparent: true, opacity: 0 }});
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(3.2, 0.85, 1);
      return sprite;
    }}

    function initThreeScene() {{
      try {{
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0A0A0F);
        scene.fog = new THREE.FogExp2(0x0A0A0F, isMobile ? 0.015 : 0.02);

        camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        updateCameraForViewport();

        renderer = new THREE.WebGLRenderer({{
          antialias: !isMobile,
          alpha: false,
          powerPreference: 'high-performance',
          precision: isMobile ? 'mediump' : 'highp'
        }});
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;
        container.appendChild(renderer.domElement);

        raycaster = new THREE.Raycaster();

        mainRig = new THREE.Group();
        evidenceRig = new THREE.Group();
        orbitalRig = new THREE.Group();
        particleRig = new THREE.Group();
        hexCoreRig = new THREE.Group();
        chainNetRig = new THREE.Group();

        mainRig.add(evidenceRig);
        mainRig.add(orbitalRig);
        mainRig.add(particleRig);
        mainRig.add(hexCoreRig);
        mainRig.add(chainNetRig);
        scene.add(mainRig);

        // Dynamic mobile rig positioning to float cleanly above text cards
        if (isMobile) {{
          mainRig.position.y = 4.0;
        }}

        const ambLight = new THREE.AmbientLight(0x11151F, 1.6);
        scene.add(ambLight);

        const keyLight = new THREE.DirectionalLight(0x00E5FF, 1.8);
        keyLight.position.set(20, 30, 25);
        scene.add(keyLight);

        const tealRim = new THREE.DirectionalLight(0x14B8A6, 1.4);
        tealRim.position.set(-25, -15, -20);
        scene.add(tealRim);

        const coreGlow = new THREE.PointLight(0x00E5FF, 2.5, 45);
        coreGlow.position.set(0, 0, 0);
        scene.add(coreGlow);

        createEvidenceObjects();
        createCTScanRig();
        createThreeOrbitalTracks();
        createParticleConvergenceVortex();
        createCrystallizedHexagonalCore();
        createChainVerifiedNetwork();

        window.addEventListener('resize', handleWindowResize, {{ passive: true }});
        window.addEventListener('mousemove', handleMouseMove, {{ passive: true }});
        window.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('click', handleSceneClick);

        // Touch gesture support for mobile viewport inspection
        window.addEventListener('touchstart', handleTouchStart, {{ passive: true }});
        window.addEventListener('touchmove', handleTouchMove, {{ passive: true }});
        window.addEventListener('touchend', handleTouchEnd);

      }} catch (err) {{
        console.warn('WebGL Initialization Fallback:', err);
        document.getElementById('static-fallback-container').style.display = 'block';
        document.querySelector('.static-proof-state').style.display = 'block';
      }}
    }}

    function updateCameraForViewport() {{
      isMobile = window.innerWidth < 768;
      if (!camera) return;
      
      if (window.innerWidth < 480) {{
        camera.position.set(0, 4, 46);
        camera.fov = 52;
      }} else if (window.innerWidth < 768) {{
        camera.position.set(0, 3, 40);
        camera.fov = 48;
      }} else {{
        camera.position.set(0, 2, 34);
        camera.fov = 45;
      }}
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();

      if (mainRig) {{
        mainRig.position.y = isMobile ? 3.5 : 0;
      }}
    }}

    function createEvidenceObjects() {{
      const geo = new THREE.PlaneGeometry(3.4, 4.25);
      const backGeo = new THREE.PlaneGeometry(3.4, 4.25);
      backGeo.rotateY(Math.PI);

      const scanLabels = ['PROVENANCE', 'INTEGRITY', 'TIMESTAMPS', 'FINGERPRINTS', 'ORIGIN'];

      evidenceItems.forEach((spec, i) => {{
        const itemGroup = new THREE.Group();
        itemGroup.userData = spec;

        const tex = generateDocumentTexture(spec);
        const frontMat = new THREE.MeshStandardMaterial({{
          map: tex,
          transparent: true,
          opacity: 0.94,
          roughness: 0.3,
          metalness: 0.1,
          side: THREE.FrontSide
        }});
        const frontMesh = new THREE.Mesh(geo, frontMat);

        const backMat = new THREE.MeshStandardMaterial({{
          color: 0x11151F,
          roughness: 0.6,
          metalness: 0.2,
          side: THREE.FrontSide
        }});
        const backMesh = new THREE.Mesh(backGeo, backMat);

        const edges = new THREE.EdgesGeometry(geo);
        const rim = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({{ color: 0x00E5FF, transparent: true, opacity: 0.45 }})
        );

        itemGroup.add(frontMesh);
        itemGroup.add(backMesh);
        itemGroup.add(rim);

        const sprite = generateCTLabel(scanLabels[i]);
        sprite.position.set(0, 2.7, 0);
        itemGroup.add(sprite);
        ctScanLabels.push(sprite);

        itemGroup.position.copy(spec.origin);
        itemGroup.rotation.set(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.7,
          (Math.random() - 0.5) * 0.3
        );

        evidenceRig.add(itemGroup);
        evidenceMeshes.push(itemGroup);
      }});

      const lineMat = new THREE.LineBasicMaterial({{
        color: 0x00E5FF,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending
      }});

      for (let i = 0; i < evidenceItems.length; i++) {{
        for (let j = i + 1; j < evidenceItems.length; j++) {{
          const lGeo = new THREE.BufferGeometry().setFromPoints([
            evidenceItems[i].origin,
            evidenceItems[j].origin
          ]);
          const line = new THREE.Line(lGeo, lineMat);
          evidenceRig.add(line);
          connectingTraces.push({{ line, p1: i, p2: j }});
        }}
      }}
    }}

    function createCTScanRig() {{
      const pGeo = new THREE.PlaneGeometry(32, 32);
      const pMat = new THREE.MeshBasicMaterial({{
        color: 0x00E5FF,
        transparent: true,
        opacity: 0.0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      }});
      ctScanPlane = new THREE.Mesh(pGeo, pMat);
      ctScanPlane.rotation.x = Math.PI / 2;
      ctScanPlane.position.y = -10;
      evidenceRig.add(ctScanPlane);
    }}

    function createThreeOrbitalTracks() {{
      const radii = [9.0, 11.2, 13.4];
      const rotations = [
        new THREE.Euler(Math.PI / 3.2, 0, Math.PI / 5),
        new THREE.Euler(-Math.PI / 3.8, Math.PI / 4, 0),
        new THREE.Euler(Math.PI / 5, -Math.PI / 2.8, Math.PI / 3.5)
      ];

      radii.forEach((r, idx) => {{
        const ringGeo = new THREE.TorusGeometry(r, 0.045, 16, isMobile ? 64 : 120);
        const ringMat = new THREE.MeshBasicMaterial({{
          color: 0x00E5FF,
          transparent: true,
          opacity: 0.25,
          blending: THREE.AdditiveBlending
        }});
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.copy(rotations[idx]);
        orbitalRig.add(ring);
      }});
    }}

    function createParticleConvergenceVortex() {{
      const count = isMobile ? 600 : 1500;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const initial = new Float32Array(count * 3);
      const target = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);

      const cCyan = new THREE.Color(0x00E5FF);
      const cTeal = new THREE.Color(0x14B8A6);

      for (let i = 0; i < count; i++) {{
        const r = 7 + Math.random() * 9;
        const theta = Math.random() * Math.PI * 2;
        const phi = (Math.random() - 0.5) * Math.PI;

        const x = r * Math.cos(theta) * Math.cos(phi);
        const y = r * Math.sin(phi);
        const z = r * Math.sin(theta) * Math.cos(phi);

        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        initial[i * 3] = x; initial[i * 3 + 1] = y; initial[i * 3 + 2] = z;

        const hexAngle = (Math.floor(Math.random() * 6) * Math.PI) / 3;
        const hr = 2.4 + Math.random() * 0.3;
        target[i * 3] = hr * Math.cos(hexAngle) + (Math.random() - 0.5) * 0.4;
        target[i * 3 + 1] = (Math.random() - 0.5) * 3.8;
        target[i * 3 + 2] = hr * Math.sin(hexAngle) + (Math.random() - 0.5) * 0.4;

        const lerpColor = cCyan.clone().lerp(cTeal, Math.random());
        colors[i * 3] = lerpColor.r;
        colors[i * 3 + 1] = lerpColor.g;
        colors[i * 3 + 2] = lerpColor.b;
      }}

      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.userData = {{ initial, target }};

      const mat = new THREE.PointsMaterial({{
        size: isMobile ? 0.2 : 0.15,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending
      }});

      particleSystem = new THREE.Points(geo, mat);
      particleRig.add(particleSystem);
    }}

    function createCrystallizedHexagonalCore() {{
      const hexGeo = new THREE.CylinderGeometry(2.7, 2.7, 4.2, 6, 1, false);

      const glassMat = new THREE.MeshPhysicalMaterial({{
        color: 0x11151F,
        emissive: 0x00E5FF,
        emissiveIntensity: 0.3,
        roughness: 0.08,
        metalness: 0.2,
        transmission: 0.88,
        ior: 1.5,
        transparent: true,
        opacity: 0.95
      }});

      centralHexPrism = new THREE.Mesh(hexGeo, glassMat);
      centralHexPrism.scale.set(0.001, 0.001, 0.001);
      centralHexPrism.userData = {{
        name: 'Hexagonal Proof Record',
        type: 'Permanent Proof Record',
        hash: '8c4a92...71ef',
        records: '5 multi-source records',
        status: 'Cryptographically intact'
      }};
      hexCoreRig.add(centralHexPrism);

      const innerGeo = new THREE.CylinderGeometry(2.35, 2.35, 3.8, 6, 4, true);
      const innerMat = new THREE.MeshBasicMaterial({{
        color: 0x00E5FF,
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending
      }});
      innerEvidenceLattice = new THREE.Mesh(innerGeo, innerMat);
      centralHexPrism.add(innerEvidenceLattice);

      const haloGeo = new THREE.TorusGeometry(3.6, 0.06, 16, isMobile ? 48 : 64);
      const haloMat = new THREE.MeshBasicMaterial({{
        color: 0x00E5FF,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      }});
      coreHaloRing = new THREE.Mesh(haloGeo, haloMat);
      coreHaloRing.rotation.x = Math.PI / 2;
      centralHexPrism.add(coreHaloRing);
    }}

    function createChainVerifiedNetwork() {{
      const nodePositions = [
        new THREE.Vector3(-9, 5.5, -2),
        new THREE.Vector3(-13, 0.5, 0),
        new THREE.Vector3(-9, -5.5, -1),
        new THREE.Vector3(0, -6.5, 2),
        new THREE.Vector3(6, -1, 1),
        new THREE.Vector3(11, 5.5, -2),
        new THREE.Vector3(0, 1.5, 3.5)
      ];

      const nodeGeo = new THREE.CylinderGeometry(1.25, 1.25, 1.9, 6, 1, false);

      nodePositions.forEach((pos, idx) => {{
        const nodeMat = new THREE.MeshPhysicalMaterial({{
          color: 0x11151F,
          emissive: 0x10B981,
          emissiveIntensity: 0.55,
          roughness: 0.12,
          metalness: 0.25,
          transparent: true,
          opacity: 0.95
        }});

        const node = new THREE.Mesh(nodeGeo, nodeMat);
        node.position.copy(pos);
        node.scale.set(0.001, 0.001, 0.001);
        node.userData = {{
          nodeIndex: idx + 1,
          name: `Verified Proof Node #${{idx + 1}}`,
          type: 'Connected Chain Node',
          hash: '0x' + (Math.random().toString(16).substr(2, 6) + '...' + Math.random().toString(16).substr(2, 6)).toUpperCase(),
          records: '5 verified attestations',
          status: 'Confirmed & Connected'
        }};

        const edgeLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(nodeGeo),
          new THREE.LineBasicMaterial({{ color: 0x10B981, transparent: true, opacity: 0.85 }})
        );
        node.add(edgeLine);

        chainHexNodes.push(node);
        chainNetRig.add(node);
      }});

      const strandMat = new THREE.LineBasicMaterial({{
        color: 0x14B8A6,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending
      }});

      for (let i = 0; i < nodePositions.length - 1; i++) {{
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          nodePositions[i],
          nodePositions[i + 1]
        ]);
        const strand = new THREE.Line(lineGeo, strandMat);
        strand.scale.set(0.001, 0.001, 0.001);
        chainStrandBeams.push(strand);
        chainNetRig.add(strand);
      }}
    }}

    function updateStoryTimeline(t) {{
      const stageIdx = Math.min(Math.floor(t), 4);
      
      document.querySelectorAll('.stage-rail-item').forEach((dot, i) => {{
        dot.classList.toggle('active', i === stageIdx);
      }});
      
      const stageNames = ['COLLECT', 'CHECK', 'CROSS-CHECK', 'CREATE PROOF', 'CONNECT PROOF'];
      const stageEl = document.getElementById('stage-readout');
      if (stageEl) {{
        stageEl.innerHTML = `STAGE ${{stageIdx + 1}} / 5 &bull; ${{stageNames[stageIdx]}}`;
      }}

      const scrubPercent = (t / 4.0) * 100;
      const fillEl = document.getElementById('scrub-fill');
      const thumbEl = document.getElementById('scrub-thumb');
      if (fillEl) fillEl.style.width = `${{scrubPercent}}%`;
      if (thumbEl) thumbEl.style.left = `${{scrubPercent}}%`;

      if (!renderer || !evidenceMeshes.length) return;

      const s1 = Math.min(Math.max(t, 0.0), 1.0);
      evidenceMeshes.forEach((mesh, idx) => {{
        const item = evidenceItems[idx];
        const driftTarget = new THREE.Vector3(item.origin.x * 0.58, item.origin.y * 0.58, item.origin.z * 0.65);
        mesh.position.lerpVectors(item.origin, driftTarget, s1);
        mesh.scale.setScalar(THREE.MathUtils.lerp(0.8, 1.0, s1));
      }});

      connectingTraces.forEach(tr => {{
        const p1 = evidenceMeshes[tr.p1].position;
        const p2 = evidenceMeshes[tr.p2].position;
        const arr = tr.line.geometry.attributes.position.array;
        arr[0] = p1.x; arr[1] = p1.y; arr[2] = p1.z;
        arr[3] = p2.x; arr[4] = p2.y; arr[5] = p2.z;
        tr.line.geometry.attributes.position.needsUpdate = true;
        tr.line.material.opacity = (1.0 - t * 0.35) * 0.35;
      }});

      const s2 = Math.min(Math.max(t - 1.0, 0.0), 1.0);
      if (t >= 0.8 && t <= 2.2) {{
        evidenceMeshes.forEach((mesh, idx) => {{
          const angle = (idx / evidenceMeshes.length) * Math.PI * 2;
          const carouselPos = new THREE.Vector3(9.5 * Math.cos(angle), 0, 9.5 * Math.sin(angle));
          mesh.position.lerp(carouselPos, s2);
          mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, -angle + Math.PI / 2, s2 * 0.15);
        }});

        ctScanPlane.position.y = THREE.MathUtils.lerp(-8, 8, s2);
        ctScanPlane.material.opacity = Math.sin(s2 * Math.PI) * 0.32;

        ctScanLabels.forEach(sprite => {{
          sprite.material.opacity = Math.sin(s2 * Math.PI) * 0.95;
        }});
      }} else {{
        ctScanPlane.material.opacity = 0;
        ctScanLabels.forEach(sprite => {{ sprite.material.opacity = 0; }});
      }}

      const s3 = Math.min(Math.max(t - 2.0, 0.0), 1.0);
      orbitalRig.children.forEach(ring => {{
        ring.material.opacity = THREE.MathUtils.lerp(0.15, 0.65, Math.sin(s3 * Math.PI));
        ring.rotation.z += 0.008;
      }});

      if (t >= 2.0 && t <= 3.2) {{
        evidenceMeshes.forEach(mesh => {{
          mesh.scale.setScalar(Math.max(1.0 - s3 * 1.25, 0.001));
        }});

        particleSystem.material.opacity = Math.min(s3 * 1.6, 0.95);
        const posAttr = particleSystem.geometry.attributes.position;
        const initPos = particleSystem.geometry.userData.initial;
        const targPos = particleSystem.geometry.userData.target;

        for (let i = 0; i < posAttr.count; i++) {{
          const idx = i * 3;
          posAttr.array[idx] = THREE.MathUtils.lerp(initPos[idx], targPos[idx], s3);
          posAttr.array[idx + 1] = THREE.MathUtils.lerp(initPos[idx + 1], targPos[idx + 1], s3);
          posAttr.array[idx + 2] = THREE.MathUtils.lerp(initPos[idx + 2], targPos[idx + 2], s3);
        }}
        posAttr.needsUpdate = true;
      }} else if (t < 2.0) {{
        particleSystem.material.opacity = 0;
      }}

      const s4 = Math.min(Math.max(t - 3.0, 0.0), 1.0);
      if (t >= 2.8) {{
        const hexScale = Math.min(s4 * 1.15, 1.0);
        centralHexPrism.scale.set(hexScale, hexScale, hexScale);
        centralHexPrism.rotation.y += 0.015;

        let pulseColor = new THREE.Color(0x00E5FF);
        if (s4 < 0.4) {{
          pulseColor.lerp(new THREE.Color(0x67E8F9), s4 / 0.4);
        }} else if (s4 < 0.75) {{
          pulseColor.lerp(new THREE.Color(0x14B8A6), (s4 - 0.4) / 0.35);
        }} else {{
          pulseColor.lerp(new THREE.Color(0x0D9488), (s4 - 0.75) / 0.25);
        }}

        centralHexPrism.material.emissive.copy(pulseColor);
        centralHexPrism.material.emissiveIntensity = 0.35 + Math.sin(s4 * Math.PI) * 0.55;
        coreHaloRing.material.color.copy(pulseColor);
        coreHaloRing.scale.setScalar(1.0 + Math.sin(s4 * Math.PI * 2) * 0.18);
      }} else {{
        centralHexPrism.scale.set(0.001, 0.001, 0.001);
      }}

      const s5 = Math.min(Math.max((t - 3.5) * 2.0, 0.0), 1.0);
      if (t >= 3.4) {{
        const targetZ = isMobile ? 58 : 50;
        const targetY = isMobile ? 8 : 6;
        camera.position.z = THREE.MathUtils.lerp(isMobile ? 46 : 34, targetZ, s5);
        camera.position.y = THREE.MathUtils.lerp(isMobile ? 4 : 2, targetY, s5);

        chainHexNodes.forEach((node, idx) => {{
          const delayScale = Math.min(Math.max(s5 * 1.4 - idx * 0.08, 0.001), 1.0);
          node.scale.set(delayScale, delayScale, delayScale);
          node.rotation.y += 0.012;
        }});

        chainStrandBeams.forEach(strand => {{
          strand.scale.set(s5, s5, s5);
          strand.material.opacity = s5 * 0.85;
        }});

        centralHexPrism.scale.set(1.0 - s5 * 0.3, 1.0 - s5 * 0.3, 1.0 - s5 * 0.3);
      }} else {{
        camera.position.z = isMobile ? 46 : 34;
        camera.position.y = isMobile ? 4 : 2;
        chainHexNodes.forEach(node => node.scale.set(0.001, 0.001, 0.001));
        chainStrandBeams.forEach(strand => strand.scale.set(0.001, 0.001, 0.001));
      }}
    }}

    let clock = new THREE.Clock();
    function animate() {{
      requestAnimationFrame(animate);

      if (!renderer || !scene || !camera) return;

      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();

      if (isPlaying) {{
        timelineProgress += 0.0035;
        if (timelineProgress > 4.0) timelineProgress = 0.0;
        updateStoryTimeline(timelineProgress);
      }}

      parallaxCurrentX += (parallaxTargetX - parallaxCurrentX) * 0.06;
      parallaxCurrentY += (parallaxTargetY - parallaxCurrentY) * 0.06;

      mainRig.rotation.x = manualRotX + parallaxCurrentX;
      mainRig.rotation.y = manualRotY + parallaxCurrentY;

      if (!isReducedMotion) {{
        evidenceRig.position.y = Math.sin(elapsed * 0.8) * 0.25;
        orbitalRig.rotation.y = elapsed * 0.04;
      }}

      renderer.render(scene, camera);
    }}

    function handleWindowResize() {{
      updateCameraForViewport();
      if (renderer) {{
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
      }}
    }}

    function handleMouseMove(e) {{
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (isMouseDown) {{
        const deltaX = e.clientX - prevMouseX;
        const deltaY = e.clientY - prevMouseY;
        manualRotY += deltaX * 0.004;
        manualRotX += deltaY * 0.004;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      }} else {{
        parallaxTargetY = mouse.x * 0.22;
        parallaxTargetX = -mouse.y * 0.18;
      }}

      const hud = document.getElementById('hover-hud');
      if (hud && hud.classList.contains('visible')) {{
        hud.style.left = `${{e.clientX}}px`;
        hud.style.top = `${{e.clientY}}px`;
      }}

      checkHoverRaycast();
    }}

    let touchStartX = 0, touchStartY = 0;
    function handleTouchStart(e) {{
      if (e.touches.length === 1) {{
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }}
    }}

    function handleTouchMove(e) {{
      if (e.touches.length === 1 && !e.target.closest('.story-card') && !e.target.closest('.dock-scrubber')) {{
        const deltaX = e.touches[0].clientX - touchStartX;
        const deltaY = e.touches[0].clientY - touchStartY;
        manualRotY += deltaX * 0.003;
        manualRotX += deltaY * 0.003;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }}
    }}

    function handleTouchEnd() {{
      // Touch ended
    }}

    function handleMouseDown(e) {{
      if (e.target.closest('.story-card') || e.target.closest('.dock-scrubber') || e.target.closest('header') || e.target.closest('#proof-inspector-card')) {{
        return;
      }}
      isMouseDown = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    }}

    function handleMouseUp() {{
      isMouseDown = false;
    }}

    function checkHoverRaycast() {{
      if (!renderer || isMobile) return;
      raycaster.setFromCamera(mouse, camera);
      const hud = document.getElementById('hover-hud');
      if (!hud) return;

      if (timelineProgress < 3.2) {{
        const hits = raycaster.intersectObjects(evidenceRig.children, true);
        if (hits.length > 0) {{
          let topGroup = hits[0].object;
          while (topGroup.parent && topGroup.parent !== evidenceRig) {{
            topGroup = topGroup.parent;
          }}

          if (topGroup.userData && topGroup.userData.name) {{
            const d = topGroup.userData;
            document.getElementById('hud-name').innerText = d.name.toUpperCase();
            document.getElementById('hud-type').innerText = d.type;
            document.getElementById('hud-hash').innerText = d.hash;
            document.getElementById('hud-status').innerText = (timelineProgress < 1.0) ? 'Raw evidence stream' : 'Checking integrity & timestamps';

            hud.classList.add('visible');
            document.body.style.cursor = 'pointer';
            return;
          }}
        }}
      }} else {{
        const hits = raycaster.intersectObjects(chainHexNodes, true);
        if (hits.length > 0) {{
          const node = hits[0].object;
          document.getElementById('hud-name').innerText = `PROOF NODE #${{node.userData.nodeIndex || 1}}`;
          document.getElementById('hud-type').innerText = 'Connected Proof Chain';
          document.getElementById('hud-hash').innerText = node.userData.hash || '0x8C4A...71EF';
          document.getElementById('hud-status').innerText = 'Verified & Connected';

          hud.classList.add('visible');
          document.body.style.cursor = 'pointer';
          return;
        }}
      }}

      hud.classList.remove('visible');
      document.body.style.cursor = 'default';
    }}

    function handleSceneClick(e) {{
      if (e.target.closest('.story-card') || e.target.closest('.dock-scrubber') || e.target.closest('header') || e.target.closest('#proof-inspector-card')) {{
        return;
      }}

      if (!renderer) return;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObjects([...evidenceRig.children, ...chainHexNodes, centralHexPrism], true);

      if (hits.length > 0) {{
        openInspector(hits[0].object);
      }}
    }}

    function openInspector(obj) {{
      let cur = obj;
      while (cur.parent && !cur.userData.name && !cur.userData.nodeIndex && cur !== scene) {{
        cur = cur.parent;
      }}

      const card = document.getElementById('proof-inspector-card');
      if (!card) return;
      const u = cur.userData;

      if (u.name) {{
        document.getElementById('inspector-title').innerText = u.name;
        document.getElementById('insp-source').innerText = `${{u.type}} (${{u.name}})`;
        document.getElementById('insp-hash').innerText = u.fullHash || `${{u.hash}}92da71ef99c15d74`;
        document.getElementById('insp-evidence').innerText = u.records || '5 multi-source records';
      }} else {{
        const idx = u.nodeIndex || 1;
        document.getElementById('inspector-title').innerText = `Verified Proof Node #0${{idx}}`;
        document.getElementById('insp-source').innerText = `ChainVerify Node ${{idx}} (Chain Connection)`;
        document.getElementById('insp-hash').innerText = u.hash || '8c4a92e10ff48b1392da71ef99c15d7426b68019';
        document.getElementById('insp-evidence').innerText = '5 verified attestations';
      }}

      card.classList.add('open');
    }}

    document.getElementById('inspector-close-btn').addEventListener('click', () => {{
      document.getElementById('proof-inspector-card').classList.remove('open');
    }});

    function setupScrollTimeline() {{
      if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return;
      gsap.registerPlugin(ScrollTrigger);

      gsap.to({{ val: 0 }}, {{
        val: 4.0,
        ease: 'none',
        scrollTrigger: {{
          trigger: '.storyline-container',
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.5,
          onUpdate: (self) => {{
            if (!isPlaying) {{
              timelineProgress = self.progress * 4.0;
              updateStoryTimeline(timelineProgress);
            }}
          }}
        }}
      }});
    }}

    function setupUI() {{
      document.querySelectorAll('.stage-rail-item').forEach(item => {{
        item.addEventListener('click', () => {{
          const stage = parseInt(item.getAttribute('data-stage'));
          const target = document.getElementById(`stage-${{stage + 1}}`);
          if (target) target.scrollIntoView({{ behavior: 'smooth' }});
        }});
      }});

      const playBtn = document.getElementById('play-btn');
      playBtn.addEventListener('click', () => {{
        isPlaying = !isPlaying;
        document.getElementById('play-symbol').innerHTML = isPlaying ? '&#10074;&#10074;' : '&#9658;';
      }});

      const rail = document.getElementById('timeline-rail');
      let dragging = false;

      function updateScrub(clientX) {{
        const rect = rail.getBoundingClientRect();
        const clampedX = Math.max(0, Math.min(clientX - rect.left, rect.width));
        const ratio = clampedX / rect.width;
        timelineProgress = ratio * 4.0;
        updateStoryTimeline(timelineProgress);

        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo({{ top: ratio * maxScroll, behavior: 'auto' }});
      }}

      rail.addEventListener('mousedown', (e) => {{
        dragging = true;
        updateScrub(e.clientX);
      }});

      window.addEventListener('mousemove', (e) => {{
        if (dragging) updateScrub(e.clientX);
      }});

      window.addEventListener('mouseup', () => {{
        dragging = false;
      }});

      // Touch scrubber drag support
      rail.addEventListener('touchstart', (e) => {{
        if (e.touches.length > 0) {{
          dragging = true;
          updateScrub(e.touches[0].clientX);
        }}
      }}, {{ passive: true }});

      window.addEventListener('touchmove', (e) => {{
        if (dragging && e.touches.length > 0) {{
          updateScrub(e.touches[0].clientX);
        }}
      }}, {{ passive: true }});

      window.addEventListener('touchend', () => {{
        dragging = false;
      }});

      document.getElementById('btn-reset-view').addEventListener('click', () => {{
        manualRotX = 0;
        manualRotY = 0;
        parallaxTargetX = 0;
        parallaxTargetY = 0;
        updateCameraForViewport();
      }});

      const motionBtn = document.getElementById('btn-motion-toggle');
      motionBtn.addEventListener('click', () => {{
        isReducedMotion = !isReducedMotion;
        document.body.classList.toggle('reduced-motion', isReducedMotion);
        motionBtn.classList.toggle('active', isReducedMotion);
        document.getElementById('motion-btn-text').innerText = isReducedMotion ? 'Motion Off' : 'Motion On';
      }});
    }}

    window.addEventListener('DOMContentLoaded', () => {{
      initThreeScene();
      updateStoryTimeline(0.0);
      setupScrollTimeline();
      setupUI();
      animate();
    }});

  </script>
</body>
</html>
'''

with open(os.path.join(base_dir, 'ChainVerify.html'), 'w', encoding='utf-8') as f:
    f.write(html_content)

with open(os.path.join(base_dir, 'apps', 'web', 'public', 'ChainVerify.html'), 'w', encoding='utf-8') as f:
    f.write(html_content)

print("ChainVerify.html successfully generated with updated marketing copy and responsive mobile architecture!")

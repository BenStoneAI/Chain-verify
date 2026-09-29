import os

site_css_path = r'C:\Users\Work\Desktop\GitHub\Chain Verify\apps\web\src\app\site.css'

with open(site_css_path, 'r', encoding='utf-8') as f:
    css = f.read()

# Replace any lingering tints
css = css.replace('color:#a99cff', 'color:#00e5ff')
css = css.replace('color:#b9afff', 'color:#67e8f9')
css = css.replace('color:#b8adff', 'color:#00e5ff')

# Append Spatial 3D Proof Engine section styles
spatial_css = '''

/* ============================================================
   Spatial 3D Proof Engine Component Styles
   ============================================================ */
.cv-spatial-section {
  width: min(1200px, calc(100% - 32px));
  margin: 80px auto 100px;
  position: relative;
}

.cv-spatial-header {
  text-align: center;
  max-width: 780px;
  margin: 0 auto 36px;
}

.cv-spatial-header h2 {
  font-size: clamp(36px, 4.5vw, 56px);
  line-height: 1.05;
  letter-spacing: -0.04em;
  margin: 14px 0 16px;
  color: #FFFFFF;
}

.cv-spatial-header p {
  color: #8F9DB2;
  font-size: 16px;
  line-height: 1.65;
}

.cv-spatial-wrapper {
  position: relative;
  width: 100%;
  height: 640px;
  border-radius: 24px;
  border: 1px solid rgba(0, 229, 255, 0.28);
  background: radial-gradient(circle at 50% 30%, #11151F 0%, #0A0A0F 100%);
  box-shadow: 0 35px 90px rgba(0, 0, 0, 0.75), 0 0 40px rgba(0, 229, 255, 0.12);
  overflow: hidden;
}

.cv-spatial-canvas-container {
  width: 100%;
  height: 100%;
  cursor: grab;
}

.cv-spatial-canvas-container:active {
  cursor: grabbing;
}

.cv-spatial-stage-overlay {
  position: absolute;
  top: 28px;
  left: 28px;
  max-width: 440px;
  z-index: 10;
  pointer-events: none;
}

.cv-spatial-card {
  pointer-events: auto;
  background: rgba(17, 21, 31, 0.88);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 18px;
  padding: 1.75rem;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85);
  transition: all 0.3s ease;
}

.cv-spatial-card:hover {
  border-color: #00E5FF;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.85), 0 0 25px rgba(0, 229, 255, 0.2);
}

.cv-stage-badge {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  font-weight: 700;
  color: #00E5FF;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 0.65rem;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.cv-spatial-card h3 {
  font-size: 1.35rem;
  font-weight: 800;
  letter-spacing: -0.025em;
  color: #FFFFFF;
  margin-bottom: 0.65rem;
  line-height: 1.25;
}

.cv-spatial-card p {
  color: #8F9DB2;
  font-size: 0.88rem;
  line-height: 1.6;
  margin-bottom: 0.5rem;
}

.cv-spatial-card p:last-of-type {
  margin-bottom: 1.1rem;
}

.cv-stage-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.cv-data-pill {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  padding: 0.32rem 0.6rem;
  background: rgba(23, 29, 41, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: #CBD5E1;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.cv-pill-scan {
  border-color: rgba(0, 229, 255, 0.4);
  color: #67E8F9;
  background: rgba(0, 229, 255, 0.1);
}

.cv-pill-success, .cv-pill-sealed {
  border-color: rgba(16, 185, 129, 0.45);
  color: #6EE7B7;
  background: rgba(16, 185, 129, 0.14);
}

.cv-spatial-dock {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 1.15rem;
  background: rgba(17, 21, 31, 0.92);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border: 1px solid rgba(0, 229, 255, 0.3);
  border-radius: 9999px;
  padding: 0.6rem 1.4rem;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 229, 255, 0.12);
  max-width: 94%;
}

.cv-dock-btn {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: rgba(0, 229, 255, 0.12);
  border: 1px solid rgba(0, 229, 255, 0.35);
  color: #00E5FF;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.82rem;
  transition: all 0.2s ease;
}

.cv-dock-btn:hover {
  background: rgba(0, 229, 255, 0.28);
  transform: scale(1.08);
}

.cv-dock-timeline {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.cv-dock-counter {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #8F9DB2;
  font-weight: 600;
  white-space: nowrap;
}

.cv-dock-stage-nav {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.cv-stage-dot-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.cv-dot-marker {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #1E293B;
  border: 1px solid rgba(255, 255, 255, 0.15);
  transition: all 0.25s ease;
}

.cv-dot-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  color: #657287;
  transition: color 0.25s ease;
}

.cv-stage-dot-btn.active .cv-dot-marker {
  background: #00E5FF;
  border-color: #FFFFFF;
  box-shadow: 0 0 10px #00E5FF;
  transform: scale(1.3);
}

.cv-stage-dot-btn.active .cv-dot-label {
  color: #00E5FF;
  font-weight: 700;
}

.cv-dock-actions {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.cv-dock-chip {
  background: rgba(23, 29, 41, 0.85);
  border: 1px solid rgba(157, 170, 197, 0.18);
  color: #8F9DB2;
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.4rem 0.85rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.cv-dock-chip:hover {
  border-color: rgba(0, 229, 255, 0.4);
  color: #FFFFFF;
}

.cv-dock-chip.active {
  border-color: #00E5FF;
  color: #00E5FF;
  background: rgba(0, 229, 255, 0.12);
}

.cv-dock-cta {
  background: linear-gradient(135deg, #00E5FF 0%, #14B8A6 55%, #0D9488 100%);
  color: #0A0A0F;
  border: none;
  font-family: 'Inter', sans-serif;
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.42rem 0.95rem;
  border-radius: 8px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
  box-shadow: 0 6px 18px rgba(0, 229, 255, 0.3);
  transition: all 0.2s ease;
}

.cv-dock-cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 24px rgba(0, 229, 255, 0.5);
}

@media (max-width: 768px) {
  .cv-spatial-wrapper {
    height: 720px;
  }
  .cv-spatial-stage-overlay {
    top: auto;
    bottom: 80px;
    left: 14px;
    right: 14px;
    max-width: 100%;
  }
  .cv-spatial-card {
    padding: 1.25rem;
  }
  .cv-spatial-card h3 {
    font-size: 1.15rem;
  }
  .cv-spatial-card p {
    font-size: 0.82rem;
  }
  .cv-spatial-dock {
    bottom: 12px;
    padding: 0.45rem 0.75rem;
    gap: 0.5rem;
    width: calc(100% - 24px);
    justify-content: space-between;
  }
  .cv-dock-actions {
    display: none;
  }
}
'''

with open(site_css_path, 'w', encoding='utf-8') as f:
    f.write(css + spatial_css)

print("Updated site.css with SpatialProofHorizon styles!")

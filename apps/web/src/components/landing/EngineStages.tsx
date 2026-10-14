'use client';

import { useState } from 'react';

import { engineStages } from './engineStageData';
import { useTabKeyNav } from './useTabKeyNav';

const ID_PREFIX = 'lp-stage';

export function EngineStages() {
  const [active, setActive] = useState(0);
  const onKeyDown = useTabKeyNav(engineStages.length, setActive, ID_PREFIX);
  const stage = engineStages[active];

  return (
    <div className="lp-engine">
      <div className="lp-engine-toolbar">
        <div className="lp-stage-tabs" role="tablist" aria-label="Proof pipeline stages">
          {engineStages.map((item, index) => (
            <button
              key={item.tabLabel}
              id={`${ID_PREFIX}-tab-${index}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              aria-controls={`${ID_PREFIX}-panel`}
              tabIndex={index === active ? 0 : -1}
              className={'lp-stage-tab' + (index === active ? ' is-active' : '')}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.tabLabel}
            </button>
          ))}
        </div>
        <span className="lp-mono-badge lp-mono-badge--flush"><i aria-hidden="true" />3D PROOF PIPELINE</span>
      </div>

      <div
        id={`${ID_PREFIX}-panel`}
        role="tabpanel"
        aria-labelledby={`${ID_PREFIX}-tab-${active}`}
        className="lp-engine-grid"
      >
        <div className="lp-engine-info" aria-live="polite">
          <div className="lp-mono-badge">{stage.tag}</div>
          <h3>{stage.title}</h3>
          <p>{stage.desc}</p>
          <dl className="lp-proof-rows">
            <div className="lp-proof-row"><dt>Verification State</dt><dd>{stage.metric}</dd></div>
          </dl>
        </div>

        <div className="lp-engine-frame">
          <img
            src="/assets/proof-engine-pipeline.png"
            alt="ChainVerify 3D verification pipeline: evidence flowing through checks into a sealed proof record"
            className="lp-engine-img"
            width={1024}
            height={576}
            loading="lazy"
            decoding="async"
          />
          <div className="lp-engine-hud" aria-hidden="true">
            <span>{stage.hudStage}</span>
            <span className="lp-hud-status">{stage.hudStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

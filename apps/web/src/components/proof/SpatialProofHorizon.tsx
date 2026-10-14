'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

interface EvidenceItem {
  id: string;
  name: string;
  type: string;
  hash: string;
  fullHash: string;
  records: string;
  origin: THREE.Vector3;
}

const STAGES = [
  {
    badge: 'STAGE 01 · COLLECT THE EVIDENCE',
    title: 'Bring Everything Together',
    body1: 'ChainVerify gathers the evidence that matters before anything is verified — invoices, browser activity, system data, webhooks, and other records.',
    body2: 'Each item is captured with information about where it came from and when it was created, creating a reliable starting point for verification.',
    pills: ['invoices', 'browser activity', 'system data', 'webhooks', 'fiscal records'],
    pillClass: 'cv-pill-cyan',
    name: 'COLLECT',
  },
  {
    badge: 'STAGE 02 · CHECK THE EVIDENCE',
    title: 'Inspect Every Detail',
    body1: "ChainVerify examines each piece of evidence to confirm that it is authentic and hasn't been changed.",
    body2: 'It checks things like digital fingerprints, signatures, timestamps, and source information before allowing the evidence to move forward.',
    pills: ['DIGITAL FINGERPRINTS', 'SIGNATURES', 'TIMESTAMPS', 'SOURCE PROVENANCE'],
    pillClass: 'cv-pill-scan',
    name: 'CHECK',
  },
  {
    badge: 'STAGE 03 · CROSS-CHECK THE RESULTS',
    title: 'Verify It From Multiple Sources',
    body1: "ChainVerify doesn't rely on a single check.",
    body2: 'It compares evidence across different systems — such as AI activity, invoices and accounting records, browser evidence, and audit records — to make sure the information agrees. Those independent checks come together to create one trusted result.',
    pills: ['Software Delivery · Agent Gate', 'Invoices · InvoiceProof', 'Audit Records · AuditProof', 'Browser Evidence'],
    pillClass: 'cv-pill-cyan',
    name: 'CROSS-CHECK',
  },
  {
    badge: 'STAGE 04 · CREATE THE PROOF',
    title: 'Turn Evidence Into Verifiable Proof',
    body1: 'Once the evidence checks out, ChainVerify combines it into a permanent proof record.',
    body2: 'The proof contains the information needed to show what was verified, where the evidence came from, and that it has not been altered.',
    pills: ['✓ PROOF RECORD CREATED', '✓ UNALTERED MERKLE ROOT', '✓ EVIDENCE ANCHORED'],
    pillClass: 'cv-pill-success',
    name: 'CREATE PROOF',
  },
  {
    badge: 'STAGE 05 · CONNECT THE PROOF',
    title: 'Build a Trusted Chain of Evidence',
    body1: 'Each verified proof becomes part of a connected record that can be checked again later.',
    body2: 'That gives businesses, auditors, applications, and AI agents a clear way to answer: What happened? Where did the evidence come from? Was it verified? Can we prove it?',
    pills: ['TRUSTED CHAIN OF EVIDENCE · SEALED'],
    pillClass: 'cv-pill-sealed',
    name: 'CONNECT PROOF',
  },
];

export function SpatialProofHorizon() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [activeStage, setActiveStage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorData, setInspectorData] = useState<{
    title: string;
    source: string;
    hash: string;
    evidence: string;
    status: string;
  } | null>(null);

  const timelineProgressRef = useRef(0.0);
  const isPlayingRef = useRef(true);
  const motionEnabledRef = useRef(true);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    motionEnabledRef.current = motionEnabled;
  }, [motionEnabled]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let renderer: THREE.WebGLRenderer;
    let mainRig: THREE.Group;
    let evidenceRig: THREE.Group;
    let orbitalRig: THREE.Group;
    let particleRig: THREE.Group;
    let hexCoreRig: THREE.Group;
    let chainNetRig: THREE.Group;
    let ctScanPlane: THREE.Mesh;
    let particleSystem: THREE.Points;
    let centralHexPrism: THREE.Mesh;
    let coreHaloRing: THREE.Mesh;
    const chainHexNodes: THREE.Mesh[] = [];
    const chainStrandBeams: THREE.Line[] = [];
    const evidenceMeshes: THREE.Group[] = [];
    const connectingTraces: { line: THREE.Line; p1: number; p2: number }[] = [];
    const ctScanLabels: THREE.Sprite[] = [];

    let animationFrameId: number;
    let isMouseDown = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    let manualRotX = 0;
    let manualRotY = 0;
    let parallaxTargetX = 0;
    let parallaxTargetY = 0;
    let parallaxCurrentX = 0;
    let parallaxCurrentY = 0;

    const evidenceItems: EvidenceItem[] = [
      { id: 'invoice', name: 'invoice.pdf', type: 'AP Ledger', hash: '8c4a92...71ef', fullHash: '8c4a92e10ff48b1392da71ef99c15d7426b68019', records: '5 invoice line items', origin: new THREE.Vector3(-14, 7, 10) },
      { id: 'browser', name: 'browser.capture', type: 'DOM State', hash: '3f71c4...9a02', fullHash: '3f71c48bb019e4811a2f9a027c9940188bb3d211', records: '14 DOM state nodes', origin: new THREE.Vector3(15, 8, 8) },
      { id: 'audit', name: 'audit.json', type: 'Telemetry Trail', hash: 'e201b8...54df', fullHash: 'e201b8f54128dd71923054df61280a8274f9911e', records: '48 ledger entries', origin: new THREE.Vector3(-12, -7, 11) },
      { id: 'receipt', name: 'receipt.png', type: 'Fiscal Slip', hash: '9b33a1...c014', fullHash: '9b33a18e001923485764c0142b78119001ee5a66', records: '1 fiscal slip', origin: new THREE.Vector3(14, -8, 6) },
      { id: 'api', name: 'api.event', type: 'Signed Webhook', hash: 'a104f7...38e9', fullHash: 'a104f71882001955374838e9fa0142948c2018ea', records: '1 signed webhook event', origin: new THREE.Vector3(0, 13, 13) }
    ];

    function generateDocumentTexture(spec: EvidenceItem) {
      const cvs = document.createElement('canvas');
      cvs.width = 512;
      cvs.height = 640;
      const ctx = cvs.getContext('2d');
      if (!ctx) return new THREE.Texture();

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

      ctx.fillStyle = '#0A0A0F';
      ctx.fillRect(40, 520, 432, 75);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 520, 432, 75);

      ctx.fillStyle = '#00E5FF';
      ctx.font = '15px "JetBrains Mono", monospace';
      ctx.fillText('SHA-256: ' + spec.hash, 55, 552);

      const texture = new THREE.CanvasTexture(cvs);
      return texture;
    }

    function generateCTLabel(text: string) {
      const cvs = document.createElement('canvas');
      cvs.width = 256;
      cvs.height = 70;
      const ctx = cvs.getContext('2d');
      if (!ctx) return new THREE.Sprite();

      ctx.fillStyle = 'rgba(10, 10, 15, 0.9)';
      ctx.strokeStyle = '#00E5FF';
      ctx.lineWidth = 3;
      ctx.rect(4, 4, 248, 62);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00E5FF';
      ctx.font = 'bold 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 128, 35);

      const texture = new THREE.CanvasTexture(cvs);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0 });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(3.2, 0.85, 1);
      return sprite;
    }

    try {
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0a0a0f);
      scene.fog = new THREE.FogExp2(0x0a0a0f, 0.02);

      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || 650;

      camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      camera.position.set(0, 2, 34);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      container.appendChild(renderer.domElement);

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

      const ambLight = new THREE.AmbientLight(0x11151f, 1.6);
      scene.add(ambLight);

      const keyLight = new THREE.DirectionalLight(0x00e5ff, 1.8);
      keyLight.position.set(20, 30, 25);
      scene.add(keyLight);

      const tealRim = new THREE.DirectionalLight(0x14b8a6, 1.4);
      tealRim.position.set(-25, -15, -20);
      scene.add(tealRim);

      const coreGlow = new THREE.PointLight(0x00e5ff, 2.5, 45);
      coreGlow.position.set(0, 0, 0);
      scene.add(coreGlow);

      // Create evidence objects
      const geo = new THREE.PlaneGeometry(3.4, 4.25);
      const backGeo = new THREE.PlaneGeometry(3.4, 4.25);
      backGeo.rotateY(Math.PI);
      const scanLabels = ['PROVENANCE', 'INTEGRITY', 'TIMESTAMPS', 'FINGERPRINTS', 'ORIGIN'];

      evidenceItems.forEach((spec, i) => {
        const itemGroup = new THREE.Group();
        itemGroup.userData = spec;
        const tex = generateDocumentTexture(spec);
        const frontMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, opacity: 0.94, roughness: 0.3, metalness: 0.1 });
        const frontMesh = new THREE.Mesh(geo, frontMat);
        const backMat = new THREE.MeshStandardMaterial({ color: 0x11151f, roughness: 0.6, metalness: 0.2 });
        const backMesh = new THREE.Mesh(backGeo, backMat);
        const edges = new THREE.EdgesGeometry(geo);
        const rim = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.45 }));

        itemGroup.add(frontMesh);
        itemGroup.add(backMesh);
        itemGroup.add(rim);

        const sprite = generateCTLabel(scanLabels[i]);
        sprite.position.set(0, 2.7, 0);
        itemGroup.add(sprite);
        ctScanLabels.push(sprite);

        itemGroup.position.copy(spec.origin);
        evidenceRig.add(itemGroup);
        evidenceMeshes.push(itemGroup);
      });

      // Connecting Traces
      const lineMat = new THREE.LineBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending });
      for (let i = 0; i < evidenceItems.length; i++) {
        for (let j = i + 1; j < evidenceItems.length; j++) {
          const lGeo = new THREE.BufferGeometry().setFromPoints([evidenceItems[i].origin, evidenceItems[j].origin]);
          const line = new THREE.Line(lGeo, lineMat);
          evidenceRig.add(line);
          connectingTraces.push({ line, p1: i, p2: j });
        }
      }

      // CT Scan Rig
      const pGeo = new THREE.PlaneGeometry(32, 32);
      const pMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      ctScanPlane = new THREE.Mesh(pGeo, pMat);
      ctScanPlane.rotation.x = Math.PI / 2;
      ctScanPlane.position.y = -10;
      evidenceRig.add(ctScanPlane);

      // Orbital Tracks
      const radii = [9.0, 11.2, 13.4];
      const rotations = [
        new THREE.Euler(Math.PI / 3.2, 0, Math.PI / 5),
        new THREE.Euler(-Math.PI / 3.8, Math.PI / 4, 0),
        new THREE.Euler(Math.PI / 5, -Math.PI / 2.8, Math.PI / 3.5)
      ];
      radii.forEach((r, idx) => {
        const ringGeo = new THREE.TorusGeometry(r, 0.045, 16, 90);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.copy(rotations[idx]);
        orbitalRig.add(ring);
      });

      // Particle Vortex
      const count = 1000;
      const pGeoBuf = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const initial = new Float32Array(count * 3);
      const target = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const cCyan = new THREE.Color(0x00e5ff);
      const cTeal = new THREE.Color(0x14b8a6);

      for (let i = 0; i < count; i++) {
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
      }
      pGeoBuf.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      pGeoBuf.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      pGeoBuf.userData = { initial, target };

      const ptMat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
      particleSystem = new THREE.Points(pGeoBuf, ptMat);
      particleRig.add(particleSystem);

      // Crystallized Hexagonal Core
      const hexGeo = new THREE.CylinderGeometry(2.7, 2.7, 4.2, 6, 1, false);
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x11151f,
        emissive: 0x00e5ff,
        emissiveIntensity: 0.3,
        roughness: 0.08,
        metalness: 0.2,
        transmission: 0.88,
        ior: 1.5,
        transparent: true,
        opacity: 0.95
      });
      centralHexPrism = new THREE.Mesh(hexGeo, glassMat);
      centralHexPrism.scale.set(0.001, 0.001, 0.001);
      hexCoreRig.add(centralHexPrism);

      const haloGeo = new THREE.TorusGeometry(3.6, 0.06, 16, 64);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending });
      coreHaloRing = new THREE.Mesh(haloGeo, haloMat);
      coreHaloRing.rotation.x = Math.PI / 2;
      centralHexPrism.add(coreHaloRing);

      // Chain Network
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
      nodePositions.forEach((posVec, idx) => {
        const nodeMat = new THREE.MeshPhysicalMaterial({
          color: 0x11151f,
          emissive: 0x10b981,
          emissiveIntensity: 0.55,
          roughness: 0.12,
          metalness: 0.25,
          transparent: true,
          opacity: 0.95
        });
        const node = new THREE.Mesh(nodeGeo, nodeMat);
        node.position.copy(posVec);
        node.scale.set(0.001, 0.001, 0.001);
        const edgeLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(nodeGeo),
          new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 })
        );
        node.add(edgeLine);
        chainHexNodes.push(node);
        chainNetRig.add(node);
      });

      const strandMat = new THREE.LineBasicMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending });
      for (let i = 0; i < nodePositions.length - 1; i++) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([nodePositions[i], nodePositions[i + 1]]);
        const strand = new THREE.Line(lineGeo, strandMat);
        strand.scale.set(0.001, 0.001, 0.001);
        chainStrandBeams.push(strand);
        chainNetRig.add(strand);
      }

      function updateTimeline(t: number) {
        const stageIdx = Math.min(Math.floor(t), 4);
        setActiveStage(stageIdx);

        const s1 = Math.min(Math.max(t, 0.0), 1.0);
        evidenceMeshes.forEach((mesh, idx) => {
          const item = evidenceItems[idx];
          const driftTarget = new THREE.Vector3(item.origin.x * 0.58, item.origin.y * 0.58, item.origin.z * 0.65);
          mesh.position.lerpVectors(item.origin, driftTarget, s1);
          mesh.scale.setScalar(THREE.MathUtils.lerp(0.8, 1.0, s1));
        });

        connectingTraces.forEach(tr => {
          const p1 = evidenceMeshes[tr.p1].position;
          const p2 = evidenceMeshes[tr.p2].position;
          const arr = (tr.line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
          arr[0] = p1.x; arr[1] = p1.y; arr[2] = p1.z;
          arr[3] = p2.x; arr[4] = p2.y; arr[5] = p2.z;
          tr.line.geometry.attributes.position.needsUpdate = true;
          (tr.line.material as THREE.LineBasicMaterial).opacity = (1.0 - t * 0.35) * 0.35;
        });

        const s2 = Math.min(Math.max(t - 1.0, 0.0), 1.0);
        if (t >= 0.8 && t <= 2.2) {
          evidenceMeshes.forEach((mesh, idx) => {
            const angle = (idx / evidenceMeshes.length) * Math.PI * 2;
            const carouselPos = new THREE.Vector3(9.5 * Math.cos(angle), 0, 9.5 * Math.sin(angle));
            mesh.position.lerp(carouselPos, s2);
            mesh.rotation.y = THREE.MathUtils.lerp(mesh.rotation.y, -angle + Math.PI / 2, s2 * 0.15);
          });
          ctScanPlane.position.y = THREE.MathUtils.lerp(-8, 8, s2);
          (ctScanPlane.material as THREE.MeshBasicMaterial).opacity = Math.sin(s2 * Math.PI) * 0.32;
          ctScanLabels.forEach(sprite => {
            sprite.material.opacity = Math.sin(s2 * Math.PI) * 0.95;
          });
        } else {
          (ctScanPlane.material as THREE.MeshBasicMaterial).opacity = 0;
          ctScanLabels.forEach(sprite => { sprite.material.opacity = 0; });
        }

        const s3 = Math.min(Math.max(t - 2.0, 0.0), 1.0);
        orbitalRig.children.forEach(ring => {
          ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp(0.15, 0.65, Math.sin(s3 * Math.PI));
          ring.rotation.z += 0.008;
        });

        if (t >= 2.0 && t <= 3.2) {
          evidenceMeshes.forEach(mesh => {
            mesh.scale.setScalar(Math.max(1.0 - s3 * 1.25, 0.001));
          });
          (particleSystem.material as THREE.PointsMaterial).opacity = Math.min(s3 * 1.6, 0.95);
          const posAttr = particleSystem.geometry.attributes.position as THREE.BufferAttribute;
          const initPos = particleSystem.geometry.userData.initial;
          const targPos = particleSystem.geometry.userData.target;

          for (let i = 0; i < posAttr.count; i++) {
            const idx = i * 3;
            (posAttr.array as Float32Array)[idx] = THREE.MathUtils.lerp(initPos[idx], targPos[idx], s3);
            (posAttr.array as Float32Array)[idx + 1] = THREE.MathUtils.lerp(initPos[idx + 1], targPos[idx + 1], s3);
            (posAttr.array as Float32Array)[idx + 2] = THREE.MathUtils.lerp(initPos[idx + 2], targPos[idx + 2], s3);
          }
          posAttr.needsUpdate = true;
        } else if (t < 2.0) {
          (particleSystem.material as THREE.PointsMaterial).opacity = 0;
        }

        const s4 = Math.min(Math.max(t - 3.0, 0.0), 1.0);
        if (t >= 2.8) {
          const hexScale = Math.min(s4 * 1.15, 1.0);
          centralHexPrism.scale.set(hexScale, hexScale, hexScale);
          centralHexPrism.rotation.y += 0.015;

          const pulseColor = new THREE.Color(0x00e5ff);
          if (s4 < 0.4) {
            pulseColor.lerp(new THREE.Color(0x67e8f9), s4 / 0.4);
          } else if (s4 < 0.75) {
            pulseColor.lerp(new THREE.Color(0x14b8a6), (s4 - 0.4) / 0.35);
          } else {
            pulseColor.lerp(new THREE.Color(0x0d9488), (s4 - 0.75) / 0.25);
          }

          (centralHexPrism.material as THREE.MeshPhysicalMaterial).emissive.copy(pulseColor);
          (coreHaloRing.material as THREE.MeshBasicMaterial).color.copy(pulseColor);
        } else {
          centralHexPrism.scale.set(0.001, 0.001, 0.001);
        }

        const s5 = Math.min(Math.max((t - 3.5) * 2.0, 0.0), 1.0);
        if (t >= 3.4) {
          camera.position.z = THREE.MathUtils.lerp(34, 50, s5);
          camera.position.y = THREE.MathUtils.lerp(2, 6, s5);

          chainHexNodes.forEach((node, idx) => {
            const delayScale = Math.min(Math.max(s5 * 1.4 - idx * 0.08, 0.001), 1.0);
            node.scale.set(delayScale, delayScale, delayScale);
            node.rotation.y += 0.012;
          });

          chainStrandBeams.forEach(strand => {
            strand.scale.set(s5, s5, s5);
            (strand.material as THREE.LineBasicMaterial).opacity = s5 * 0.85;
          });
        } else {
          camera.position.z = 34;
          camera.position.y = 2;
          chainHexNodes.forEach(node => node.scale.set(0.001, 0.001, 0.001));
          chainStrandBeams.forEach(strand => strand.scale.set(0.001, 0.001, 0.001));
        }
      }

      const clock = new THREE.Clock();
      function animate() {
        animationFrameId = requestAnimationFrame(animate);
        const elapsed = clock.getElapsedTime();

        if (isPlayingRef.current) {
          timelineProgressRef.current += 0.0035;
          if (timelineProgressRef.current > 4.0) timelineProgressRef.current = 0.0;
          updateTimeline(timelineProgressRef.current);
        }

        parallaxCurrentX += (parallaxTargetX - parallaxCurrentX) * 0.06;
        parallaxCurrentY += (parallaxTargetY - parallaxCurrentY) * 0.06;

        mainRig.rotation.x = manualRotX + parallaxCurrentX;
        mainRig.rotation.y = manualRotY + parallaxCurrentY;

        if (motionEnabledRef.current) {
          evidenceRig.position.y = Math.sin(elapsed * 0.8) * 0.25;
          orbitalRig.rotation.y = elapsed * 0.04;
        }

        renderer.render(scene, camera);
      }

      function handleResize() {
        if (!container || !camera || !renderer) return;
        const w = container.clientWidth || window.innerWidth;
        const h = container.clientHeight || 650;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }

      function handleMouseMove(e: MouseEvent) {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        if (isMouseDown) {
          const deltaX = e.clientX - prevMouseX;
          const deltaY = e.clientY - prevMouseY;
          manualRotY += deltaX * 0.004;
          manualRotX += deltaY * 0.004;
          prevMouseX = e.clientX;
          prevMouseY = e.clientY;
        } else {
          parallaxTargetY = mx * 0.22;
          parallaxTargetX = -my * 0.18;
        }
      }

      function handleMouseDown(e: MouseEvent) {
        if ((e.target as HTMLElement).closest('.cv-no-drag')) return;
        isMouseDown = true;
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      }

      function handleMouseUp() {
        isMouseDown = false;
      }

      window.addEventListener('resize', handleResize);
      container.addEventListener('mousemove', handleMouseMove);
      container.addEventListener('mousedown', handleMouseDown);
      window.addEventListener('mouseup', handleMouseUp);

      updateTimeline(0.0);
      animate();

      return () => {
        window.removeEventListener('resize', handleResize);
        container.removeEventListener('mousemove', handleMouseMove);
        container.removeEventListener('mousedown', handleMouseDown);
        window.removeEventListener('mouseup', handleMouseUp);
        cancelAnimationFrame(animationFrameId);
        if (renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        renderer.dispose();
      };
    } catch (err) {
      console.warn('WebGL init error:', err);
    }
  }, []);

  function handleStageSelect(index: number) {
    timelineProgressRef.current = index;
    setActiveStage(index);
  }

  function handleResetView() {
    timelineProgressRef.current = 0;
    setActiveStage(0);
  }

  return (
    <section className="cv-spatial-section" id="proof-pipeline" aria-label="3D Verification Pipeline">
      <div className="cv-spatial-header">
        <div className="cv-kicker"><i />LIVE 3D VERIFICATION ENGINE</div>
        <h2>Turn Evidence Into Verifiable Proof</h2>
        <p>
          Interact with the live cryptographic pipeline. Drag the horizon, scrub the stages, or click on any verification node to inspect its immutable proof record.
        </p>
      </div>

      <div className="cv-spatial-wrapper">
        {/* WebGL 3D Canvas Canvas Mount */}
        <div ref={mountRef} className="cv-spatial-canvas-container" />

        {/* Floating Active Stage Card */}
        <div className="cv-spatial-stage-overlay cv-no-drag">
          <div className="cv-spatial-card">
            <div className="cv-stage-badge">{STAGES[activeStage].badge}</div>
            <h3>{STAGES[activeStage].title}</h3>
            <p>{STAGES[activeStage].body1}</p>
            <p>{STAGES[activeStage].body2}</p>
            <div className="cv-stage-pills">
              {STAGES[activeStage].pills.map((pill, i) => (
                <span key={i} className={`cv-data-pill ${STAGES[activeStage].pillClass}`}>
                  {pill}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Bottom Interactive Control Dock */}
        <div className="cv-spatial-dock cv-no-drag">
          <button
            type="button"
            className="cv-dock-btn"
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause animation' : 'Play animation'}
            aria-label={isPlaying ? 'Pause animation' : 'Play animation'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>

          <div className="cv-dock-timeline">
            <span className="cv-dock-counter">
              STAGE {activeStage + 1} / 5 · {STAGES[activeStage].name}
            </span>
            <div className="cv-dock-stage-nav">
              {STAGES.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleStageSelect(idx)}
                  className={`cv-stage-dot-btn ${activeStage === idx ? 'active' : ''}`}
                  title={s.title}
                >
                  <span className="cv-dot-marker" />
                  <span className="cv-dot-label">0{idx + 1}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="cv-dock-actions">
            <button
              type="button"
              className={`cv-dock-chip ${motionEnabled ? 'active' : ''}`}
              onClick={() => setMotionEnabled(!motionEnabled)}
              title="Toggle ambient motion"
            >
              Motion {motionEnabled ? 'On' : 'Off'}
            </button>
            <button
              type="button"
              className="cv-dock-chip"
              onClick={handleResetView}
              title="Reset 3D camera"
            >
              Reset View
            </button>
            <a href="/ChainVerify-3D.html" className="cv-dock-cta" target="_blank" rel="noopener noreferrer">
              Immersive 3D View ↗
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X } from "lucide-react";
import type { ProjectItem } from "@/lib/types";
import { num } from "@/lib/calc";

type Props = {
  items: ProjectItem[];
  title: string;
  onClose: () => void;
};

export default function Viewer3D({ items, title, onClose }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#ECE8DF");
    scene.fog = new THREE.Fog("#ECE8DF", 14, 34);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff2dd, 1.6);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -10;
    key.shadow.camera.right = 10;
    key.shadow.camera.top = 10;
    key.shadow.camera.bottom = -10;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd8e4ff, 0.5);
    fill.position.set(-6, 4, -4);
    scene.add(fill);

    const floorGeo = new THREE.PlaneGeometry(60, 60);
    const floorMat = new THREE.MeshStandardMaterial({ color: "#D9D3C4", roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(60, 60, 0xc4bca8, 0xc4bca8);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.001;
    scene.add(grid);

    const disposables: Array<{ dispose: () => void }> = [floorGeo, floorMat];
    const gap = 0.5;
    let cursor = 0;
    const boxes: THREE.Mesh[] = [];
    const list = items.length ? items : [];

    for (const item of list) {
      const w = Math.max(0.15, num(item.width) / 1000 || 0.8);
      const h = Math.max(0.15, num(item.height) / 1000 || 0.8);
      const d = Math.max(0.15, num(item.depth) / 1000 || 0.5);
      const geo = new THREE.BoxGeometry(w, h, d);
      const mat = new THREE.MeshStandardMaterial({ color: item.color || "#B67F2E", roughness: 0.55, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.position.set(cursor + w / 2, h / 2, 0);
      scene.add(mesh);
      const edges = new THREE.EdgesGeometry(geo);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x1e1b16, transparent: true, opacity: 0.35 });
      const line = new THREE.LineSegments(edges, lineMat);
      line.position.copy(mesh.position);
      scene.add(line);
      disposables.push(geo, mat, edges, lineMat);
      boxes.push(mesh);
      cursor += w + gap;
    }

    const totalW = Math.max(1.5, cursor - gap);
    const center = new THREE.Vector3(totalW / 2, 0.7, 0);
    const dist = Math.max(3.5, totalW * 1.15);
    camera.position.set(center.x + dist * 0.75, dist * 0.62, dist * 0.95);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2.02;
    controls.minDistance = 1.2;
    controls.maxDistance = 30;

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);
    animate();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [items]);

  return (
    <div className="fixed inset-0 z-[90] bg-ink/60 flex items-center justify-center p-3 sm:p-8">
      <div className="card shadow-lift w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden fade-up">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <div className="font-display text-lg leading-tight">3D-превью · {title}</div>
            <div className="text-xs text-dim">Вращение — левая кнопка мыши · масштаб — колесо · перемещение — правая кнопка</div>
          </div>
          <button className="p-2 rounded-lg hover:bg-line/50 transition-colors" onClick={onClose} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>
        <div ref={mountRef} className="flex-1 min-h-0" />
        <div className="px-5 py-3 border-t border-line flex flex-wrap gap-x-5 gap-y-1.5">
          {items.map((item) => (
            <span key={item.id} className="inline-flex items-center gap-2 text-xs text-dim">
              <span className="w-3 h-3 rounded-sm border border-ink/20" style={{ background: item.color }} />
              {item.name}
              <span className="num">{[item.width, item.height, item.depth].map((v) => Math.round(num(v)) || "—").join("×")} мм</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

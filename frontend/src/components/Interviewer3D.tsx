import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { InterviewerAvatarId } from "@/lib/interviewer-avatar";

type Props = {
  state: "idle" | "listening" | "speaking";
  reducedMotion: boolean;
  avatarId: InterviewerAvatarId;
  onFailure: () => void;
};

const clothingColors: Record<InterviewerAvatarId, number> = {
  classic: 0x655a83,
  sage: 0x426b64,
  rose: 0x9a526b,
};

/** A small procedural interviewer. It has no camera, network, or session-state access. */
export function Interviewer3D({ state, reducedMotion, avatarId, onFailure }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      onFailure();
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.2);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x554477, 2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(-3, 4, 5);
    scene.add(keyLight);

    const group = new THREE.Group();
    scene.add(group);
    const material = (color: number, roughness = 0.68) =>
      new THREE.MeshStandardMaterial({ color, roughness });
    const add = (
      geometry: THREE.BufferGeometry,
      color: number,
      x: number,
      y: number,
      z: number,
    ) => {
      const mesh = new THREE.Mesh(geometry, material(color));
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };

    add(new THREE.SphereGeometry(1.13, 40, 32), 0xd9a982, 0, 0.2, 0);
    add(
      new THREE.SphereGeometry(1.18, 40, 18, 0, Math.PI * 2, 0, Math.PI * 0.47),
      0x302846,
      0,
      0.63,
      0.02,
    );
    add(new THREE.SphereGeometry(0.22, 24, 20), 0xd9a982, -1.1, 0.18, 0);
    add(new THREE.SphereGeometry(0.22, 24, 20), 0xd9a982, 1.1, 0.18, 0);
    add(new THREE.SphereGeometry(0.085, 20, 16), 0x302846, -0.4, 0.35, 0.99);
    add(new THREE.SphereGeometry(0.085, 20, 16), 0x302846, 0.4, 0.35, 0.99);
    add(new THREE.SphereGeometry(0.28, 20, 16), 0xc88d68, 0, 0.06, 1.03);
    const mouth = add(new THREE.SphereGeometry(0.16, 24, 12), 0x703a42, 0, -0.38, 0.99);
    mouth.scale.set(1.35, 0.16, 0.35);
    const neck = add(new THREE.CylinderGeometry(0.34, 0.44, 0.75, 32), 0xc88d68, 0, -1.12, 0);
    neck.position.y = -1.03;
    add(
      new THREE.SphereGeometry(1.25, 40, 24),
      clothingColors[avatarId] ?? clothingColors.classic,
      0,
      -2.02,
      0,
    );

    parent.appendChild(renderer.domElement);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);
    const resize = () => {
      if (!parent.clientWidth || !parent.clientHeight) return;
      renderer.setSize(parent.clientWidth, parent.clientHeight, false);
      camera.aspect = parent.clientWidth / parent.clientHeight;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    resize();

    let phase = 0;
    if (!reducedMotion) {
      renderer.setAnimationLoop(() => {
        phase += 0.16;
        const currentState = stateRef.current;
        mouth.scale.y = currentState === "speaking" ? 0.15 + Math.abs(Math.sin(phase)) * 0.62 : 0.16;
        group.rotation.y =
          currentState === "speaking"
            ? Math.sin(phase * 0.18) * 0.025
            : currentState === "listening"
              ? Math.sin(phase * 0.12) * 0.035
              : 0;
        renderer.render(scene, camera);
      });
    }
    const contextLost = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);

    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((item) => item.dispose());
        }
      });
      renderer.domElement.remove();
    };
  }, [avatarId, onFailure, reducedMotion]);

  return (
    <div
      ref={host}
      className="h-56 w-full overflow-hidden rounded-lg"
      aria-hidden="true"
      data-state={state}
    />
  );
}

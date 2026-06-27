"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { MetricValue, SemanticChip } from "@/components/shell";
import type { Goal, GoalsData, GoalStatus } from "@/lib/goals/data";
import styles from "./GoalsExperience.module.css";

type Props = {
  data: GoalsData;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function GoalsExperience({ data }: Props) {
  const primaryGoal = data.goals[0];
  const unlocked = data.goals.filter((goal) => goal.status === "unlocked").length;

  return (
    <main className={styles.stage} data-theme="linear">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <section className="relative min-h-[calc(100vh-6rem)] py-4 lg:py-10">
          <div className={styles.heroGrid}>
            <div className="space-y-6">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--accent-brand-border)] bg-[var(--accent-brand-fill)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-brand-text)]">
                  Goals cockpit
                </div>
                <h1 className="max-w-[11ch] text-5xl font-semibold leading-[0.95] tracking-[-0.055em] text-[var(--text-primary)] sm:text-6xl xl:text-7xl">
                  Unlock the next life.
                </h1>
                <p className="max-w-md text-base leading-7 text-[var(--text-secondary)] sm:text-lg">
                  Balance thresholds for the assets that change the room:
                  Cayman GTS, first 4-family BRRR, and the Explorer debt clear.
                </p>
              </div>

              <div className={`${styles.glassPanel} rounded-[var(--radius-panel)] p-4`}>
                <MetricValue
                  label={`${data.weekLabel} running balance`}
                  tone={data.runningBalanceCents >= 0 ? "positive" : "negative"}
                  value={formatMoney(data.runningBalanceCents)}
                />
                <div className={`${styles.chromeLine} mt-4 h-px w-full`} />
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <MiniStat label="Unlocked" value={`${unlocked}/${data.goals.length}`} />
                  <MiniStat label="Debt left" value={formatMoney(data.activeDebtCents)} />
                </div>
              </div>
            </div>

            <div className={styles.sceneShell} aria-label="Spinning chrome dream car and house scene">
              <div className={styles.sceneGlow} />
              <DreamScene />
            </div>

            <div className="space-y-3">
              {data.goals.map((goal) => (
                <HeroGoalCard goal={goal} key={goal.id} />
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className={`${styles.glassPanel} rounded-[var(--radius-panel)] p-4 sm:p-5`}>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
                  Progress cards
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-[var(--text-primary)]">
                  Thresholds
                </h2>
              </div>
              <SemanticChip tone={primaryGoal.status === "unlocked" ? "positive" : "warning"}>
                {primaryGoal.status === "unlocked" ? "Next unlocked" : "Next target"}
              </SemanticChip>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {data.goals.map((goal) => (
                <GoalCard goal={goal} key={goal.id} />
              ))}
            </div>
          </div>

          <div className={`${styles.glassPanel} rounded-[var(--radius-panel)] p-4 sm:p-5`}>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              Milestone timeline
            </p>
            <div className="mt-5 space-y-5">
              {data.timeline.map((item, index) => (
                <TimelineItem
                  caption={item.caption}
                  isLast={index === data.timeline.length - 1}
                  key={item.id}
                  status={item.status}
                  title={item.title}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function DreamScene() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasElement = canvas;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.set(0, 1.8, 8.2);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const root = new THREE.Group();
    scene.add(root);

    const chrome = new THREE.MeshStandardMaterial({
      color: 0xf0f2f7,
      emissive: 0x181a24,
      emissiveIntensity: 0.18,
      metalness: 0.86,
      roughness: 0.2,
    });
    const graphite = new THREE.MeshPhysicalMaterial({
      color: 0x111217,
      metalness: 0.72,
      roughness: 0.24,
      clearcoat: 0.8,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x5e6ad2,
      metalness: 0.25,
      roughness: 0.08,
      transmission: 0.28,
      transparent: true,
      opacity: 0.72,
    });
    const tire = new THREE.MeshStandardMaterial({
      color: 0x050506,
      metalness: 0.3,
      roughness: 0.46,
    });
    const houseMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x3a3d46,
      emissive: 0x070812,
      emissiveIntensity: 0.18,
      metalness: 0.55,
      roughness: 0.2,
      clearcoat: 0.7,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x99a0ff,
      opacity: 0.46,
      transparent: true,
    });

    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(3.25, 0.62, 1.24, 5, 1, 2), chrome);
    body.position.y = 0.02;
    car.add(body);
    car.add(edgeFor(body, edgeMaterial));

    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.34, 1.18), chrome);
    nose.position.set(-1.65, -0.08, 0);
    car.add(nose);
    car.add(edgeFor(nose, edgeMaterial));

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.56, 1.02), glass);
    cabin.position.set(0.38, 0.54, 0);
    cabin.rotation.z = -0.03;
    car.add(cabin);
    car.add(edgeFor(cabin, edgeMaterial));

    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.08, 1.38), graphite);
    spoiler.position.set(1.78, 0.42, 0);
    car.add(spoiler);

    const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.24, 32);
    for (const x of [-1.12, 1.1]) {
      for (const z of [-0.68, 0.68]) {
        const wheel = new THREE.Mesh(wheelGeometry, tire);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, -0.38, z);
        car.add(wheel);
      }
    }
    car.position.set(-0.8, -0.25, 0);
    root.add(car);

    const house = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.55, 1.2), houseMaterial);
    tower.position.set(1.82, 0.17, -0.72);
    house.add(tower);
    house.add(edgeFor(tower, edgeMaterial));
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.02, 0.62, 4), chrome);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(1.82, 1.28, -0.72);
    house.add(roof);
    house.add(edgeFor(roof, edgeMaterial));
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x99a0ff });
    for (let row = 0; row < 2; row += 1) {
      for (let col = 0; col < 2; col += 1) {
        const windowMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.28), windowMaterial);
        windowMesh.position.set(1.58 + col * 0.48, 0.1 + row * 0.48, -0.105);
        windowMesh.rotation.y = 0;
        house.add(windowMesh);
      }
    }
    root.add(house);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.45, 0.08, 96),
      new THREE.MeshPhysicalMaterial({
        color: 0x0f1011,
        metalness: 0.8,
        roughness: 0.16,
        clearcoat: 1,
      }),
    );
    platform.position.y = -0.78;
    root.add(platform);

    const particleCount = 180;
    const positions = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 9;
      positions[index * 3 + 1] = Math.random() * 5 - 1.4;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color: 0x99a0ff,
        opacity: 0.42,
        size: 0.025,
        transparent: true,
      }),
    );
    scene.add(particles);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const fillLight = new THREE.HemisphereLight(0xdfe7ff, 0x08080a, 1.55);
    scene.add(fillLight);
    const keyLight = new THREE.SpotLight(0xffffff, 4.8, 18, Math.PI / 5, 0.5, 0.9);
    keyLight.position.set(-3.5, 5.4, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x5e6ad2, 8, 10);
    rimLight.position.set(3.2, 1.4, 2.4);
    scene.add(rimLight);

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frameId = 0;
    let disposed = false;

    function resize() {
      const rect = canvasElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvasElement);
    resize();

    const clock = new THREE.Clock();

    function render() {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      if (!reduceMotion.matches) {
        root.rotation.y = elapsed * 0.19;
        root.rotation.x = Math.sin(elapsed * 0.35) * 0.035;
        particles.rotation.y = elapsed * 0.035;
      } else {
        root.rotation.y = 0.38;
      }
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(render);
    }

    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
    };
  }, []);

  return <canvas className={styles.sceneCanvas} data-goals-canvas ref={canvasRef} />;
}

function HeroGoalCard({ goal }: { goal: Goal }) {
  return (
    <article className={`${styles.glassPanel} rounded-[var(--radius-panel)] p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {goal.kicker}
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-[-0.025em] text-[var(--text-primary)]">
            {goal.title}
          </h2>
        </div>
        <GoalStatusChip status={goal.status} />
      </div>
      <ProgressBar goal={goal} />
      <div className="mt-3 flex items-end justify-between gap-3 text-sm">
        <span className="text-[var(--text-tertiary)]">
          {goal.kind === "debt_clear" ? "Remaining" : "Needed"}
        </span>
        <strong className="text-base font-semibold text-[var(--text-primary)]">
          {formatMoney(goal.remainingCents)}
        </strong>
      </div>
    </article>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const value = goal.kind === "debt_clear" ? goal.remainingCents : goal.currentCents;

  return (
    <article className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4 shadow-[var(--panel-shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
            {goal.kicker}
          </p>
          <h3 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-[var(--text-primary)]">
            {goal.title}
          </h3>
        </div>
        <GoalStatusChip status={goal.status} />
      </div>
      <p className="mt-3 min-h-[3rem] text-sm leading-6 text-[var(--text-secondary)]">
        {goal.description}
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <MiniStat
          label={goal.kind === "debt_clear" ? "Debt" : "Balance"}
          value={formatMoney(value)}
        />
        <MiniStat
          label={goal.kind === "debt_clear" ? "Clear line" : "Threshold"}
          value={goal.kind === "debt_clear" ? "$0" : formatMoney(goal.targetCents)}
        />
      </div>
      <ProgressBar goal={goal} />
      <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">
        {goal.status === "unlocked" ? goal.unlockCopy : `${formatMoney(goal.remainingCents)} to go`}
      </p>
    </article>
  );
}

function ProgressBar({ goal }: { goal: Goal }) {
  const width = `${Math.max(goal.status === "unlocked" ? 100 : 4, goal.progress * 100)}%`;

  return (
    <div className="mt-4 h-2 overflow-hidden rounded-full bg-[rgba(255,255,255,0.07)]">
      <div
        className={styles.progressFill}
        style={{
          width,
          background:
            goal.accent === "negative"
              ? "linear-gradient(90deg, var(--accent-negative), var(--accent-negative-text))"
              : goal.accent === "positive"
                ? "linear-gradient(90deg, var(--accent-primary), var(--accent-primary-text))"
                : "linear-gradient(90deg, var(--accent-brand), var(--accent-brand-text))",
        }}
      />
    </div>
  );
}

function TimelineItem({
  caption,
  isLast,
  status,
  title,
}: {
  caption: string;
  isLast: boolean;
  status: GoalStatus;
  title: string;
}) {
  const dotClass = useMemo(() => {
    if (status === "unlocked") return "bg-[var(--accent-primary-text)]";
    if (status === "in_progress") return "bg-[var(--accent-brand-text)]";
    return "bg-[var(--surface-hover)]";
  }, [status]);

  return (
    <div className="relative grid grid-cols-[18px_1fr] gap-4">
      <div className="relative flex justify-center">
        <span className={`mt-1 h-3 w-3 rounded-full ${dotClass} shadow-[0_0_18px_rgba(94,106,210,0.55)]`} />
        {!isLast ? (
          <span className={`${styles.timelineLine} absolute top-6 h-[calc(100%+1.25rem)] w-px opacity-60`} />
        ) : null}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3>
          <GoalStatusChip status={status} />
        </div>
        <p className="mt-1 text-sm text-[var(--text-tertiary)]">{caption}</p>
      </div>
    </div>
  );
}

function GoalStatusChip({ status }: { status: GoalStatus }) {
  if (status === "unlocked") return <SemanticChip tone="positive">Unlocked</SemanticChip>;
  if (status === "in_progress") return <SemanticChip tone="warning">In motion</SemanticChip>;
  return <SemanticChip tone="negative">Locked</SemanticChip>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-data)] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.035)] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-[var(--text-primary)]">
        {value}
      </p>
    </div>
  );
}

function formatMoney(cents: number): string {
  return currency.format(cents / 100);
}

function edgeFor(mesh: THREE.Mesh, material: THREE.LineBasicMaterial) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
  const line = new THREE.LineSegments(edges, material);
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  line.scale.copy(mesh.scale);
  return line;
}

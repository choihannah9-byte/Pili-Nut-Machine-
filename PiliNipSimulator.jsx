import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";

// ---------- engineering data (mm, from Design Report Rev B) ----------
const GRADES = {
  small: { label: "Small", width: 22, kernel: 12, rec: [12, 14], shell: "#6b4a2e" },
  medium: { label: "Medium", width: 28, kernel: 16, rec: [16, 20], shell: "#5d3f26" },
  large: { label: "Large", width: 34, kernel: 20, rec: [22, 26], shell: "#4f351f" },
};
const ROLLER_R = 75; // Ø150
const FACE_W = 80;

// outcome rules (simplified from Rev B §1.4 / §2):
// needs ≥4 mm of squeeze (width - gap) to fracture the shell;
// kernel is crushed if the hard stop sits below kernel dia + 2 mm.
function judge(gap, grade) {
  const g = GRADES[grade];
  if (g.width - gap < 4) return "uncracked";
  if (gap < g.kernel + 2) return "crushed";
  return "whole";
}

const OUTCOME_META = {
  whole: { stamp: "WHOLE KERNEL", color: "#7fc98f", note: "shell fractured, kernel intact" },
  crushed: { stamp: "KERNEL CRUSHED", color: "#e05b4b", note: "gap set below kernel diameter" },
  uncracked: { stamp: "UNCRACKED", color: "#d9a53c", note: "gap too wide — shell never reached fracture" },
};

export default function PiliNipSimulator() {
  const mountRef = useRef(null);
  const stateRef = useRef({});
  const [gap, setGap] = useState(18);
  const [grade, setGrade] = useState("medium");
  const [rpm, setRpm] = useState(36);
  const [autoFeed, setAutoFeed] = useState(false);
  const [log, setLog] = useState([]);
  const [tally, setTally] = useState({ whole: 0, crushed: 0, uncracked: 0 });
  const [busy, setBusy] = useState(false);

  // keep live values readable inside the animation loop
  const live = useRef({ gap, grade, rpm, autoFeed, busy: false });
  useEffect(() => { live.current.gap = gap; }, [gap]);
  useEffect(() => { live.current.grade = grade; }, [grade]);
  useEffect(() => { live.current.rpm = rpm; }, [rpm]);
  useEffect(() => { live.current.autoFeed = autoFeed; }, [autoFeed]);

  const pushResult = useCallback((outcome) => {
    setTally((t) => ({ ...t, [outcome]: t[outcome] + 1 }));
    setLog((l) => [{ outcome, gap: live.current.gap, grade: live.current.grade, id: Date.now() }, ...l].slice(0, 5));
  }, []);

  // ---------- three.js scene ----------
  useEffect(() => {
    const mount = mountRef.current;
    const W = mount.clientWidth, H = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#141a21");
    scene.fog = new THREE.Fog("#141a21", 700, 1400);

    const camera = new THREE.PerspectiveCamera(42, W / H, 1, 3000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    // lights
    scene.add(new THREE.AmbientLight(0x8899aa, 0.55));
    const key = new THREE.DirectionalLight(0xfff2e0, 0.9);
    key.position.set(220, 320, 260);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6f9fd0, 0.45);
    rim.position.set(-260, 120, -200);
    scene.add(rim);

    // ---- serrated roller: gear-like extrusion, 39 teeth × 2.5 mm on Ø150 ----
    function serratedRoller() {
      const teeth = 39, rOut = ROLLER_R, rRoot = ROLLER_R - 2.5;
      const shape = new THREE.Shape();
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2;
        const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
        if (i === 0) shape.moveTo(rRoot * Math.cos(a0), rRoot * Math.sin(a0));
        else shape.lineTo(rRoot * Math.cos(a0), rRoot * Math.sin(a0));
        shape.lineTo(rOut * Math.cos(a1), rOut * Math.sin(a1));
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: FACE_W, bevelEnabled: false, curveSegments: 4 });
      geo.translate(0, 0, -FACE_W / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x97a1ab, metalness: 0.85, roughness: 0.38 });
      const roller = new THREE.Mesh(geo, mat);
      const shaft = new THREE.Mesh(
        new THREE.CylinderGeometry(15, 15, FACE_W + 130, 24),
        new THREE.MeshStandardMaterial({ color: 0x5a6068, metalness: 0.8, roughness: 0.45 })
      );
      shaft.rotation.x = Math.PI / 2;
      const grp = new THREE.Group();
      grp.add(roller, shaft);
      return grp;
    }

    const bearingMat = new THREE.MeshStandardMaterial({ color: 0x2c343d, metalness: 0.3, roughness: 0.8 });
    function bearing(x, z) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(46, 46, 20), bearingMat);
      b.position.set(x, 0, z);
      return b;
    }

    const leftGroup = new THREE.Group();
    const rightGroup = new THREE.Group();
    const leftRoller = serratedRoller();
    const rightRoller = serratedRoller();
    leftGroup.add(leftRoller, bearing(0, FACE_W / 2 + 35), bearing(0, -FACE_W / 2 - 35));
    rightGroup.add(rightRoller, bearing(0, FACE_W / 2 + 35), bearing(0, -FACE_W / 2 - 35));
    scene.add(leftGroup, rightGroup);

    // translucent frame side plate (context)
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(300, 320, 8),
      new THREE.MeshStandardMaterial({ color: 0x22303c, transparent: true, opacity: 0.28, metalness: 0.1, roughness: 0.9 })
    );
    plate.position.set(0, -20, -(FACE_W / 2 + 52));
    scene.add(plate);

    // feed channel: V-trough at 35°, aimed at x=0 above the nip
    const chMat = new THREE.MeshStandardMaterial({ color: 0x8a9aa8, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide });
    const channel = new THREE.Group();
    const w1 = new THREE.Mesh(new THREE.BoxGeometry(120, 3, 30), chMat);
    const w2 = new THREE.Mesh(new THREE.BoxGeometry(120, 3, 30), chMat);
    w1.rotation.z = Math.PI / 6; w1.position.set(0, 12, 15);
    w2.rotation.z = -Math.PI / 6; w2.position.set(0, 12, -15);
    // wait — V opens along z so the nut's triangular section seats; ok
    channel.add(w1, w2);
    channel.rotation.z = -0.61; // 35°
    channel.position.set(78, 160, 0);
    scene.add(channel);

    // bins
    function bin(x, w, color) {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.85 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 90), m); base.position.y = -215;
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(4, 34, 90), m); s1.position.set(-w / 2, -198, 0);
      const s2 = s1.clone(); s2.position.x = w / 2;
      g.add(base, s1, s2); g.position.x = x; scene.add(g);
      return g;
    }
    bin(-95, 90, 0x3a4653);            // shell bin (deflected)
    bin(15, 90, 0x37505f);             // kernel bin (falls near vertical)

    // dimension line between roller crests at the nip
    const dimMat = new THREE.LineBasicMaterial({ color: 0xf2913d });
    const dimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const dimLine = new THREE.Line(dimGeo, dimMat);
    dimLine.position.z = FACE_W / 2 + 6;
    scene.add(dimLine);

    // ---- nut + fragments (built per feed) ----
    function triPrism(width, depth, color) {
      const r = width / 2;
      const shape = new THREE.Shape();
      // rounded triangle cross-section (pili nut)
      const pts = 3, round = 0.45;
      for (let i = 0; i <= 60; i++) {
        const t = (i / 60) * Math.PI * 2;
        const k = 1 - round + round * Math.cos(3 * (t + Math.PI / 2)) * -0.5;
        const rr = r * (0.82 + 0.18 * Math.cos(3 * (t - Math.PI / 2)));
        const x = rr * Math.cos(t), y = rr * Math.sin(t);
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 2, bevelThickness: 2, bevelSegments: 2, curveSegments: 24 });
      geo.translate(0, 0, -depth / 2);
      return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    }

    const S = stateRef.current;
    S.scene = scene; S.frags = []; S.nut = null; S.phase = "idle"; S.t = 0;

    // ---- camera orbit ----
    let theta = 0.55, phi = 1.25, radius = 520;
    const target = new THREE.Vector3(0, -20, 0);
    function placeCam() {
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    }
    placeCam();
    let dragging = false, px = 0, py = 0;
    const onDown = (e) => { dragging = true; px = e.clientX ?? e.touches?.[0]?.clientX; py = e.clientY ?? e.touches?.[0]?.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      const cx = e.clientX ?? e.touches?.[0]?.clientX, cy = e.clientY ?? e.touches?.[0]?.clientY;
      theta -= (cx - px) * 0.006; phi = Math.min(2.6, Math.max(0.4, phi - (cy - py) * 0.006));
      px = cx; py = cy; placeCam();
    };
    const onUp = () => (dragging = false);
    const onWheel = (e) => { e.preventDefault(); radius = Math.min(950, Math.max(260, radius + e.deltaY * 0.5)); placeCam(); };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // ---- feed sequence ----
    S.feed = () => {
      if (S.nut || S.phase !== "idle") return false;
      const g = GRADES[live.current.grade];
      const nut = triPrism(g.width, g.width * 1.7, g.shell);
      nut.rotation.x = Math.PI / 2; // long axis along roller face (z)
      nut.position.set(150, 235, 0);
      scene.add(nut);
      S.nut = nut; S.phase = "channel"; S.t = 0;
      S.outcome = judge(live.current.gap, live.current.grade);
      S.grade = g;
      return true;
    };

    S.spawnFrags = (crushKernel) => {
      const g = S.grade;
      // shell halves — deflected toward shell bin (left)
      for (let i = 0; i < 3; i++) {
        const f = triPrism(g.width * (0.45 + Math.random() * 0.2), g.width * 0.7, g.shell);
        f.position.set((Math.random() - 0.5) * 10, -85, (Math.random() - 0.5) * 30);
        f.userData.v = new THREE.Vector3(-60 - Math.random() * 70, 30 + Math.random() * 40, (Math.random() - 0.5) * 30);
        f.userData.w = new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        scene.add(f); S.frags.push(f);
      }
      // kernel
      const kGeo = new THREE.SphereGeometry(g.kernel / 2, 20, 16);
      kGeo.scale(1, 1.5, 1);
      const kernel = new THREE.Mesh(
        kGeo,
        new THREE.MeshStandardMaterial({ color: crushKernel ? 0xa8352a : 0xead9b4, roughness: 0.7 })
      );
      kernel.position.set(8, -85, 0);
      kernel.userData.v = new THREE.Vector3(6, -20, 0);
      kernel.userData.w = new THREE.Vector3(2, 1, 2);
      if (crushKernel) kernel.scale.set(1.15, 0.45, 1.15);
      scene.add(kernel); S.frags.push(kernel);
    };

    // ---- animation loop ----
    const clock = new THREE.Clock();
    let raf;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const gapNow = live.current.gap;
      const cx = ROLLER_R + gapNow / 2;
      leftGroup.position.x = -cx;
      rightGroup.position.x = cx;

      // dimension line follows the gap
      dimGeo.setFromPoints([
        new THREE.Vector3(-gapNow / 2, 0, 0),
        new THREE.Vector3(gapNow / 2, 0, 0),
      ]);

      // counter-rotation: surfaces move downward through the nip
      const w = (live.current.rpm * Math.PI * 2) / 60;
      leftRoller.rotation.z -= w * dt;   // left CCW? surface at nip (right side of left roller) moves down when rotation is negative-z? left roller spins clockwise viewed from +z => -z rotation moves its right surface down. 
      rightRoller.rotation.z += w * dt;  // mirror

      // nut sequence
      if (S.nut) {
        S.t += dt;
        const n = S.nut;
        if (S.phase === "channel") {
          // slide down the 35° channel toward a point above the nip
          const from = new THREE.Vector3(150, 235, 0), to = new THREE.Vector3(0, 105, 0);
          const k = Math.min(S.t / 1.1, 1);
          n.position.lerpVectors(from, to, k);
          if (k >= 1) { S.phase = "drop"; S.t = 0; }
        } else if (S.phase === "drop") {
          n.position.y -= 140 * dt;
          const contactY = Math.sqrt(Math.max(1, (ROLLER_R + S.grade.width / 2) ** 2 - cx ** 2));
          if (n.position.y <= contactY) { S.phase = "nip"; S.t = 0; }
        } else if (S.phase === "nip") {
          // drawn through: descend with peripheral speed, squeeze visually
          const v = ROLLER_R * w * 0.6;
          n.position.y -= v * dt;
          const squeeze = Math.max(gapNow / S.grade.width, 0.55);
          if (S.outcome !== "uncracked") {
            const p = Math.min(1, (60 - n.position.y) / 60);
            n.scale.x = 1 - (1 - squeeze) * Math.max(0, Math.min(1, (30 - n.position.y) / 40));
          }
          if (n.position.y <= -60) {
            if (S.outcome === "uncracked") {
              S.phase = "pass"; // slips through whole
            } else {
              scene.remove(n); S.nut = null;
              S.spawnFrags(S.outcome === "crushed");
              S.phase = "settle"; S.t = 0;
              S.done && S.done(S.outcome);
            }
          }
        } else if (S.phase === "pass") {
          n.position.y -= 120 * dt;
          n.position.x += 25 * dt;
          if (n.position.y < -200) {
            scene.remove(n); S.nut = null; S.phase = "idle";
            S.done && S.done("uncracked");
          }
        }
      }

      // fragments physics
      for (let i = S.frags.length - 1; i >= 0; i--) {
        const f = S.frags[i];
        f.userData.v.y -= 380 * dt;
        f.position.addScaledVector(f.userData.v, dt);
        f.rotation.x += f.userData.w.x * dt;
        f.rotation.y += f.userData.w.y * dt;
        f.rotation.z += f.userData.w.z * dt;
        if (f.position.y < -205) {
          f.position.y = -205;
          f.userData.v.set(0, 0, 0); f.userData.w.set(0, 0, 0);
          f.userData.rest = (f.userData.rest || 0) + dt;
          if (f.userData.rest > 2.2) { scene.remove(f); S.frags.splice(i, 1); }
        }
      }
      if (S.phase === "settle" && S.frags.length === 0) S.phase = "idle";
      if (S.phase === "settle" && S.t > 2.6) S.phase = "idle";
      if (S.phase === "settle") S.t += dt;

      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      camera.aspect = w2 / h2; camera.updateProjectionMatrix();
      renderer.setSize(w2, h2);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      renderer.dispose();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  // wire outcome callback + auto feed
  useEffect(() => {
    stateRef.current.done = (outcome) => { pushResult(outcome); setBusy(false); };
  }, [pushResult]);

  const feedOne = useCallback(() => {
    if (stateRef.current.feed && stateRef.current.feed()) setBusy(true);
  }, []);

  useEffect(() => {
    if (!autoFeed) return;
    const id = setInterval(() => {
      if (stateRef.current.phase === "idle" && !stateRef.current.nut) {
        if (stateRef.current.feed()) setBusy(true);
      }
    }, 900);
    return () => clearInterval(id);
  }, [autoFeed]);

  const g = GRADES[grade];
  const predicted = judge(gap, grade);
  const inRec = gap >= g.rec[0] && gap <= g.rec[1];

  return (
    <div style={{
      display: "flex", width: "100%", height: "100vh", background: "#0e1319",
      color: "#cfd8e0", fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", overflow: "hidden"
    }}>
      {/* viewport */}
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0, cursor: "grab" }} />
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, padding: "10px 16px",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          borderBottom: "1px solid #26303b", background: "rgba(14,19,25,0.7)", pointerEvents: "none"
        }}>
          <span style={{ letterSpacing: "0.12em", fontSize: 12, color: "#8fa1b3" }}>
            PNC-00 · ROLLER NIP MECHANISM SIMULATOR
          </span>
          <span style={{ fontSize: 11, color: "#5d6d7c" }}>drag to orbit · scroll to zoom</span>
        </div>
        <div style={{
          position: "absolute", bottom: 12, left: 16, fontSize: 11, color: "#5d6d7c", pointerEvents: "none", lineHeight: 1.7
        }}>
          Ø150 mm rollers · 39 grip serrations × 2.5 mm · counter-rotating<br />
          shell bin (left) ← air deflection · kernel bin (center)
        </div>
      </div>

      {/* control panel — title-block style */}
      <div style={{
        width: 320, flexShrink: 0, borderLeft: "1px solid #26303b", padding: 18,
        display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", background: "#121820"
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>ROLLER GAP — HARD STOP</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 34, color: "#f2913d", fontWeight: 700 }}>{gap}</span>
            <span style={{ color: "#8fa1b3" }}>mm crest-to-crest</span>
          </div>
          <input type="range" min={10} max={27} step={1} value={gap}
            onChange={(e) => setGap(+e.target.value)}
            style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Roller gap in millimeters" />
          <div style={{ fontSize: 11, color: inRec ? "#7fc98f" : "#d9a53c", marginTop: 4 }}>
            {inRec ? `within recommended range for ${g.label.toLowerCase()} grade (${g.rec[0]}–${g.rec[1]} mm)`
              : `recommended for ${g.label.toLowerCase()} grade: ${g.rec[0]}–${g.rec[1]} mm`}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>NUT GRADE</div>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.entries(GRADES).map(([k, v]) => (
              <button key={k} onClick={() => setGrade(k)} style={{
                flex: 1, padding: "8px 0", fontFamily: "inherit", fontSize: 12, cursor: "pointer",
                background: grade === k ? "#26333f" : "transparent",
                color: grade === k ? "#e8eef4" : "#8fa1b3",
                border: `1px solid ${grade === k ? "#f2913d" : "#2c3844"}`, borderRadius: 4
              }}>{v.label}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#5d6d7c", marginTop: 6 }}>
            width {g.width} mm · kernel Ø{g.kernel} mm
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>ROLLER SPEED — {rpm} rpm</div>
          <input type="range" min={15} max={50} step={1} value={rpm}
            onChange={(e) => setRpm(+e.target.value)}
            style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Roller speed in rpm" />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={feedOne} disabled={busy && !autoFeed} style={{
            flex: 1, padding: "12px 0", fontFamily: "inherit", fontSize: 13, fontWeight: 700,
            letterSpacing: "0.08em", cursor: busy ? "default" : "pointer",
            background: busy ? "#26303b" : "#f2913d", color: busy ? "#5d6d7c" : "#141a21",
            border: "none", borderRadius: 4
          }}>{busy ? "IN NIP…" : "FEED NUT"}</button>
          <button onClick={() => setAutoFeed(!autoFeed)} style={{
            flex: 1, padding: "12px 0", fontFamily: "inherit", fontSize: 13, cursor: "pointer",
            background: autoFeed ? "#26333f" : "transparent", color: autoFeed ? "#7fc98f" : "#8fa1b3",
            border: `1px solid ${autoFeed ? "#7fc98f" : "#2c3844"}`, borderRadius: 4
          }}>{autoFeed ? "AUTO: ON" : "AUTO FEED"}</button>
        </div>

        {/* predicted outcome — the teaching readout */}
        <div style={{ border: `1px dashed ${OUTCOME_META[predicted].color}`, borderRadius: 4, padding: "10px 12px" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3" }}>PREDICTED AT THIS SETTING</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: OUTCOME_META[predicted].color, margin: "4px 0 2px" }}>
            {OUTCOME_META[predicted].stamp}
          </div>
          <div style={{ fontSize: 11, color: "#8fa1b3" }}>{OUTCOME_META[predicted].note}</div>
        </div>

        {/* tally */}
        <div style={{ display: "flex", gap: 6, textAlign: "center" }}>
          {["whole", "crushed", "uncracked"].map((k) => (
            <div key={k} style={{ flex: 1, border: "1px solid #26303b", borderRadius: 4, padding: "8px 0" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: OUTCOME_META[k].color }}>{tally[k]}</div>
              <div style={{ fontSize: 10, color: "#5d6d7c", letterSpacing: "0.06em" }}>{k.toUpperCase()}</div>
            </div>
          ))}
        </div>

        {/* log */}
        <div style={{ flex: 1, minHeight: 60 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>INSPECTION LOG</div>
          {log.length === 0 && (
            <div style={{ fontSize: 12, color: "#5d6d7c" }}>Feed a nut to begin. Try a large nut at 18 mm to see why per-grade batching is mandatory.</div>
          )}
          {log.map((e) => (
            <div key={e.id} style={{
              display: "flex", justifyContent: "space-between", fontSize: 11,
              padding: "6px 8px", marginBottom: 4, borderLeft: `3px solid ${OUTCOME_META[e.outcome].color}`,
              background: "#171e27", borderRadius: "0 3px 3px 0"
            }}>
              <span style={{ color: OUTCOME_META[e.outcome].color, fontWeight: 700 }}>{OUTCOME_META[e.outcome].stamp}</span>
              <span style={{ color: "#5d6d7c" }}>{GRADES[e.grade].label} @ {e.gap} mm</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 10, color: "#46525f", lineHeight: 1.6, borderTop: "1px solid #26303b", paddingTop: 10 }}>
          Rules per Design Report Rev B: shell fractures when squeeze (width − gap) ≥ 4 mm;
          kernel crushed if hard stop &lt; kernel Ø + 2 mm. Screw is a rigid stop — springs open only on overload.
        </div>
      </div>
    </div>
  );
}

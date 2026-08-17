import React, { useRef, useEffect, useState } from "react";
import * as THREE from "three";

/* ================================================================
   PNC-GA REV C — assembly model with resolved material flow
   Architecture: continuous grading → 3 buffer bins → batch cracking
   Feed: continuous single-lane covered queue (metering gate deleted)
   Machine coords: mm, y-up, floor y=0. Front +z, drive rear −z.
   ================================================================ */

const GAP0 = 16;

const M = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0x9aa3ac, metalness: 0.85, roughness: 0.4 }),
  darkSteel: () => new THREE.MeshStandardMaterial({ color: 0x565e66, metalness: 0.8, roughness: 0.5 }),
  frame: () => new THREE.MeshStandardMaterial({ color: 0x2e6b4f, metalness: 0.25, roughness: 0.65 }),
  galv: () => new THREE.MeshStandardMaterial({ color: 0xb9c2c9, metalness: 0.55, roughness: 0.45 }),
  stainless: () => new THREE.MeshStandardMaterial({ color: 0xd7dde2, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide }),
  bronze: () => new THREE.MeshStandardMaterial({ color: 0xb0824a, metalness: 0.75, roughness: 0.45 }),
  bearing: () => new THREE.MeshStandardMaterial({ color: 0x3b444d, metalness: 0.4, roughness: 0.7 }),
  guard: () => new THREE.MeshStandardMaterial({ color: 0xe07020, transparent: true, opacity: 0.3, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
  hood: () => new THREE.MeshStandardMaterial({ color: 0x4a7ba6, transparent: true, opacity: 0.25, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.95 }),
  chain: () => new THREE.MeshStandardMaterial({ color: 0x30363c, metalness: 0.7, roughness: 0.55 }),
};

function holeTexture(holePx) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#cfd6db"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#5a646c";
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.beginPath(); g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, holePx, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}
function tag(obj, name, desc) { obj.traverse((o) => { o.userData.pname = name; o.userData.pdesc = desc; }); return obj; }
function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function cyl(r, h, mat, seg = 24) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }
function taper(topR, botR, h, mat, seg = 4) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(topR, botR, h, seg, 1, true), mat);
  m.rotation.y = Math.PI / 4; return m;
}
function serratedRoller(mat) {
  const teeth = 39, rOut = 75, rRoot = 72.5;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, a1 = ((i + 0.5) / teeth) * Math.PI * 2;
    if (i === 0) shape.moveTo(rRoot * Math.cos(a0), rRoot * Math.sin(a0));
    else shape.lineTo(rRoot * Math.cos(a0), rRoot * Math.sin(a0));
    shape.lineTo(rOut * Math.cos(a1), rOut * Math.sin(a1));
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 80, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -40);
  return new THREE.Mesh(g, mat);
}
function spring(r, len, coils, mat, tube = 3.2) {
  const pts = []; const n = coils * 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(t * len, r * Math.cos(a), r * Math.sin(a)));
  }
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, tube, 8, false), mat);
}
function pillowBlock(mat) {
  const g = new THREE.Group();
  const base = box(76, 20, 22, mat); base.position.y = -22;
  const body = cyl(24, 22, mat); body.rotation.x = Math.PI / 2;
  const boss = cyl(17, 26, M.steel()); boss.rotation.x = Math.PI / 2;
  g.add(base, body, boss); return g;
}
// oriented connector box between two points (chutes)
function link(p1, p2, w, t, mat) {
  const dir = new THREE.Vector3().subVectors(p2, p1);
  const len = dir.length();
  const m = box(len, t, w, mat);
  m.position.copy(p1).addScaledVector(dir, 0.5);
  m.rotation.z = Math.atan2(dir.y, Math.sqrt(dir.x * dir.x + dir.z * dir.z)) * Math.sign(dir.x || 1);
  m.rotation.y = -Math.atan2(dir.z, dir.x);
  return m;
}

export default function PiliAssemblyModelRevC() {
  const mountRef = useRef(null);
  const R = useRef({});
  const [gap, setGap] = useState(GAP0);
  const [explode, setExplode] = useState(0);
  const [running, setRunning] = useState(true);
  const [picked, setPicked] = useState(null);
  const [vis, setVis] = useState({
    frame: true, cracking: true, adjustment: true, drive: true,
    feeding: true, sorting: true, separation: true, guards: true, flow: true,
  });
  const live = useRef({ gap, explode, running });
  useEffect(() => { live.current.gap = gap; }, [gap]);
  useEffect(() => { live.current.explode = explode; }, [explode]);
  useEffect(() => { live.current.running = running; }, [running]);

  useEffect(() => {
    const mount = mountRef.current;
    const W = mount.clientWidth, H = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe4e8);
    const camera = new THREE.PerspectiveCamera(40, W / H, 5, 9000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9096, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(500, 1000, 600); scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0f0, 0.3); fill.position.set(-600, 400, -400); scene.add(fill);
    scene.add(new THREE.GridHelper(2400, 48, 0xb0b8bf, 0xc8cfd5));

    const sub = {};
    const mk = (k, ex) => { const g = new THREE.Group(); g.userData.exVec = ex; scene.add(g); sub[k] = g; return g; };
    const Gframe = mk("frame", new THREE.Vector3(0, 0, 0));
    const Gcrack = mk("cracking", new THREE.Vector3(0, 0, 0));
    const Gadj = mk("adjustment", new THREE.Vector3(1.4, 0, 0));
    const Gdrive = mk("drive", new THREE.Vector3(0, 0, -1.6));
    const Gfeed = mk("feeding", new THREE.Vector3(1.3, 0.4, 0));
    const Gsort = mk("sorting", new THREE.Vector3(0, 1.4, 0));
    const Gsep = mk("separation", new THREE.Vector3(-1.1, -0.5, 0));
    const Gguard = mk("guards", new THREE.Vector3(0, 0, 2.2));
    const Gflow = mk("flow", new THREE.Vector3(0, 0, 0));

    /* ---------- FRAME ---------- */
    {
      const fm = M.frame();
      const rails = [box(450, 50, 50, fm), box(450, 50, 50, fm), box(50, 50, 250, fm), box(50, 50, 250, fm)];
      rails[0].position.set(0, 37, 150); rails[1].position.set(0, 37, -150);
      rails[2].position.set(-200, 37, 0); rails[3].position.set(200, 37, 0);
      rails.forEach((r) => Gframe.add(tag(r, "Base frame", "50×50×5 MS angle, welded (outsourced); side plates BOLT to it — machined flat first, no post-machining distortion")));
      for (const [fx, fz] of [[-200, 150], [200, 150], [-200, -150], [200, -150]]) {
        const ft = cyl(16, 14, M.rubber()); ft.position.set(fx, 7, fz);
        Gframe.add(tag(ft, "Anti-vibration foot", "Rubber, M10 stud ×4"));
      }
      for (const zc of [60, -60]) {
        const pl = box(300, 450, 10, fm); pl.position.set(0, 287, zc);
        Gframe.add(tag(pl, "Side plate", "10 mm MS, bolted to base; milled carriage slot + mirror-drilled bearing patterns (claim-critical, outsourced)"));
        const slot = box(110, 66, 11, M.darkSteel()); slot.position.set(105, 330, zc);
        Gframe.add(tag(slot, "Carriage slot", "Milled, gib-lined guide for the adjustable-roller carriage"));
      }
      const cm = box(40, 40, 110, fm); cm.position.set(-130, 300, 0);
      Gframe.add(tag(cm, "Cross member", "40×40×4 tube — torsional stiffness"));
      const ped = box(220, 24, 120, fm); ped.position.set(-40, 300, -232);
      const leg1 = box(40, 240, 40, fm); leg1.position.set(-120, 168, -232);
      const leg2 = box(40, 240, 40, fm); leg2.position.set(60, 168, -232);
      [ped, leg1, leg2].forEach((p) => Gframe.add(tag(p, "Drive pedestal", "Reducer + motor at shaft height (assumption to ratify in CAD)")));
      // taller sorter posts
      for (const [px, pz] of [[-160, 60], [160, 60], [-160, -60], [160, -60]]) {
        const post = box(30, 250, 30, fm); post.position.set(px, 637, pz);
        Gframe.add(tag(post, "Sorter support post", "Raised in Rev C: grade bins need head height so downstream chutes exceed the pili slide angle"));
      }
    }

    /* ---------- CRACKING ---------- */
    const rollerL = new THREE.Group();
    const rollerRAsm = new THREE.Group();
    {
      const rl = serratedRoller(M.steel()); tag(rl, "Fixed roller", "AISI 1045 Ø150×80, serrated (grip, not orientation), flame/induction hardened HRC 45–50");
      rollerL.add(rl);
      const shL = cyl(15, 340, M.darkSteel()); shL.rotation.x = Math.PI / 2; shL.position.z = -35;
      rollerL.add(tag(shL, "Fixed roller shaft", "Ø30 1045; ground journals (h7/j6 for UC inserts)"));
      rollerL.position.set(-83, 330, 0);
      Gcrack.add(rollerL);
      for (const zc of [78, -78]) {
        const pb = pillowBlock(M.bearing()); pb.position.set(-83, 330, zc);
        Gcrack.add(tag(pb, "Pillow block UCF206", "Fixed side — bolted to plate"));
      }
      const rr = serratedRoller(M.steel()); tag(rr, "Adjustable roller", "Matched to fixed roller ≤0.05 mm; carried on gibbed carriages");
      rollerRAsm.add(rr);
      const shR = cyl(15, 340, M.darkSteel()); shR.rotation.x = Math.PI / 2; shR.position.z = -35;
      rollerRAsm.add(tag(shR, "Adjustable roller shaft", "Ø30 1045; rear extension carries sync sprocket"));
      for (const zc of [78, -78]) {
        const car = box(100, 90, 26, M.darkSteel()); car.position.set(0, 0, zc);
        rollerRAsm.add(tag(car, "Sliding carriage", "25 mm MS in gibbed slot"));
        const pb = pillowBlock(M.bearing()); pb.position.set(0, 0, zc + 20);
        rollerRAsm.add(tag(pb, "Pillow block UCF206", "Adjustable side — on carriage"));
        for (const gy of [52, -52]) {
          const gib = box(120, 10, 8, M.bronze()); gib.position.set(0, gy, zc - 4);
          rollerRAsm.add(tag(gib, "Gib strip", "Bronze-shimmed — prevents carriage cocking under nip load"));
        }
      }
      rollerRAsm.position.set(83, 330, 0);
      Gcrack.add(rollerRAsm);
      rollerL.userData.exSelf = new THREE.Vector3(-0.8, 0, 0);
      rollerRAsm.userData.exSelf = new THREE.Vector3(0.8, 0, 0);
    }

    /* ---------- ADJUSTMENT ---------- */
    const collarGrp = new THREE.Group();
    {
      for (const zc of [78, -78]) {
        const scr = cyl(6, 150, M.darkSteel()); scr.rotation.z = Math.PI / 2; scr.position.set(190, 330, zc);
        Gadj.add(tag(scr, "Adjustment screw M24×3", "Rigid gap reference; one turn = 3 mm; changed only under lockout between grade batches"));
        const boss = box(34, 60, 40, M.frame()); boss.position.set(226, 330, zc);
        Gadj.add(tag(boss, "Frame boss + bronze bushing", "M24 thread in bronze"));
        const spr = spring(16, 66, 7, M.steel()); spr.position.set(140, 330, zc);
        Gadj.add(tag(spr, "Die spring (preload)", "2,000 N total holds carriage on the stop; opens only on overload"));
        const col = cyl(15, 12, M.bronze()); col.rotation.z = Math.PI / 2; col.position.set(118, 330, zc);
        collarGrp.add(tag(col, "Stop collar — HARD STOP", "Minimum gap; snap-back returns here, never below"));
        const nut = cyl(14, 10, M.darkSteel(), 6); nut.rotation.z = Math.PI / 2; nut.position.set(246, 330, zc);
        Gadj.add(tag(nut, "M24 locknut", "Locked per grade batch"));
      }
      Gadj.add(collarGrp);
      const hw = cyl(34, 10, M.frame()); hw.rotation.z = Math.PI / 2; hw.position.set(262, 330, 78);
      Gadj.add(tag(hw, "Handwheel", "Single point for both chain-linked screws"));
      const lc = box(6, 3, 156, M.chain()); lc.position.set(252, 344, 0);
      const lc2 = lc.clone(); lc2.position.y = 316;
      for (const zc of [78, -78]) {
        const sp = cyl(16, 6, M.chain()); sp.rotation.z = Math.PI / 2; sp.position.set(252, 330, zc);
        Gadj.add(tag(sp, "#25 link sprocket", "No roller skew"));
      }
      Gadj.add(tag(lc, "#25 link chain", "Ties both screws"), tag(lc2, "#25 link chain", "Ties both screws"));
      const sc = box(80, 16, 2, M.stainless()); sc.position.set(105, 268, 66);
      Gadj.add(tag(sc, "Gap scale 0–30 mm", "Set per grade; verified by feeler at commissioning"));
    }

    /* ---------- DRIVE ---------- */
    const spkL = new THREE.Group(), spkR = new THREE.Group();
    let chainMesh = null; const idlers = [];
    {
      const zP = -168;
      for (const [g2, xr] of [[spkL, -83], [spkR, 83]]) {
        const s = cyl(32.4, 9, M.chain(), 16); s.rotation.x = Math.PI / 2;
        g2.add(tag(s, "Sync sprocket 16T #40", "Serpentine chain reverses rotation between the pair"));
        g2.position.set(xr, 330, zP); Gdrive.add(g2);
      }
      for (const ix of [-55, 55]) {
        const id = cyl(14, 8, M.steel(), 14); id.rotation.x = Math.PI / 2; id.position.set(ix, 446, zP);
        idlers.push(id);
        Gdrive.add(tag(id, "Spring-loaded idler", "Tension + wrap across the 17 mm center-distance range"));
      }
      const jc1 = cyl(22, 16, M.rubber()); jc1.rotation.x = Math.PI / 2; jc1.position.set(-83, 330, -196);
      Gdrive.add(tag(jc1, "Jaw coupling", "Reducer output → fixed roller shaft"));
      const red = box(95, 95, 85, M.darkSteel()); red.position.set(-83, 330, -252);
      Gdrive.add(tag(red, "Worm gear reducer 40:1", "Self-locking; 36 rpm out"));
      const mot = cyl(46, 130, M.frame()); mot.rotation.z = Math.PI / 2; mot.position.set(10, 330, -252);
      const fan = cyl(48, 14, M.darkSteel()); fan.rotation.z = Math.PI / 2; fan.position.set(82, 330, -252);
      Gdrive.add(tag(mot, "Motor 0.5 hp TEFC", "220 V single-phase; hookup wired by electrician"), tag(fan, "Motor fan cowl", ""));
      const tk = box(4, 260, 3, M.chain()); tk.position.set(-118, 470, zP); tk.rotation.z = 0.28;
      Gdrive.add(tag(tk, "Sorter take-off chain", "Step-up ≈1:1.4 → 40–60 cpm deck oscillation"));
      const ecc = cyl(15, 8, M.steel()); ecc.rotation.x = Math.PI / 2; ecc.position.set(-152, 600, zP);
      Gdrive.add(tag(ecc, "Sorter eccentric sprocket", "One motor, three functions"));
    }
    function buildChain(gapNow) {
      if (chainMesh) { Gdrive.remove(chainMesh); chainMesh.geometry.dispose(); }
      const zP = -168, rs = 32.4, ri = 14;
      const Lx = -83, Rx = 67 + gapNow;
      const P = (cx, cy, r, a) => new THREE.Vector3(cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180), zP);
      const pts = [];
      const arc = (cx, cy, r, a0, a1, n = 14) => { for (let i = 0; i <= n; i++) pts.push(P(cx, cy, r, a0 + ((a1 - a0) * i) / n)); };
      arc(-55, 446, ri, 150, 70, 8);
      pts.push(P(Lx, 330, rs, 140)); arc(Lx, 330, rs, 140, -20, 16);
      pts.push(P(Rx, 330, rs, 200)); arc(Rx, 330, rs, 200, -20, 16);
      pts.push(P(Rx, 330, rs, -20)); arc(55, 446, ri, -30, 110, 8);
      chainMesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.05), 220, 3.2, 8, true), M.chain());
      tag(chainMesh, "Serpentine #40 sync chain", "S-path counter-rotation; tolerates the full gap adjustment");
      Gdrive.add(chainMesh);
    }
    buildChain(GAP0);
    R.current.buildChain = buildChain;

    /* ---------- SORTING (raised decks + full containment) ---------- */
    const deckGroups = [];
    {
      const sframe = box(380, 8, 340, M.frame()); sframe.position.set(0, 766, 0);
      Gsort.add(tag(sframe, "Sorter frame", "Oscillates on the eccentric; skirts and walls ride with it"));
      const specs = [
        [800, 10, "Top deck — 31 mm apertures", "Large retained → Large bin chute"],
        [748, 7, "Middle deck — 25 mm apertures", "Medium retained → Medium bin chute"],
        [696, 5, "Bottom deck — 20 mm apertures", "Small retained → Small bin; fines fall to drawer"],
      ];
      for (const [yc, hp, nm, ds] of specs) {
        const g = new THREE.Group();
        const mat = new THREE.MeshStandardMaterial({ map: holeTexture(hp), metalness: 0.6, roughness: 0.4 });
        const plate = box(350, 5, 300, mat);
        g.add(tag(plate, nm, ds + " — 304 SS, 15° incline"));
        for (const zs of [152, -152]) {
          const skirt = box(350, 34, 4, M.stainless()); skirt.position.set(0, 17, zs);
          g.add(tag(skirt, "Deck side skirt", "NEW Rev C: 34 mm walls both sides, fixed to the oscillating deck — nuts cannot roll off laterally"));
        }
        const endw = box(4, 34, 300, M.stainless()); endw.position.set(-175, 17, 0);
        g.add(tag(endw, "Deck feed-end wall", "NEW Rev C: closes the high end; material can only leave via apertures or the discharge lip"));
        const lip = box(30, 4, 300, M.stainless()); lip.position.set(188, -12, 0); lip.rotation.z = 0.5;
        g.add(tag(lip, "Discharge lip", "Hands the retained fraction to its grade-bin chute"));
        g.rotation.z = -0.26; g.position.set(0, yc, 0);
        deckGroups.push(g); Gsort.add(g);
      }
      const hop = taper(206, 68, 130, new THREE.MeshStandardMaterial({ color: 0xb9c2c9, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide }));
      hop.position.set(-40, 922, 0);
      Gsort.add(tag(hop, "Hopper", "3–4 kg; walls ≥ measured angle of repose + 15° (placeholder 50°) — anti-bridging; throttled outlet onto top deck"));
      const fd = box(140, 26, 200, M.galv()); fd.position.set(-90, 652, 0);
      Gsort.add(tag(fd, "Fines drawer", "Under-deck pan routes <20 mm debris here"));
    }

    /* ---------- FEEDING: grade bins → funnel → single-lane queue ---------- */
    {
      const binDefs = [
        [95, "Large grade bin", 845 - 45],
        [0, "Medium grade bin", 793 - 45],
        [-95, "Small grade bin", 741 - 45],
      ];
      // chutes from deck discharge to each bin
      for (const [zc, nm, yEnd] of binDefs) {
        const chute = link(new THREE.Vector3(190, yEnd, 0), new THREE.Vector3(232, 655, zc), 60, 4, M.stainless());
        Gfeed.add(tag(chute, "Grade chute", `NEW Rev C: walled chute from deck discharge to ${nm.toLowerCase()}; angle ≥ measured slide angle + margin (placeholder ~40°)`));
      }
      for (const [zc, nm] of binDefs) {
        const bin = new THREE.Group();
        const b = box(70, 66, 80, M.galv()); b.position.set(0, 0, 0);
        bin.add(tag(b, nm, "Buffer storage ≈1.5–2 kg — decouples continuous grading from batch cracking (the Task 0 architecture)"));
        const gate = box(6, 34, 60, M.stainless()); gate.position.set(-38, -14, 0);
        bin.add(tag(gate, `${nm} slide gate`, "Only one gate open at a time — enforced by the interlock bar"));
        bin.position.set(232, 615, zc);
        Gfeed.add(bin);
      }
      const bar = box(8, 10, 300, M.bronze()); bar.position.set(-42 + 232, 590, 0);
      Gfeed.add(tag(bar, "Gate interlock bar", "NEW Rev C poka-yoke: sliding bar with one cutout — physically impossible to open two grade gates at once; the hardware defense against cracking the wrong grade at the set gap"));
      // collecting funnel under gates
      const fun = taper(120, 26, 70, M.stainless());
      fun.position.set(190, 560, 0);
      Gfeed.add(tag(fun, "Collecting funnel", "Receives the selected grade; converging walls ≥ slide angle (placeholder 40°)"));
      // single-lane covered channel, 35° to nip
      const chGrp = new THREE.Group();
      const base = box(190, 4, 46, M.stainless());
      const w1 = box(190, 30, 4, M.stainless()); w1.position.set(0, 15, 23);
      const w2 = box(190, 30, 4, M.stainless()); w2.position.set(0, 15, -23);
      const cover = box(190, 4, 46, M.stainless()); cover.position.set(0, 32, 0);
      chGrp.add(
        tag(base, "Single-lane queue channel — 38 mm", "REV C FEEDER: continuous gravity queue replaces the metering gate. Lane ~38 mm passes any single nut (max ~36) but blocks two smallest abreast (2×20=40) — singulation by geometry, zero moving parts. Width provisional until the size survey."),
        tag(w1, "Lane wall", "Single-lane containment"),
        tag(w2, "Lane wall", "Single-lane containment"),
        tag(cover, "Anti-shingling cover strip", "NEW Rev C: clearance ≈ max nut thickness + 5 mm — nuts cannot ride over the queue")
      );
      chGrp.rotation.z = 0.61;
      chGrp.position.set(88, 505, 0);
      Gfeed.add(chGrp);
      const comb = box(3, 26, 40, M.stainless()); comb.position.set(158, 552, 0);
      Gfeed.add(tag(comb, "Anti-bridge comb", "Breaks two-nut arches at the funnel exit"));
      const pin = cyl(3, 60, M.bronze()); pin.rotation.x = Math.PI / 2; pin.position.set(130, 532, 0);
      Gfeed.add(tag(pin, "Escapement pin provision (fallback)", "Two cross-drilled positions: if commissioning shows surging or premature entry, a drop-in pin becomes a passive escapement. Provision costs ~nothing; the deleted metering gate stays deleted."));
      const shroud = box(50, 40, 60, M.stainless()); shroud.position.set(20, 452, 0);
      Gfeed.add(tag(shroud, "Nip entry shroud", "NEW Rev C: closes the channel-to-nip transition — nuts cannot bounce out, hands cannot reach in (containment and ISO 13857 guarding in one part)"));
    }

    /* ---------- SEPARATION (contained) ---------- */
    let screenGroup = null;
    {
      const catchF = taper(120, 55, 80, M.stainless());
      catchF.position.set(0, 258, 0);
      Gsep.add(tag(catchF, "Catch funnel under nip", "NEW Rev C: full-width capture of kernel + laterally scattered shell fragments (walls extend past the roller face ends); delivers to the screen top"));
      screenGroup = new THREE.Group();
      const smat = new THREE.MeshStandardMaterial({ map: holeTexture(3.5), metalness: 0.6, roughness: 0.4 });
      const sp = box(210, 4, 300, smat);
      screenGroup.add(tag(sp, "Stage 1 screen — 8 mm", "Dust to waste only; kernels (10–22 mm) all retained; cam-oscillated"));
      for (const zs of [152, -152]) {
        const wall = box(210, 30, 4, M.stainless()); wall.position.set(0, 15, zs);
        screenGroup.add(tag(wall, "Screen side wall", "NEW Rev C: material cannot leave the screen laterally"));
      }
      const dam = box(4, 30, 300, M.stainless()); dam.position.set(103, 15, 0);
      screenGroup.add(tag(dam, "Screen end dam", "Closes the high end under the catch funnel"));
      screenGroup.rotation.z = 0.35; screenGroup.position.set(-62, 246, 0);
      Gsep.add(screenGroup);
      const wd = box(150, 30, 220, M.galv()); wd.position.set(-40, 150, 0);
      Gsep.add(tag(wd, "Waste drawer", "Fines under 8 mm"));
      const blw = cyl(26, 40, M.darkSteel()); blw.rotation.z = Math.PI / 2; blw.position.set(-96, 196, 0);
      Gsep.add(tag(blw, "Centrifugal blower", "≈9 m/s cross-draft placeholder — set from measured terminal velocities"));
      const hood = box(160, 120, 200, M.hood()); hood.position.set(-200, 160, 0);
      Gsep.add(tag(hood, "Separation hood", "NEW Rev C: encloses the air-split drop zone — shell cannot be blown out of the machine; blue translucent for visibility"));
      const div = box(4, 70, 180, M.stainless()); div.position.set(-214, 100, 0);
      Gsep.add(tag(div, "Adjustable divider", "Tunes the kernel/shell split boundary at commissioning"));
      const mkTray = (x, nm, ds) => {
        const t = new THREE.Group();
        const b = box(72, 6, 130, M.galv());
        for (const [dx, dz, w, d] of [[-36, 0, 6, 130], [36, 0, 6, 130], [0, 65, 72, 6], [0, -65, 72, 6]]) {
          const wall = box(w, 44, d, M.galv()); wall.position.set(dx, 22, dz); t.add(wall);
        }
        t.add(b); t.position.set(x, 58, 0);
        Gsep.add(tag(t, nm, ds));
      };
      mkTray(-172, "Kernel tray", "Walled, removable — product out; kernels fall near-vertical");
      mkTray(-256, "Shell tray", "Walled, removable — deflected shell; uncracked nuts hand-picked back to the matching grade bin");
    }

    /* ---------- GUARDS ---------- */
    {
      const nipG = box(340, 130, 150, M.guard()); nipG.position.set(0, 452, 40);
      Gguard.add(tag(nipG, "Nip guard", "Fixed, tool-removable; works with the nip entry shroud — no reach path to the nip per ISO 13857"));
      const chG = box(340, 300, 40, M.guard()); chG.position.set(0, 420, -172);
      Gguard.add(tag(chG, "Chain guard", "Full enclosure over sync + take-off trains"));
      const es = cyl(14, 10, new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 }));
      es.rotation.z = Math.PI / 2; es.position.set(156, 420, 66);
      const esb = box(30, 30, 8, new THREE.MeshStandardMaterial({ color: 0xf2c811, roughness: 0.6 })); esb.position.set(156, 420, 62);
      Gguard.add(tag(es, "Emergency stop", "At the feeding position; worm self-lock = no coast-down"), tag(esb, "E-stop plate", ""));
    }

    /* ---------- FLOW PATH OVERLAY ---------- */
    {
      const col = 0x1f8a4c;
      const seg = (p1, p2, name) => {
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const len = dir.length();
        const a = new THREE.ArrowHelper(dir.clone().normalize(), p1, len, col, Math.min(26, len * 0.3), 14);
        Gflow.add(tag(a, "Material flow: " + name, "Toggleable overlay — the resolved Task 0 path: continuous grading → buffer bins → ONE grade at a time → queue → nip → separation"));
      };
      const V = (x, y, z) => new THREE.Vector3(x, y, z);
      seg(V(-40, 900, 0), V(-80, 815, 0), "hopper → top deck");
      seg(V(-120, 810, 0), V(150, 745, 0), "along decks (oversize retained, undersize falls)");
      seg(V(195, 720, 40), V(235, 662, 90), "deck → grade bin (×3)");
      seg(V(232, 600, 0), V(200, 560, 0), "selected bin → funnel");
      seg(V(175, 545, 0), V(35, 452, 0), "single-lane queue → nip");
      seg(V(0, 400, 0), V(0, 292, 0), "nip → catch funnel");
      seg(V(-20, 268, 0), V(-150, 222, 0), "screen (dust drops out)");
      seg(V(-168, 210, 0), V(-250, 120, 0), "air split → shell tray");
      seg(V(-168, 210, 0), V(-172, 110, 0), "kernels fall → kernel tray");
    }

    Object.values(sub).forEach((g) => { g.userData.base = g.position.clone(); });
    rollerL.userData.base = rollerL.position.clone();
    rollerRAsm.userData.base = rollerRAsm.position.clone();
    const exParts = Object.values(sub);

    /* ---------- camera ---------- */
    let theta = 0.72, phi = 1.1, radius = 1550;
    const target = new THREE.Vector3(0, 480, 0);
    function placeCam() {
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta));
      camera.lookAt(target);
    }
    placeCam();
    R.current.setView = (v) => {
      if (v === "front") { theta = 0; phi = Math.PI / 2 - 0.05; }
      if (v === "drive") { theta = Math.PI; phi = Math.PI / 2 - 0.05; }
      if (v === "top") { theta = 0; phi = 0.12; }
      if (v === "iso") { theta = 0.72; phi = 1.1; }
      placeCam();
    };
    let dragging = false, moved = 0, px = 0, py = 0;
    const cxy = (e) => [e.clientX ?? e.touches?.[0]?.clientX, e.clientY ?? e.touches?.[0]?.clientY];
    const onDown = (e) => { dragging = true; moved = 0; [px, py] = cxy(e); };
    const onMove = (e) => {
      if (!dragging) return;
      const [cx2, cy2] = cxy(e);
      moved += Math.abs(cx2 - px) + Math.abs(cy2 - py);
      theta -= (cx2 - px) * 0.005;
      phi = Math.min(1.55, Math.max(0.1, phi - (cy2 - py) * 0.005));
      px = cx2; py = cy2; placeCam();
    };
    const onUp = () => (dragging = false);
    const onWheel = (e) => { e.preventDefault(); radius = Math.min(2800, Math.max(550, radius + e.deltaY * 1.2)); placeCam(); };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let highlighted = null;
    const onClick = (e) => {
      if (moved > 6) return;
      const r2 = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - r2.left) / r2.width) * 2 - 1;
      mouse.y = -((e.clientY - r2.top) / r2.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.userData.pname);
      if (highlighted) { highlighted.material?.emissive?.setHex(0x000000); highlighted = null; }
      if (hits.length) {
        const o = hits[0].object;
        if (o.material?.emissive) { o.material.emissive.setHex(0x224466); highlighted = o; }
        setPicked({ name: o.userData.pname, desc: o.userData.pdesc });
      } else setPicked(null);
    };
    renderer.domElement.addEventListener("click", onClick);

    const clock = new THREE.Clock();
    let raf, t = 0, lastGap = GAP0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const L = live.current;
      if (L.gap !== lastGap) { lastGap = L.gap; R.current.buildChain(L.gap); }
      const dg = L.gap - GAP0;
      rollerRAsm.position.x = rollerRAsm.userData.base.x + dg + L.explode * rollerRAsm.userData.exSelf.x * 120;
      rollerL.position.x = rollerL.userData.base.x + L.explode * rollerL.userData.exSelf.x * 120;
      spkR.position.x = 83 + dg;
      collarGrp.position.x = dg;
      for (const g of exParts) g.position.copy(g.userData.base).addScaledVector(g.userData.exVec, L.explode * 170);
      if (L.running && L.explode < 0.05) {
        t += dt;
        const w = (36 * Math.PI * 2) / 60;
        rollerL.children[0].rotation.z -= w * dt;
        rollerRAsm.children[0].rotation.z += w * dt;
        spkL.rotation.z -= w * dt; spkR.rotation.z += w * dt;
        idlers.forEach((id) => (id.rotation.z += w * 2.3 * dt));
        const osc = Math.sin(t * 5.2) * 4;
        deckGroups.forEach((d) => (d.position.x = osc));
        if (screenGroup) screenGroup.position.x = -62 + Math.sin(t * 3.8) * 3;
      }
      renderer.render(scene, camera);
    };
    animate();
    const onResize = () => {
      const w2 = mount.clientWidth, h2 = mount.clientHeight;
      camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2);
    };
    window.addEventListener("resize", onResize);
    R.current.sub = sub;
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

  useEffect(() => {
    if (!R.current.sub) return;
    for (const [k, g] of Object.entries(R.current.sub)) g.visible = vis[k];
  }, [vis]);

  const SUBS = [
    ["frame", "Frame + plates"], ["cracking", "Rollers + carriages"], ["adjustment", "Gap adjustment"],
    ["drive", "Drive + sync"], ["feeding", "Grade bins + queue"], ["sorting", "Sorter + hopper"],
    ["separation", "Separation"], ["guards", "Guards + E-stop"], ["flow", "Flow path overlay"],
  ];

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh", background: "#0e1319", color: "#cfd8e0", fontFamily: "ui-monospace,'SF Mono',Menlo,Consolas,monospace", overflow: "hidden" }}>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0, cursor: "grab" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "baseline", background: "rgba(14,19,25,0.78)", borderBottom: "1px solid #26303b", pointerEvents: "none" }}>
          <span style={{ letterSpacing: "0.12em", fontSize: 12, color: "#8fa1b3" }}>PNC-GA · REV C — RESOLVED MATERIAL FLOW</span>
          <span style={{ fontSize: 11, color: "#5d6d7c" }}>drag orbit · scroll zoom · click parts · green arrows = flow</span>
        </div>
        <div style={{ position: "absolute", bottom: 12, left: 14, display: "flex", gap: 6 }}>
          {["iso", "front", "drive", "top"].map((v) => (
            <button key={v} onClick={() => R.current.setView(v)} style={{ padding: "6px 12px", fontFamily: "inherit", fontSize: 11, cursor: "pointer", background: "rgba(18,24,32,0.85)", color: "#8fa1b3", border: "1px solid #2c3844", borderRadius: 4 }}>{v.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div style={{ width: 312, flexShrink: 0, borderLeft: "1px solid #26303b", padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", background: "#121820" }}>
        <button onClick={() => setRunning(!running)} style={{ padding: "10px 0", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer", background: running ? "#26333f" : "#f2913d", color: running ? "#7fc98f" : "#141a21", border: running ? "1px solid #7fc98f" : "none", borderRadius: 4 }}>
          {running ? "RUNNING · 36 rpm" : "RUN MACHINE"}
        </button>
        <div style={{ fontSize: 10.5, color: "#8fa1b3", lineHeight: 1.55, border: "1px dashed #3a4a5a", borderRadius: 4, padding: "8px 10px" }}>
          <b style={{ color: "#f2913d" }}>REV C ARCHITECTURE:</b> continuous grading fills three buffer bins; the cracker runs ONE grade at a time from its bin at the matching gap. Gate interlock bar makes opening two bins physically impossible.
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 4 }}>
            EXPLODED VIEW {explode > 0 && <span style={{ color: "#f2913d" }}>· motion paused</span>}
          </div>
          <input type="range" min={0} max={1} step={0.01} value={explode} onChange={(e) => setExplode(+e.target.value)} style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Explode assembly" />
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 4 }}>ROLLER GAP — {gap} mm (set per grade)</div>
          <input type="range" min={10} max={27} step={1} value={gap} onChange={(e) => setGap(+e.target.value)} style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Roller gap" />
        </div>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>SUBSYSTEMS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {SUBS.map(([k, label]) => (
              <button key={k} onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))} style={{ padding: "7px 6px", fontFamily: "inherit", fontSize: 10.5, cursor: "pointer", textAlign: "left", background: vis[k] ? "#1d2833" : "transparent", color: vis[k] ? "#cfd8e0" : "#5d6d7c", border: `1px solid ${vis[k] ? "#3a4a5a" : "#242e38"}`, borderRadius: 4 }}>
                {vis[k] ? "◉ " : "○ "}{label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ border: `1px solid ${picked ? "#f2913d" : "#26303b"}`, borderRadius: 4, padding: "10px 12px", minHeight: 86 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3" }}>PART INSPECTOR</div>
          {picked ? (<>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f2913d", margin: "5px 0 3px" }}>{picked.name}</div>
            <div style={{ fontSize: 11.5, color: "#aeb9c4", lineHeight: 1.5 }}>{picked.desc}</div>
          </>) : (
            <div style={{ fontSize: 11.5, color: "#5d6d7c", marginTop: 6 }}>
              Click any part. New in Rev C: deck skirts, grade bins, interlock bar, queue channel + cover, escapement-pin provision, catch funnel, separation hood.
            </div>
          )}
        </div>
        <div style={{ fontSize: 10, color: "#46525f", lineHeight: 1.6, borderTop: "1px solid #26303b", paddingTop: 10 }}>
          Placeholders pending team measurements: 38 mm lane width (size survey), ~40° chute angles (slide/repose tests), 9 m/s air (terminal velocities), draw-in μ ≥ 0.42 (friction test). Metering gate deleted; pin-escapement provision retained as commissioning fallback.
        </div>
      </div>
    </div>
  );
}

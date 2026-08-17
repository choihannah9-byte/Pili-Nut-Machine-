import React, { useRef, useEffect, useState, useCallback } from "react";
import * as THREE from "three";

/* ================================================================
   PNC-GA — CAD-style assembly model, Pili Nut Cracker Rev B
   Machine coords: mm, y-up, floor at y=0, nip near x=0 / y=330.
   Front of machine = +z (camera default). Drive train at rear (-z).
   ================================================================ */

const GAP0 = 16; // reference gap for base positions

// ---------- materials ----------
const M = {
  steel: () => new THREE.MeshStandardMaterial({ color: 0x9aa3ac, metalness: 0.85, roughness: 0.4 }),
  darkSteel: () => new THREE.MeshStandardMaterial({ color: 0x565e66, metalness: 0.8, roughness: 0.5 }),
  frame: () => new THREE.MeshStandardMaterial({ color: 0x2e6b4f, metalness: 0.25, roughness: 0.65 }), // agricultural green enamel
  galv: () => new THREE.MeshStandardMaterial({ color: 0xb9c2c9, metalness: 0.55, roughness: 0.45 }),
  stainless: () => new THREE.MeshStandardMaterial({ color: 0xd7dde2, metalness: 0.9, roughness: 0.25 }),
  bronze: () => new THREE.MeshStandardMaterial({ color: 0xb0824a, metalness: 0.75, roughness: 0.45 }),
  bearing: () => new THREE.MeshStandardMaterial({ color: 0x3b444d, metalness: 0.4, roughness: 0.7 }),
  guard: () => new THREE.MeshStandardMaterial({ color: 0xe07020, transparent: true, opacity: 0.32, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.95 }),
  chain: () => new THREE.MeshStandardMaterial({ color: 0x30363c, metalness: 0.7, roughness: 0.55 }),
};

// perforated-deck texture
function holeTexture(holePx) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#cfd6db"; g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#5a646c";
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.beginPath();
    g.arc(16 + x * 32 + (y % 2) * 16, 16 + y * 32, holePx, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4, 4);
  return t;
}

function tag(obj, name, desc) { obj.traverse((o) => { o.userData.pname = name; o.userData.pdesc = desc; }); return obj; }

function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
function cyl(r, h, mat, seg = 24) { return new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); }

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
  const pts = [];
  const n = coils * 16;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = t * coils * Math.PI * 2;
    pts.push(new THREE.Vector3(t * len, r * Math.cos(a), r * Math.sin(a)));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  return new THREE.Mesh(new THREE.TubeGeometry(curve, n, tube, 8, false), mat);
}

function pillowBlock(mat) {
  const g = new THREE.Group();
  const base = box(76, 20, 22, mat); base.position.y = -22;
  const body = cyl(24, 22, mat); body.rotation.x = Math.PI / 2;
  const boss = cyl(17, 26, M.steel()); boss.rotation.x = Math.PI / 2;
  g.add(base, body, boss);
  return g;
}

function vChannelSeg(len, width, mat) {
  const g = new THREE.Group();
  const a = box(len, 3, width, mat), b2 = box(len, 3, width, mat);
  a.rotation.x = Math.PI / 5.2; a.position.z = width * 0.36;
  b2.rotation.x = -Math.PI / 5.2; b2.position.z = -width * 0.36;
  g.add(a, b2);
  return g;
}

export default function PiliAssemblyModel() {
  const mountRef = useRef(null);
  const R = useRef({});
  const [gap, setGap] = useState(GAP0);
  const [explode, setExplode] = useState(0);
  const [running, setRunning] = useState(true);
  const [picked, setPicked] = useState(null);
  const [vis, setVis] = useState({
    frame: true, cracking: true, adjustment: true, drive: true,
    feeding: true, sorting: true, separation: true, guards: true,
  });
  const live = useRef({ gap, explode, running });
  useEffect(() => { live.current.gap = gap; }, [gap]);
  useEffect(() => { live.current.explode = explode; }, [explode]);
  useEffect(() => { live.current.running = running; }, [running]);

  useEffect(() => {
    const mount = mountRef.current;
    const W = mount.clientWidth, H = mount.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe4e8); // SolidWorks-style viewport
    const camera = new THREE.PerspectiveCamera(40, W / H, 5, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a9096, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(500, 900, 600); scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe0f0, 0.3); fill.position.set(-600, 300, -400); scene.add(fill);

    const grid = new THREE.GridHelper(2200, 44, 0xb0b8bf, 0xc8cfd5);
    grid.position.y = 0; scene.add(grid);

    // subsystem groups with explode vectors
    const sub = {};
    const mk = (k, ex) => { const g = new THREE.Group(); g.userData.exVec = ex; scene.add(g); sub[k] = g; return g; };
    const Gframe = mk("frame", new THREE.Vector3(0, 0, 0));
    const Gcrack = mk("cracking", new THREE.Vector3(0, 0, 0)); // rollers explode individually
    const Gadj = mk("adjustment", new THREE.Vector3(1.4, 0, 0));
    const Gdrive = mk("drive", new THREE.Vector3(0, 0, -1.6));
    const Gfeed = mk("feeding", new THREE.Vector3(1.2, 0.7, 0));
    const Gsort = mk("sorting", new THREE.Vector3(0, 1.5, 0));
    const Gsep = mk("separation", new THREE.Vector3(-1.1, -0.5, 0));
    const Gguard = mk("guards", new THREE.Vector3(0, 0, 2.2));

    /* ---------------- FRAME ---------------- */
    {
      const fm = M.frame();
      // base rectangle 450 x 350 of 50x50 angle (as square section)
      const rails = [
        box(450, 50, 50, fm), box(450, 50, 50, fm), box(50, 50, 250, fm), box(50, 50, 250, fm),
      ];
      rails[0].position.set(0, 37, 150); rails[1].position.set(0, 37, -150);
      rails[2].position.set(-200, 37, 0); rails[3].position.set(200, 37, 0);
      rails.forEach((r2) => Gframe.add(tag(r2, "Base frame", "50×50×5 MS angle, welded 450×350; carries all subassemblies")));
      // feet
      for (const [fx, fz] of [[-200, 150], [200, 150], [-200, -150], [200, -150]]) {
        const ft = cyl(16, 14, M.rubber()); ft.position.set(fx, 7, fz);
        Gframe.add(tag(ft, "Anti-vibration foot", "Rubber, M10 stud ×4"));
      }
      // side plates 450H x 300W x 10, inner faces z=±55
      for (const zc of [60, -60]) {
        const pl = box(300, 450, 10, fm); pl.position.set(0, 62 + 225, zc);
        Gframe.add(tag(pl, "Side plate", "10 mm MS, 450×300 — milled carriage slot, bearing bolt patterns"));
        // slot indication (dark recess) on adjustable side
        const slot = box(110, 66, 11, M.darkSteel()); slot.position.set(105, 330, zc);
        Gframe.add(tag(slot, "Carriage slot", "Milled slot, gib-lined; guides the adjustable-roller carriage"));
      }
      // cross members
      for (const yc of [520, 300]) {
        const cm = box(40, 40, 110, fm); cm.position.set(-130, yc, 0);
        Gframe.add(tag(cm, "Cross member", "40×40×4 square tube — torsional stiffness between plates"));
      }
      // rear pedestal for reducer/motor
      const ped = box(220, 24, 120, fm); ped.position.set(-40, 300, -232);
      const leg1 = box(40, 240, 40, fm); leg1.position.set(-120, 168, -232);
      const leg2 = box(40, 240, 40, fm); leg2.position.set(60, 168, -232);
      [ped, leg1, leg2].forEach((p) => Gframe.add(tag(p, "Drive pedestal", "Supports worm reducer + motor at shaft height (judgment call — Rev B left mounting unspecified)")));
    }

    /* ---------------- CRACKING (rollers, shafts, fixed bearings) ---------------- */
    const rollerL = new THREE.Group();
    const rollerRAsm = new THREE.Group(); // moves with gap
    {
      const rl = serratedRoller(M.steel()); tag(rl, "Fixed roller", "AISI 1045, Ø150×80, serrated, flame-hardened HRC 45–50");
      rollerL.add(rl);
      const shL = cyl(15, 340, M.darkSteel()); shL.rotation.x = Math.PI / 2; shL.position.z = -35;
      rollerL.add(tag(shL, "Fixed roller shaft", "Ø30 AISI 1045; rear extension carries sync sprocket + coupling"));
      rollerL.position.set(-83, 330, 0);
      Gcrack.add(rollerL);
      for (const zc of [78, -78]) {
        const pb = pillowBlock(M.bearing()); pb.position.set(-83, 330, zc); pb.rotation.y = 0;
        Gcrack.add(tag(pb, "Pillow block UCF206", "Ø30 bore, bolted to side plate (fixed side)"));
      }
      // adjustable side
      const rr = serratedRoller(M.steel()); tag(rr, "Adjustable roller", "Identical to fixed roller; carried on sliding carriages");
      rollerRAsm.add(rr);
      const shR = cyl(15, 340, M.darkSteel()); shR.rotation.x = Math.PI / 2; shR.position.z = -35;
      rollerRAsm.add(tag(shR, "Adjustable roller shaft", "Ø30 AISI 1045; rear extension carries sync sprocket"));
      for (const zc of [78, -78]) {
        const car = box(100, 90, 26, M.darkSteel()); car.position.set(0, 0, zc);
        rollerRAsm.add(tag(car, "Sliding carriage", "25 mm MS block in gibbed plate slot; carries UCF206"));
        const pb = pillowBlock(M.bearing()); pb.position.set(0, 0, zc + 20);
        rollerRAsm.add(tag(pb, "Pillow block UCF206", "Ø30 bore, bolted to carriage (adjustable side)"));
        for (const gy of [52, -52]) {
          const gib = box(120, 10, 8, M.bronze()); gib.position.set(0, gy, zc - 4);
          rollerRAsm.add(tag(gib, "Gib strip", "Bronze-shimmed retainer — stops carriage cocking under 2 kN nip load"));
        }
      }
      rollerRAsm.position.set(83, 330, 0);
      Gcrack.add(rollerRAsm);
      Gcrack.userData.exVec = new THREE.Vector3(0, 0, 0);
      rollerL.userData.exSelf = new THREE.Vector3(-0.8, 0, 0);
      rollerRAsm.userData.exSelf = new THREE.Vector3(0.8, 0, 0);
    }

    /* ---------------- ADJUSTMENT (screws, springs, handwheel, link chain) ---------------- */
    const collarGrp = new THREE.Group();
    {
      for (const zc of [78, -78]) {
        const scr = cyl(6, 150, M.darkSteel()); scr.rotation.z = Math.PI / 2; scr.position.set(190, 330, zc);
        Gadj.add(tag(scr, "Adjustment screw M24×3", "Rigid position reference — one turn = 3 mm; both screws chain-linked"));
        const boss = box(34, 60, 40, M.frame()); boss.position.set(226, 330, zc);
        Gadj.add(tag(boss, "Frame boss + bronze bushing", "M24 thread in bronze — smooth, gall-free adjustment"));
        const spr = spring(16, 66, 7, M.steel()); spr.position.set(140, 330, zc);
        Gadj.add(tag(spr, "Die spring (preload)", "2,000 N total — holds carriage on the stop collar; opens only on overload"));
        const col = cyl(15, 12, M.bronze()); col.rotation.z = Math.PI / 2; col.position.set(118, 330, zc);
        collarGrp.add(tag(col, "Stop collar — HARD STOP", "Sets minimum gap; snap-back returns here, never below"));
        const nut = cyl(14, 10, M.darkSteel(), 6); nut.rotation.z = Math.PI / 2; nut.position.set(246, 330, zc);
        Gadj.add(tag(nut, "M24 locknut", "Locks the setting for the batch"));
      }
      Gadj.add(collarGrp);
      const hw = cyl(34, 10, M.frame()); hw.rotation.z = Math.PI / 2; hw.position.set(262, 330, 78);
      const hub = cyl(8, 26, M.darkSteel()); hub.rotation.z = Math.PI / 2; hub.position.set(262, 330, 78);
      Gadj.add(tag(hw, "Handwheel", "Single adjustment point for both screws"), hub);
      // link chain between screws
      const lc = box(6, 3, 156, M.chain()); lc.position.set(252, 344, 0);
      const lc2 = lc.clone(); lc2.position.y = 316;
      for (const zc of [78, -78]) {
        const sp = cyl(16, 6, M.chain()); sp.rotation.z = Math.PI / 2; sp.position.set(252, 330, zc);
        Gadj.add(tag(sp, "#25 link sprocket", "Ties both screws — no roller skew"));
      }
      Gadj.add(tag(lc, "#25 link chain", "Synchronizes the two adjustment screws"), tag(lc2, "#25 link chain", "Synchronizes the two adjustment screws"));
      // scale plate
      const sc = box(80, 16, 2, M.stainless()); sc.position.set(105, 268, 66);
      Gadj.add(tag(sc, "Gap scale 0–30 mm", "Engraved, pointer on carriage; verified at commissioning"));
    }

    /* ---------------- DRIVE (rear, z = -150 plane) ---------------- */
    const spkL = new THREE.Group(), spkR = new THREE.Group();
    let chainMesh = null;
    const idlers = [];
    {
      const zP = -168;
      for (const [g2, xr] of [[spkL, -83], [spkR, 83]]) {
        const s = cyl(32.4, 9, M.chain(), 16);
        s.rotation.x = Math.PI / 2;
        g2.add(tag(s, "Sync sprocket 16T #40", "PD 65 mm; serpentine chain reverses rotation between the two"));
        g2.position.set(xr, 330, zP);
        Gdrive.add(g2);
      }
      for (const ix of [-55, 55]) {
        const id = cyl(14, 8, M.steel(), 14); id.rotation.x = Math.PI / 2; id.position.set(ix, 446, zP);
        idlers.push(id);
        Gdrive.add(tag(id, "Spring-loaded idler", "Maintains tension + ≥90° wrap across the 17 mm center-distance range"));
      }
      // jaw coupling + reducer + motor
      const jc1 = cyl(22, 16, M.rubber()); jc1.rotation.x = Math.PI / 2; jc1.position.set(-83, 330, -196);
      Gdrive.add(tag(jc1, "Jaw coupling", "Reducer output → fixed roller shaft; ±2° misalignment tolerance"));
      const red = box(95, 95, 85, M.darkSteel()); red.position.set(-83, 330, -252);
      Gdrive.add(tag(red, "Worm gear reducer 40:1", "Self-locking — rollers stop instantly when power is cut; 36 rpm output"));
      const mot = cyl(46, 130, M.frame()); mot.rotation.z = Math.PI / 2; mot.position.set(10, 330, -252);
      const fan = cyl(48, 14, M.darkSteel()); fan.rotation.z = Math.PI / 2; fan.position.set(82, 330, -252);
      Gdrive.add(tag(mot, "Motor 0.5 hp TEFC", "220 V single-phase, 1,440 rpm; direct to reducer input (Rev A belt stage deleted)"), tag(fan, "Motor fan cowl", ""));
      // sorter take-off chain (simplified)
      const tk = box(4, 210, 3, M.chain()); tk.position.set(-118, 435, zP); tk.rotation.z = 0.32;
      Gdrive.add(tag(tk, "Sorter take-off chain", "Step-up ≈1:1.4 from main shaft → sorter eccentric, 40–60 cpm"));
      const ecc = cyl(15, 8, M.steel()); ecc.rotation.x = Math.PI / 2; ecc.position.set(-152, 540, zP);
      Gdrive.add(tag(ecc, "Sorter eccentric sprocket", "Drives deck oscillation off the one motor"));
    }

    // serpentine chain builder (rebuilt when gap changes)
    function buildChain(gapNow) {
      if (chainMesh) { Gdrive.remove(chainMesh); chainMesh.geometry.dispose(); }
      const zP = -168, rs = 32.4, ri = 14;
      const Lx = -83, Rx = 67 + gapNow;
      const P = (cx, cy, r, adeg) => {
        const a = (adeg * Math.PI) / 180;
        return new THREE.Vector3(cx + r * Math.cos(a), cy + r * Math.sin(a), zP);
      };
      const pts = [];
      const arc = (cx, cy, r, a0, a1, n = 14) => {
        for (let i = 0; i <= n; i++) pts.push(P(cx, cy, r, a0 + ((a1 - a0) * i) / n));
      };
      arc(-55, 446, ri, 150, 70, 8);           // idler 1 top
      pts.push(P(Lx, 330, rs, 140));
      arc(Lx, 330, rs, 140, -20, 16);          // over top of left (CW wrap)
      pts.push(P(Rx, 330, rs, 200));
      arc(Rx, 330, rs, 200, 340 - 360, 16);    // under bottom of right (CCW): 200 → -20
      pts.push(P(Rx, 330, rs, -20));
      arc(55, 446, ri, -30, 110, 8);           // idler 2
      const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", 0.05);
      chainMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 220, 3.2, 8, true), M.chain());
      tag(chainMesh, "Serpentine #40 sync chain", "S-path drives the rollers in opposite directions; replaces Rev A's impossible gear pair");
      Gdrive.add(chainMesh);
    }
    buildChain(GAP0);
    R.current.buildChain = buildChain;

    /* ---------------- SORTING (top module) ---------------- */
    const decks = [];
    {
      // support posts from plate tops
      for (const [px, pz] of [[-160, 60], [160, 60], [-160, -60], [160, -60]]) {
        const post = box(30, 90, 30, M.frame()); post.position.set(px, 557, pz);
        Gsort.add(tag(post, "Sorter support post", "Carries the sorting module on the cracker frame"));
      }
      const sframe = box(380, 8, 320, M.frame()); sframe.position.set(0, 606, 0);
      Gsort.add(tag(sframe, "Sorter frame", "Welded MS, oscillates on the eccentric"));
      const specs = [
        [740, 10, "Top deck — 31 mm", "Large nuts retained → large chute"],
        [688, 7, "Middle deck — 25 mm", "Medium nuts retained → medium chute"],
        [636, 5, "Bottom deck — 20 mm", "Small nuts retained; fines fall to drawer"],
      ];
      for (const [yc, hp, nm, ds] of specs) {
        const mat = new THREE.MeshStandardMaterial({ map: holeTexture(hp), metalness: 0.6, roughness: 0.4 });
        const d = box(350, 5, 300, mat);
        d.rotation.z = -0.26; // 15° down toward +x discharge
        d.position.set(0, yc, 0);
        decks.push(d);
        Gsort.add(tag(d, nm, ds + " — 304 SS perforated, 15° incline, 8 mm oscillation"));
      }
      // hopper (4-sided taper)
      const hop = new THREE.Mesh(new THREE.CylinderGeometry(206, 68, 130, 4, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xb9c2c9, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide }));
      hop.rotation.y = Math.PI / 4;
      hop.position.set(0, 862, 0);
      Gsort.add(tag(hop, "Hopper", "GI sheet, 300×300 top, 3–4 kg capacity, 50° walls"));
      // fines drawer
      const fd = box(140, 26, 200, M.galv()); fd.position.set(-90, 592, 0);
      Gsort.add(tag(fd, "Fines drawer", "Debris under 20 mm from the bottom deck"));
    }

    /* ---------------- FEEDING (chutes, manifold, gate, channel) ---------------- */
    {
      // three chutes from +x deck ends down to manifold
      for (const [y0, y1] of [[695, 640], [645, 615], [597, 592]]) {
        const ch = box(70, 4, 60, M.galv());
        ch.rotation.z = -0.7;
        ch.position.set(212, (y0 + y1) / 2 - 12, 0);
        Gfeed.add(tag(ch, "Scalloped chute", "Channels one graded fraction to the Y-manifold without cross-mixing"));
      }
      const man = new THREE.Mesh(new THREE.CylinderGeometry(20, 34, 70, 4, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xd7dde2, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide }));
      man.rotation.y = Math.PI / 4; man.position.set(198, 560, 0);
      Gfeed.add(tag(man, "Y-junction manifold + selector", "3-position rotary gate — releases exactly one grade at a time"));
      const lev = box(6, 44, 6, M.frame()); lev.position.set(224, 578, 0); lev.rotation.z = -0.5;
      Gfeed.add(tag(lev, "Selector lever", "Operator picks the grade matching the gap setting"));
      const gate = box(28, 20, 34, M.stainless()); gate.position.set(186, 512, 0);
      Gfeed.add(tag(gate, "Single-nut metering gate", "Spring-wire gate; prototype first week — rotary pocket wheel is the fallback"));
      // feed channel V, 35° from (176,505) to (10,448)
      const fc = vChannelSeg(190, 46, M.galv());
      fc.rotation.z = 0.61;
      fc.position.set(92, 472, 0);
      Gfeed.add(tag(fc, "Feed channel — 60° V, 35°", "THE orientation mechanism: triangular nut self-seats, seam presented to the nip"));
      const comb = box(3, 26, 40, M.stainless()); comb.position.set(158, 505, 0);
      Gfeed.add(tag(comb, "Anti-jam wire comb", "One nut wide — prevents side-by-side feeding"));
    }

    /* ---------------- SEPARATION ---------------- */
    let screenMesh = null;
    {
      const smat = new THREE.MeshStandardMaterial({ map: holeTexture(3.5), metalness: 0.6, roughness: 0.4 });
      screenMesh = box(210, 4, 300, smat);
      screenMesh.rotation.z = 0.35; // 20° down toward -x
      screenMesh.position.set(-62, 246, 0);
      Gsep.add(tag(screenMesh, "Stage 1 screen — 8 mm", "Only dust passes to waste (Rev A's 18 mm holes discarded kernels); cam-oscillated"));
      const wd = box(150, 30, 220, M.galv()); wd.position.set(-40, 150, 0);
      Gsep.add(tag(wd, "Waste drawer", "Fines under 8 mm; emptied per session"));
      const blw = cyl(26, 40, M.darkSteel()); blw.rotation.z = Math.PI / 2; blw.position.set(-96, 196, 0);
      const noz = box(26, 14, 30, M.darkSteel()); noz.position.set(-122, 196, 0);
      Gsep.add(tag(blw, "Centrifugal blower", "≈9 m/s cross-draft at the drop zone (Rev A's PC fan deleted — no useful pressure)"), tag(noz, "Blower nozzle", ""));
      const binK = box(70, 60, 120, M.galv()); binK.position.set(-172, 60, 0);
      Gsep.add(tag(binK, "Kernel bin", "Product out — kernels fall near-vertical"));
      const binS = box(70, 60, 120, M.galv()); binS.position.set(-256, 60, 0);
      Gsep.add(tag(binS, "Shell bin", "Shell fragments deflected by the air stream; uncracked nuts hand-picked back to hopper"));
    }

    /* ---------------- GUARDS + E-STOP ---------------- */
    {
      const nipG = box(340, 130, 150, M.guard()); nipG.position.set(0, 452, 40);
      Gguard.add(tag(nipG, "Nip guard", "Fixed, tool-removable; feed opening reach-limited per ISO 13857"));
      const chG = box(340, 260, 40, M.guard()); chG.position.set(0, 380, -172);
      Gguard.add(tag(chG, "Chain guard", "Full enclosure over sync train + take-off (replaces Rev A oil-bath box)"));
      const es = cyl(14, 10, new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.5 }));
      es.rotation.z = Math.PI / 2; es.position.set(156, 420, 66);
      const esb = box(30, 30, 8, new THREE.MeshStandardMaterial({ color: 0xf2c811, roughness: 0.6 })); esb.position.set(156, 420, 62);
      Gguard.add(tag(es, "Emergency stop", "Mushroom head at feeding position; worm self-lock = no coast-down"), tag(esb, "E-stop plate", ""));
    }

    // record base positions for explode
    const exParts = [];
    Object.values(sub).forEach((g) => {
      g.userData.base = g.position.clone();
      exParts.push(g);
    });
    rollerL.userData.base = rollerL.position.clone();
    rollerRAsm.userData.base = rollerRAsm.position.clone();

    /* ---------------- camera + orbit ---------------- */
    let theta = 0.72, phi = 1.12, radius = 1350;
    const target = new THREE.Vector3(0, 430, 0);
    function placeCam() {
      camera.position.set(
        target.x + radius * Math.sin(phi) * Math.sin(theta),
        target.y + radius * Math.cos(phi),
        target.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(target);
    }
    placeCam();
    R.current.setView = (v) => {
      if (v === "front") { theta = 0; phi = Math.PI / 2; }
      if (v === "drive") { theta = Math.PI; phi = Math.PI / 2; }
      if (v === "top") { theta = 0; phi = 0.12; }
      if (v === "iso") { theta = 0.72; phi = 1.12; }
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
    const onWheel = (e) => { e.preventDefault(); radius = Math.min(2600, Math.max(500, radius + e.deltaY * 1.2)); placeCam(); };
    renderer.domElement.addEventListener("mousedown", onDown);
    renderer.domElement.addEventListener("touchstart", onDown, { passive: true });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // click-to-identify
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let highlighted = null;
    const onClick = (e) => {
      if (moved > 6) return;
      const r2 = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - r2.left) / r2.width) * 2 - 1;
      mouse.y = -((e.clientY - r2.top) / r2.height) * 2 + 1;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.userData.pname);
      if (highlighted) { highlighted.material.emissive?.setHex(0x000000); highlighted = null; }
      if (hits.length) {
        const o = hits[0].object;
        if (o.material?.emissive) { o.material.emissive.setHex(0x224466); highlighted = o; }
        setPicked({ name: o.userData.pname, desc: o.userData.pdesc });
      } else setPicked(null);
    };
    renderer.domElement.addEventListener("click", onClick);

    /* ---------------- animation ---------------- */
    const clock = new THREE.Clock();
    let raf, t = 0, lastGap = GAP0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const dt = Math.min(clock.getDelta(), 0.05);
      const L = live.current;
      // gap
      if (L.gap !== lastGap) {
        lastGap = L.gap;
        R.current.buildChain(L.gap);
      }
      const dg = L.gap - GAP0;
      rollerRAsm.position.x = rollerRAsm.userData.base.x + dg + (L.explode * rollerRAsm.userData.exSelf.x * 120);
      rollerL.position.x = rollerL.userData.base.x + (L.explode * rollerL.userData.exSelf.x * 120);
      spkR.position.x = 83 + dg;
      collarGrp.position.x = dg;
      // explode
      for (const g of exParts) {
        g.position.copy(g.userData.base).addScaledVector(g.userData.exVec, L.explode * 160);
      }
      // running motion
      if (L.running && L.explode < 0.05) {
        t += dt;
        const w = (36 * Math.PI * 2) / 60;
        rollerL.children[0].rotation.z -= w * dt;
        rollerRAsm.children[0].rotation.z += w * dt;
        spkL.rotation.z -= w * dt;
        spkR.rotation.z += w * dt;
        idlers.forEach((id) => (id.rotation.z += w * 2.3 * dt));
        const osc = Math.sin(t * 5.2) * 4;
        decks.forEach((d) => (d.position.x = osc));
        screenMesh.position.x = -62 + Math.sin(t * 3.8) * 3;
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

  // subsystem visibility
  useEffect(() => {
    if (!R.current.sub) return;
    for (const [k, g] of Object.entries(R.current.sub)) g.visible = vis[k];
  }, [vis]);

  const SUBS = [
    ["frame", "Frame + plates"], ["cracking", "Rollers + carriages"], ["adjustment", "Gap adjustment"],
    ["drive", "Drive + sync chain"], ["feeding", "Feed + manifold"], ["sorting", "Sorter + hopper"],
    ["separation", "Screen + bins"], ["guards", "Guards + E-stop"],
  ];

  return (
    <div style={{
      display: "flex", width: "100%", height: "100vh", background: "#0e1319",
      color: "#cfd8e0", fontFamily: "ui-monospace,'SF Mono',Menlo,Consolas,monospace", overflow: "hidden"
    }}>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mountRef} style={{ position: "absolute", inset: 0, cursor: "grab" }} />
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, padding: "9px 14px",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          background: "rgba(14,19,25,0.78)", borderBottom: "1px solid #26303b", pointerEvents: "none"
        }}>
          <span style={{ letterSpacing: "0.12em", fontSize: 12, color: "#8fa1b3" }}>PNC-GA · FULL ASSEMBLY MODEL — REV B</span>
          <span style={{ fontSize: 11, color: "#5d6d7c" }}>drag orbit · scroll zoom · click any part to identify</span>
        </div>
        <div style={{ position: "absolute", bottom: 12, left: 14, display: "flex", gap: 6 }}>
          {["iso", "front", "drive", "top"].map((v) => (
            <button key={v} onClick={() => R.current.setView(v)} style={{
              padding: "6px 12px", fontFamily: "inherit", fontSize: 11, cursor: "pointer",
              background: "rgba(18,24,32,0.85)", color: "#8fa1b3", border: "1px solid #2c3844", borderRadius: 4
            }}>{v.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div style={{
        width: 312, flexShrink: 0, borderLeft: "1px solid #26303b", padding: 16,
        display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", background: "#121820"
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setRunning(!running)} style={{
            flex: 1, padding: "10px 0", fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
            background: running ? "#26333f" : "#f2913d", color: running ? "#7fc98f" : "#141a21",
            border: running ? "1px solid #7fc98f" : "none", borderRadius: 4
          }}>{running ? "RUNNING · 36 rpm" : "RUN MACHINE"}</button>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 4 }}>
            EXPLODED VIEW {explode > 0 && <span style={{ color: "#f2913d" }}>· motion paused</span>}
          </div>
          <input type="range" min={0} max={1} step={0.01} value={explode}
            onChange={(e) => setExplode(+e.target.value)}
            style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Explode assembly" />
          <div style={{ fontSize: 10.5, color: "#5d6d7c" }}>slide right to separate subsystems along their assembly directions</div>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 4 }}>ROLLER GAP — {gap} mm</div>
          <input type="range" min={10} max={27} step={1} value={gap}
            onChange={(e) => setGap(+e.target.value)}
            style={{ width: "100%", accentColor: "#f2913d" }} aria-label="Roller gap" />
          <div style={{ fontSize: 10.5, color: "#5d6d7c" }}>
            watch: carriages, stop collars, right sprocket and the serpentine chain all follow the setting
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3", marginBottom: 6 }}>SUBSYSTEMS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {SUBS.map(([k, label]) => (
              <button key={k} onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))} style={{
                padding: "7px 6px", fontFamily: "inherit", fontSize: 10.5, cursor: "pointer", textAlign: "left",
                background: vis[k] ? "#1d2833" : "transparent",
                color: vis[k] ? "#cfd8e0" : "#5d6d7c",
                border: `1px solid ${vis[k] ? "#3a4a5a" : "#242e38"}`, borderRadius: 4
              }}>{vis[k] ? "◉ " : "○ "}{label}</button>
            ))}
          </div>
        </div>

        <div style={{
          border: `1px solid ${picked ? "#f2913d" : "#26303b"}`, borderRadius: 4, padding: "10px 12px", minHeight: 86
        }}>
          <div style={{ fontSize: 11, letterSpacing: "0.14em", color: "#8fa1b3" }}>PART INSPECTOR</div>
          {picked ? (<>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#f2913d", margin: "5px 0 3px" }}>{picked.name}</div>
            <div style={{ fontSize: 11.5, color: "#aeb9c4", lineHeight: 1.5 }}>{picked.desc}</div>
          </>) : (
            <div style={{ fontSize: 11.5, color: "#5d6d7c", marginTop: 6 }}>
              Click any component in the model to see its name and function. Try the stop collar, the serpentine chain, or a gib strip.
            </div>
          )}
        </div>

        <div style={{ fontSize: 10, color: "#46525f", lineHeight: 1.6, borderTop: "1px solid #26303b", paddingTop: 10 }}>
          Built to Rev B proportions (Ø150 rollers, 10–27 mm gap, 450×300 plates, 16T sprockets).
          Judgment calls modeled: screw-with-stop-collar hard stop, rear drive pedestal, feed-side sorter
          discharge, serpentine S-path with top idlers. Concept model — the PNC CAD drawing set remains
          the fabrication reference.
        </div>
      </div>
    </div>
  );
}

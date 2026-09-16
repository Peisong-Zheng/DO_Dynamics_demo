import * as THREE from "three";
import type { TankState } from "../simulation/types";
import {
  BEVEL_SLOPE, CHAMBER_CAPACITY, CHAMBER_RADIUS, CHAMBER_BACK, CHAMBER_END, PIVOT_HEIGHT, REST_ANGLE,
  FEED_X, FEED_Y, FEED_Z, OUTLET, SLOW_OUTLET,
  chamberGeometry, waterSection, rotatePoint, counterweightPosition, rimSpillPoint,
  receivingWaterline, slowLeakPoint, slowLeakWet,
  type Point3,
} from "./tiltingGeometry";
import { isBaffleFitted } from "../simulation/regime";
import { bambooMaterial } from "./bambooMaterials";
import { createPolyhedronMesh, createStream, cylinderBetween, roundedPipePath } from "./meshHelpers";

export interface TankVisual { group: THREE.Group; anchors: {weight:Point3;leak:Point3;outlet:Point3}; update(state: TankState, time: number): void }

const LIP_RISE = 0.42, LIP_FLASH = 1.5, LIP_BLINKS = 3;
const TIP_FLASH = 1.2, TIP_BLINKS = 2;
const LINE_CAPACITY = 320;
const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** Shishi-odoshi form: round bamboo, an open bevel and a separate falling-water source. */
export function createTank(color: number, reducedMotion = false): TankVisual {
  const group = new THREE.Group();
  const body = new THREE.Group(); body.position.y = PIVOT_HEIGHT; group.add(body);
  const bamboo = bambooMaterial(); bamboo.side=THREE.DoubleSide;
  const cut = new THREE.MeshStandardMaterial({color:0xbfac75,roughness:.64,side:THREE.DoubleSide});
  const node = new THREE.MeshStandardMaterial({color:0x8f7c40,roughness:.61});
  const dark = new THREE.MeshStandardMaterial({color:0x3b4144,roughness:.5,metalness:.18});
  const bronze = new THREE.MeshStandardMaterial({color:0x9a8452,roughness:.42,metalness:.52});
  const stone = new THREE.MeshStandardMaterial({color:0xcfcdc8,roughness:.94});
  const stoneLight = new THREE.MeshStandardMaterial({color:0xdedcd7,roughness:.93});
  const bed = new THREE.MeshStandardMaterial({color:0xa9aea8,roughness:.83});
  const glass = new THREE.MeshPhysicalMaterial({color:0xdfe8ec,transparent:true,opacity:.20,roughness:.12,metalness:0,side:THREE.DoubleSide,depthWrite:false});
  const lipMat = new THREE.MeshPhysicalMaterial({color:0xdce8e4,transparent:true,opacity:.35,roughness:.17,side:THREE.DoubleSide,depthWrite:false});
  const water = new THREE.MeshStandardMaterial({color,transparent:true,opacity:.74,roughness:.22,metalness:.03,side:THREE.DoubleSide,depthWrite:false});
  const surfaceMat = new THREE.MeshStandardMaterial({color,transparent:true,opacity:.88,roughness:.20,side:THREE.DoubleSide,depthWrite:false});
  const streamMat = new THREE.MeshStandardMaterial({color,transparent:true,opacity:.86,roughness:.21});
  const lineMat = new THREE.LineBasicMaterial({color:0x9c8f6f,transparent:true,opacity:.85});
  const edgeMat = new THREE.LineBasicMaterial({color:0x9aa3a8,transparent:true,opacity:.75});
  const v = (x:number,y:number,z=0) => new THREE.Vector3(x,y,z);
  const rod = (parent:THREE.Group,a:THREE.Vector3,b:THREE.Vector3,r:number,mat:THREE.Material) => cylinderBetween(parent,a,b,r,mat);
  function ring(parent:THREE.Group,x:number,r:number,tube:number,mat:THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(r,tube,10,56),mat);
    mesh.rotation.y=Math.PI/2; mesh.position.x=x; parent.add(mesh); return mesh;
  }
  function ellipse(parent:THREE.Group,x:number,y:number,z:number,rx:number,rz:number,h:number,mat:THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1,1,h,64),mat);
    mesh.scale.set(rx,1,rz);mesh.position.set(x,y,z);mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  /** Reusable polyline buffers: vessel waterlines, the free-surface outline and
   * the baffle ping all rewrite the same few hundred vertices. */
  function makeLine(parent:THREE.Group,material:THREE.LineBasicMaterial,order:number) {
    const geometry=new THREE.BufferGeometry();
    const attribute=new THREE.Float32BufferAttribute(new Float32Array(LINE_CAPACITY*3),3);
    attribute.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute("position",attribute);
    const line=new THREE.LineLoop(geometry,material);
    line.frustumCulled=false;line.renderOrder=order;parent.add(line);
    return {line,attribute};
  }
  function updateLine(target:{line:THREE.LineLoop;attribute:THREE.Float32BufferAttribute},points:readonly Point3[],yOffset=0,distances=false) {
    const count=Math.min(points.length,LINE_CAPACITY);
    for(let i=0;i<count;i++)target.attribute.setXYZ(i,points[i].x,points[i].y+yOffset,points[i].z);
    target.attribute.needsUpdate=true;
    target.line.geometry.setDrawRange(0,count);
    target.line.visible=count>=3;
    if(distances)target.line.computeLineDistances();
  }
  /** WebGL ignores linewidth, so the important mark is a band of triangles instead
   * of a hairline: it wraps the vessel as a stripe of the given half width. */
  const BAND_CAPACITY=640;
  function makeBand(material:THREE.Material,order:number,parent:THREE.Group) {
    const geometry=new THREE.BufferGeometry();
    const attribute=new THREE.Float32BufferAttribute(new Float32Array(BAND_CAPACITY*3),3);
    attribute.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute("position",attribute);
    const mesh=new THREE.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=order;parent.add(mesh);
    return {mesh,attribute};
  }
  function updateBand(target:ReturnType<typeof makeBand>,points:readonly Point3[],halfWidth:number,dash?:{on:number;off:number}) {
    const positions=target.attribute.array as Float32Array;
    let index=0;
    const push=(x:number,y:number,z:number)=>{positions[index++]=x;positions[index++]=y;positions[index++]=z;};
    const period=dash?dash.on+dash.off:0;
    for(let i=0;i<points.length&&index+18<=positions.length;i++){
      if(dash&&i%period>=dash.on)continue;
      const a=points[i],b=points[(i+1)%points.length];
      push(a.x-halfWidth,a.y,a.z);push(a.x+halfWidth,a.y,a.z);push(b.x+halfWidth,b.y,b.z);
      push(a.x-halfWidth,a.y,a.z);push(b.x+halfWidth,b.y,b.z);push(b.x-halfWidth,b.y,b.z);
    }
    target.attribute.needsUpdate=true;
    target.mesh.geometry.setDrawRange(0,index/3);
    target.mesh.visible=index>0;
  }
  /** The same ring filled in, so the threshold reads as a level inside the glass
   * volume even at a glancing angle, where a stripe collapses to a hairline. */
  function updateDisc(target:ReturnType<typeof makeBand>,points:readonly Point3[]) {
    const positions=target.attribute.array as Float32Array;
    let index=0;
    const push=(p:Point3)=>{positions[index++]=p.x;positions[index++]=p.y;positions[index++]=p.z;};
    if(points.length>=3){
      const centre=points.reduce((sum,p)=>({x:sum.x+p.x/points.length,y:sum.y+p.y/points.length,z:sum.z+p.z/points.length}),{x:0,y:0,z:0});
      for(let i=0;i<points.length&&index+9<=positions.length;i++){
        push(centre);push(points[i]);push(points[(i+1)%points.length]);
      }
    }
    target.attribute.needsUpdate=true;
    target.mesh.geometry.setDrawRange(0,index/3);
    target.mesh.visible=index>0;
  }

  // Low stone pool: an irregular, quiet setting rather than a machinery bench.
  ellipse(group,.34,.12,0,2.03,.81,.11,stone);
  ellipse(group,.34,.182,0,1.91,.70,.012,bed);
  const poolRim=new THREE.Mesh(new THREE.TorusGeometry(1,.052,10,80),stoneLight);
  poolRim.rotation.x=Math.PI/2;poolRim.scale.set(1.98,.76,1);poolRim.position.set(.34,.20,0);group.add(poolRim);
  for (const [x,z,s] of [[-1.45,.53,.26],[-.86,.70,.19],[1.9,.48,.24]] as const) {
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(1,1),stoneLight);
    rock.position.set(x,.24,z);rock.scale.set(s,s*.45,s*.73);rock.rotation.set(.12,x,.2);rock.castShadow=true;group.add(rock);
  }
  // Two simple bamboo cheeks cradle a fixed axle.
  for (const z of [-.56,.56]) {
    rod(group,v(0,.23,z),v(0,PIVOT_HEIGHT+.09,z),.092,bamboo);
    rod(group,v(-.19,.28,z),v(.22,.28,z),.07,node);
  }
  rod(group,v(0,PIVOT_HEIGHT,-.67),v(0,PIVOT_HEIGHT,.67),.067,dark);
  const axleCap=new THREE.Mesh(new THREE.SphereGeometry(.088,20,12),bronze);
  axleCap.position.set(0,PIVOT_HEIGHT,.70);group.add(axleCap);
  const cam = new THREE.Mesh(new THREE.TorusGeometry(.19,.018,8,30,.90),bronze);
  cam.position.set(0,PIVOT_HEIGHT,.61);cam.rotation.z=-1.55;group.add(cam);
  const latch=new THREE.Mesh(new THREE.BoxGeometry(.12,.045,.065),dark);
  latch.position.set(.13,PIVOT_HEIGHT-.16,.60);group.add(latch);

  // Round tail with a closed natural node; the water compartment begins beyond it.
  rod(body,v(-1.34,0),v(CHAMBER_BACK,0),CHAMBER_RADIUS,bamboo);
  for(const x of [-1.31,-.12,CHAMBER_BACK]) ring(body,x,CHAMBER_RADIUS+.004,.020,node);
  ring(body,-1.345,CHAMBER_RADIUS-.012,.022,cut);
  const backNode=new THREE.Mesh(new THREE.CircleGeometry(CHAMBER_RADIUS-.015,56),cut);
  backNode.rotation.y=-Math.PI/2;backNode.position.x=-1.35;body.add(backNode);
  for(const r of [.21,.30,.39]) ring(body,-1.356,r,.003,node);
  // The calibrated weight is an annular cuff that can slide along this tail.
  const weight = new THREE.Group(); body.add(weight);
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.485,.485,.15,48,1,true),dark);
  cuff.rotation.z=Math.PI/2;weight.add(cuff);
  ring(weight,-.071,.478,.018,bronze);ring(weight,.071,.478,.018,bronze);
  for(const x of [-1.12,-.22]) ring(body,x,CHAMBER_RADIUS+.005,.007,bronze);

  const chamber=chamberGeometry();
  // The chamber is deliberately fully transparent: its volume comes from the
  // double-sided shell, the four generatrices and the end rings, not from paint.
  const shell=createPolyhedronMesh(glass);shell.update(chamber.vertices,chamber.faces);shell.mesh.renderOrder=5;body.add(shell.mesh);
  // A genuine diagonal mouth, edged with the pale end grain of bamboo.
  const mouthOuter=chamber.mouth.map(p=>({x:CHAMBER_END+(p.x-CHAMBER_END)*1.035,y:p.y*1.035,z:p.z*1.035}));
  const mouthVertices=[...chamber.mouth,...mouthOuter];
  const mouthFaces=chamber.mouth.map((_,i)=>[i,(i+1)%chamber.mouth.length,(i+1)%chamber.mouth.length+chamber.mouth.length,i+chamber.mouth.length]);
  const rim=createPolyhedronMesh(cut);rim.update(mouthVertices,mouthFaces);body.add(rim.mesh);
  for(const theta of [0,Math.PI/2,Math.PI,3*Math.PI/2]) {
    const y=CHAMBER_RADIUS*Math.cos(theta),z=CHAMBER_RADIUS*Math.sin(theta);
    body.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(CHAMBER_BACK,y,z),v(CHAMBER_END-BEVEL_SLOPE*y,y,z)]),edgeMat));
  }
  const mouthLine=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(chamber.mouth.map(p=>v(p.x,p.y,p.z))),lineMat);body.add(mouthLine);
  // The retaining lip belongs to the apparatus only while a configuration really
  // has two resting branches, so it is drawn in and out with a short rise from
  // the lower lip of the mouth. The upper aperture always stays open.
  const lip=createPolyhedronMesh(lipMat);lip.mesh.renderOrder=6;body.add(lip.mesh);
  const lipFace=chamber.lip.map((_,i)=>i);
  const lipLowest=Math.min(...chamber.lip.map(p=>p.y)),lipHighest=Math.max(...chamber.lip.map(p=>p.y));
  const lipEdgeMaterial=new THREE.LineBasicMaterial({color:0x87a18b,transparent:true,opacity:.8});
  const lipEdgePositions=new THREE.Float32BufferAttribute(new Float32Array(6),3);
  const lipEdgeGeometry=new THREE.BufferGeometry();lipEdgeGeometry.setAttribute("position",lipEdgePositions);
  const lipEdge=new THREE.Line(lipEdgeGeometry,lipEdgeMaterial);lipEdge.frustumCulled=false;body.add(lipEdge);
  const lipVertex=(p:Point3,growth:number):Point3=>{const y=lipLowest+(p.y-lipLowest)*growth;return{x:CHAMBER_END-BEVEL_SLOPE*y,y,z:p.z};};
  const lipRim=chamber.lip.filter(p=>Math.abs(p.y-lipHighest)<1e-8).slice(0,2);
  const lipBoundary=chamber.lip.map(p=>lipVertex(p,1));
  const pingCentre=lipBoundary.reduce((sum,p)=>({x:sum.x+p.x/lipBoundary.length,y:sum.y+p.y/lipBoundary.length,z:sum.z+p.z/lipBoundary.length}),{x:0,y:0,z:0});
  const pingMaterial=new THREE.LineBasicMaterial({color:0xbc8544,transparent:true,opacity:0,depthWrite:false});
  const ping=makeLine(body,pingMaterial,8);
  const pingPoints:Point3[]=lipBoundary.map(p=>({...p}));
  function deployLip(progress:number) {
    const growth=easeInOutCubic(progress);
    lip.update(chamber.lip.map(p=>lipVertex(p,growth)),[lipFace]);
    lip.mesh.visible=progress>0.002;
    lipRim.forEach((p,i)=>{const point=lipVertex(p,growth);lipEdgePositions.setXYZ(i,point.x,point.y,point.z);});
    lipEdgePositions.needsUpdate=true;
    lipEdge.visible=progress>0.002;
  }
  function applyLipLook(progress:number,pulse:number) {
    lipMat.opacity=(.35+.5*pulse)*progress;
    lipEdgeMaterial.opacity=(.8+.2*pulse)*progress;
  }
  deployLip(0);applyLipLook(0,0);
  // An underside row of tiny seep pores; the fixed base pore is the active slow leak.
  for(let x=.23;x<2.24;x+=.17) {
    const pore=new THREE.Mesh(new THREE.SphereGeometry(x<.24?.024:.016,8,6),dark);
    pore.position.set(x,-CHAMBER_RADIUS+.012,.085);body.add(pore);
  }
  const poreRing=new THREE.Mesh(new THREE.TorusGeometry(.030,.006,6,20),bronze);
  poreRing.rotation.x=Math.PI/2;poreRing.position.set(.23,-CHAMBER_RADIUS+.010,.085);body.add(poreRing);
  // The bevel tip is left as a plain opening: the controlled flow leaves through
  // the same lower corner, so a separate brass spout only added clutter.

  // Independent fixed supply: one continuous bamboo spout lashed to a post, with
  // rounded bends and a genuinely hollow mouth. No pivot pipes or hidden feed.
  const mastX=FEED_X+.56,mastZ=-.68,armY=FEED_Y+.32,spoutRadius=.098,postTop=armY+.07;
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.122,.152,postTop-.20,24,1),bamboo);
  post.position.set(mastX,(postTop+.20)/2,mastZ);post.castShadow=true;post.receiveShadow=true;group.add(post);
  for(const y of [.58,1.56,2.52]) {
    const collar=new THREE.Mesh(new THREE.TorusGeometry(.156,.010,8,40),node);
    collar.rotation.x=Math.PI/2;collar.position.set(mastX,y,mastZ);group.add(collar);
  }
  for(const y of [armY-.30,armY-.10]) {
    const band=new THREE.Mesh(new THREE.TorusGeometry(.152,.014,8,32),bronze);
    band.rotation.x=Math.PI/2;band.position.set(mastX,y,mastZ);group.add(band);
  }
  const spoutCurve=roundedPipePath([v(mastX,armY-.36,mastZ),v(mastX,armY,mastZ),v(FEED_X,armY,FEED_Z),v(FEED_X,FEED_Y,FEED_Z)],.15);
  const spout=new THREE.Mesh(new THREE.TubeGeometry(spoutCurve,Math.max(30,Math.round(spoutCurve.getLength()*26)),spoutRadius,16,false),bamboo);
  spout.castShadow=true;spout.receiveShadow=true;group.add(spout);
  const spoutBand=new THREE.Mesh(new THREE.TorusGeometry(spoutRadius+.011,.015,8,32),bronze);
  spoutBand.rotation.x=Math.PI/2;spoutBand.position.set(FEED_X,FEED_Y+.19,FEED_Z);group.add(spoutBand);
  const endGrain=new THREE.Mesh(new THREE.TorusGeometry(spoutRadius,.014,8,36),cut);
  endGrain.rotation.x=Math.PI/2;endGrain.position.set(FEED_X,FEED_Y,FEED_Z);group.add(endGrain);
  const bore=new THREE.Mesh(new THREE.CylinderGeometry(spoutRadius*.60,spoutRadius*.56,.12,18,1,true),dark);
  bore.position.set(FEED_X,FEED_Y+.06,FEED_Z);group.add(bore);

  // Waterlines for the tip threshold, the return line and the noise-free
  // receiving equilibrium, drawn on the vessel itself, so how far the surface
  // still is from the threshold is visible rather than read off two numbers.
  // The threshold itself is the emphatic one: a dashed band, not a hairline, in a
  // muted oxide red that stays legible against the bamboo without shouting.
  const thresholdMaterial=new THREE.MeshBasicMaterial({color:0xa15446,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide});
  const thresholdBand=makeBand(thresholdMaterial,7,body);
  const thresholdFillMaterial=new THREE.MeshBasicMaterial({color:0xa15446,transparent:true,opacity:.06,depthWrite:false,side:THREE.DoubleSide});
  const thresholdFill=makeBand(thresholdFillMaterial,6,body);
  const waterlines=[
    new THREE.LineDashedMaterial({color:0xa15446,dashSize:.022,gapSize:.038,transparent:true,opacity:.55,depthWrite:false}),
    new THREE.LineDashedMaterial({color:0x8a9185,dashSize:.014,gapSize:.045,transparent:true,opacity:.80,depthWrite:false}),
  ].map(material=>({material,volume:NaN,...makeLine(body,material,7)}));

  const fluid=createPolyhedronMesh(water);fluid.mesh.renderOrder=3;group.add(fluid.mesh);
  const surfaceEdgeMaterial=new THREE.LineBasicMaterial({color:new THREE.Color(color).multiplyScalar(.5),transparent:true,opacity:.6,depthWrite:false});
  const surfaceEdge=makeLine(group,surfaceEdgeMaterial,4);
  const freeSurface=createPolyhedronMesh(surfaceMat);freeSurface.mesh.renderOrder=4;group.add(freeSurface.mesh);
  const inflow=createStream(group,streamMat),runoff=createStream(group,streamMat);
  const seep=createStream(group,streamMat),controlled=createStream(group,streamMat),spill=createStream(group,streamMat);
  let previousVolume=NaN,previousAngle=NaN,previousThreshold=NaN;
  let lipProgress=0,lipFlash=0,tipFlash=0,previousEvents=0,lastFrame=performance.now();
  const waterlineVolumes=[NaN,NaN,NaN];
  let level=0;
  const poolY=.21;
  const anchors={weight:{x:0,y:0,z:0},leak:{x:0,y:0,z:0},outlet:{x:0,y:0,z:0}};
  return {
    group, anchors,
    update(state) {
      const angle=state.angle;
      // The lip is a configuration feature, so it deploys on its own clock while
      // the rest of the apparatus keeps following the physical state.
      const now=performance.now(),elapsed=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
      const wantLip=isBaffleFitted(state.params)?1:0;
      // A baffle that simply appears is easy to miss, so it announces itself: the
      // lip pulses a few times while one ring expands away from the mouth.
      if(wantLip===1&&lipProgress===0)lipFlash=LIP_FLASH;
      const lipStep=reducedMotion?1:elapsed/LIP_RISE;
      const lipNext=wantLip>lipProgress?Math.min(wantLip,lipProgress+lipStep):Math.max(wantLip,lipProgress-lipStep);
      if(lipNext!==lipProgress){lipProgress=lipNext;deployLip(lipProgress);}
      lipFlash=Math.max(0,lipFlash-elapsed);
      const flash=lipFlash/LIP_FLASH;
      const pulse=reducedMotion?(lipFlash>0?1:0):flash*(.5-.5*Math.cos(2*Math.PI*LIP_BLINKS*(1-flash)));
      applyLipLook(lipProgress,pulse);
      const pingProgress=reducedMotion?1:Math.min(1,(1-flash)*2.2);
      const pingScale=1+.5*pingProgress;
      for(let i=0;i<pingPoints.length;i++){const p=lipBoundary[i];pingPoints[i]={x:pingCentre.x+(p.x-pingCentre.x)*pingScale,y:pingCentre.y+(p.y-pingCentre.y)*pingScale,z:p.z};}
      updateLine(ping,pingPoints);
      pingMaterial.opacity=flash>.003?.5*(1-pingProgress)*Math.min(1,flash*4):0;
      ping.line.visible=ping.line.visible&&pingMaterial.opacity>0;
      body.rotation.z=REST_ANGLE-angle;
      if(state.params.H!==previousThreshold) {weight.position.x=counterweightPosition(state.params.H);previousThreshold=state.params.H;}
      const weightPoint=rotatePoint({x:weight.position.x,y:0,z:0},angle);
      Object.assign(anchors.weight,weightPoint,{y:weightPoint.y+PIVOT_HEIGHT});
      // The three marks only move when the parameter that sets them moves.
      const waterlineLimits=[state.params.H,state.params.hReset,state.params.r/state.params.k];
      if(waterlineLimits[0]!==waterlineVolumes[0]){
        waterlineVolumes[0]=waterlineLimits[0];
        const mark=receivingWaterline(Math.min(waterlineLimits[0],CHAMBER_CAPACITY));
        updateBand(thresholdBand,mark,.020,{on:2,off:1});
        updateDisc(thresholdFill,mark);
      }
      waterlines.forEach((line,i)=>{
        const volume=Math.min(waterlineLimits[i+1],CHAMBER_CAPACITY);
        if(volume===waterlineVolumes[i+1])return;
        waterlineVolumes[i+1]=volume;
        updateLine(line,receivingWaterline(volume),0,true);
      });
      // A real tip is the one moment worth noticing, so the threshold mark blinks
      // and the water outline brightens while the surface crosses it.
      if(state.eventCount>previousEvents)tipFlash=TIP_FLASH;
      previousEvents=state.eventCount;
      tipFlash=Math.max(0,tipFlash-elapsed);
      const tipFade=tipFlash/TIP_FLASH;
      const tipPulse=tipFlash>0?(reducedMotion?1:.5-.5*Math.cos(2*Math.PI*TIP_BLINKS*(1-tipFade))):0;
      thresholdMaterial.opacity=.9-.55*tipPulse;
      thresholdFillMaterial.opacity=.06+.11*tipPulse;
      surfaceEdgeMaterial.opacity=.6+.4*tipPulse;
      if(state.h!==previousVolume||angle!==previousAngle) {
        const section=waterSection(state.h,angle);level=section.level;
        fluid.update(section.vertices,section.faces,PIVOT_HEIGHT);
        freeSurface.update(section.surface,[section.surface.map((_,i)=>i)],PIVOT_HEIGHT);
        updateLine(surfaceEdge,section.surface,PIVOT_HEIGHT);
        previousVolume=state.h;previousAngle=angle;
      }
      const bottomBack=rotatePoint(SLOW_OUTLET,angle),bottomFront=rotatePoint(OUTLET,angle);
      const bottomAtFeed=bottomBack.y+(bottomFront.y-bottomBack.y)*(FEED_X-bottomBack.x)/(bottomFront.x-bottomBack.x);
      const landing=Math.max(level,bottomAtFeed);
      const radius=.008+.044*Math.sqrt(state.q/.3);
      inflow.update({x:FEED_X,y:FEED_Y,z:FEED_Z},{x:FEED_X,y:landing+PIVOT_HEIGHT,z:FEED_Z},radius,state.q>0);
      const floorIntersection=Math.abs(bottomFront.y-bottomBack.y)>1e-9
        ?bottomBack.x+(bottomFront.x-bottomBack.x)*(level-bottomBack.y)/(bottomFront.y-bottomBack.y):FEED_X;
      runoff.update({x:FEED_X,y:bottomAtFeed+PIVOT_HEIGHT+.012,z:FEED_Z},{x:floorIntersection,y:level+PIVOT_HEIGHT+.012,z:FEED_Z},radius*.65,state.q>0&&level<bottomAtFeed);
      const seepPoint=slowLeakPoint(angle),seepWet=slowLeakWet(level,angle);
      Object.assign(anchors.leak,seepPoint,{y:seepPoint.y+PIVOT_HEIGHT});
      Object.assign(anchors.outlet,bottomFront,{y:bottomFront.y+PIVOT_HEIGHT});
      const slowRate=state.params.k*state.h,fastRate=state.params.kappa*state.opening*state.h;
      seep.update({...seepPoint,y:seepPoint.y+PIVOT_HEIGHT},{x:seepPoint.x,y:poolY,z:seepPoint.z},.010+.020*Math.sqrt(slowRate/.16),slowRate>0&&seepWet);
      controlled.update({...bottomFront,y:bottomFront.y+PIVOT_HEIGHT},{x:bottomFront.x,y:poolY,z:0},.008+.125*Math.sqrt(fastRate/8),fastRate>0);
      const rimPoint=rimSpillPoint(angle);
      const spillRate=(state as TankState & {spillRate?:number}).spillRate??0;
      spill.update({...rimPoint,y:rimPoint.y+PIVOT_HEIGHT},{x:rimPoint.x,y:poolY,z:rimPoint.z},.015+.09*Math.sqrt(spillRate),spillRate>1e-8);
    },
  };
}

import type { SimulationView } from "../simulation/types";
import {
  CHAMBER_CAPACITY, CHAMBER_RADIUS, PIVOT_HEIGHT, REST_ANGLE, FEED_X, FEED_Y, FEED_Z,
  OUTLET, SLOW_OUTLET, chamberGeometry, waterSection, rotatePoint,
  counterweightPosition, thresholdForCounterweight, slowLeakPoint, slowLeakWet,
  receivingWaterline, rimSpillPoint, type Point3,
} from "./tiltingGeometry";
import { isBaffleFitted } from "../simulation/regime";
import {createCounterweightControls,type ThresholdChange} from "./counterweightControls";

const SVG_NS="http://www.w3.org/2000/svg";
const yaw=-.18,pitch=Math.atan(7.4/20),S=120,X=195,Y=420;
const project=(p:Point3)=>{
  const x=p.x*Math.cos(yaw)+p.z*Math.sin(yaw),z=-p.x*Math.sin(yaw)+p.z*Math.cos(yaw);
  return {x:X+x*S,y:Y-(p.y*Math.cos(pitch)-z*Math.sin(pitch))*S};
};
const pointsPath=(points:readonly Point3[])=>points.map((p,i)=>{const q=project(p);return `${i?"L":"M"}${q.x.toFixed(2)},${q.y.toFixed(2)}`;}).join(" ")+" Z";
const linePath=(points:readonly Point3[])=>pointsPath(points).replace(/ Z$/u,"");
// Opaque closed meshes must use their projected silhouette: combining every
// front/back face into one SVG path would cancel their winding and erase the fill.
const silhouettePath=(vertices:readonly Point3[])=>{
  const points=vertices.map(project).sort((a,b)=>a.x-b.x||a.y-b.y);
  const cross=(a:{x:number;y:number},b:{x:number;y:number},c:{x:number;y:number})=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const lower:Array<{x:number;y:number}>=[],upper:Array<{x:number;y:number}>=[];
  for(const p of points){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,p)<=0)lower.pop();lower.push(p);}
  for(const p of [...points].reverse()){while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,p)<=0)upper.pop();upper.push(p);}
  return lower.slice(0,-1).concat(upper.slice(0,-1)).map((p,i)=>`${i?"L":"M"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")+" Z";
};
const world=(p:Point3,angle:number)=>{const q=rotatePoint(p,angle);return{...q,y:q.y+PIVOT_HEIGHT};};

export function createFallback(host:HTMLElement,{onThresholdChange}:{onThresholdChange?:ThresholdChange}={}) {
  const root=document.createElement("div");root.className="scene-fallback";
  const notice=document.createElement("div");notice.className="scene-fallback-notice";notice.textContent="2D view · All experiments remain active.";
  host.append(notice,root);
  const controls=createCounterweightControls(host,onThresholdChange);
  const chamber=chamberGeometry(),startX=counterweightPosition(.55),endX=counterweightPosition(1.65);
  const displays=["#267e79","#4a859f"].map((color,index)=>{
    const svg=document.createElementNS(SVG_NS,"svg");svg.setAttribute("viewBox","0 0 600 540");svg.setAttribute("role","img");
    svg.innerHTML=`<defs><linearGradient id="bamboo-gradient-${index}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e3cf92"/><stop offset=".25" stop-color="#c2a867"/><stop offset=".72" stop-color="#b69853"/><stop offset="1" stop-color="#8e7d43"/></linearGradient></defs>
      <ellipse cx="236" cy="402" rx="240" ry="37" fill="#c1c0ae"/><ellipse cx="236" cy="397" rx="229" ry="28" fill="#97a38b"/><ellipse cx="236" cy="394" rx="237" ry="31" fill="none" stroke="#cfcebd" stroke-width="7"/>
      <g data-fixed></g><path data-shell-back fill="#dfe8ec" fill-opacity=".22" stroke="#c3ccd1" stroke-width="1.4"/>
      <path data-tail fill="url(#bamboo-gradient-${index})"/>
      <path data-back-cap fill="#c7b379" stroke="#8e7b3c" stroke-width="3"/>
      <path data-nodes fill="none" stroke="#8e7d44" stroke-width="2"/>
      <path data-water fill="${color}" fill-opacity=".78"/><path data-water-surface fill="${color}" fill-opacity=".91"/>
      <line data-surface stroke="${color}" stroke-width="1.8"/>
      <path data-shell-clear fill="#d4e2c8" fill-opacity=".24"/>
      <path data-mouth fill="none" stroke="#e5d3a1" stroke-width="7"/>
      <path data-lip fill="#d0e1d0" fill-opacity=".40" stroke="#839e85" stroke-width="1.4"/>
      <path data-tip-line fill="#a15446" fill-opacity=".08" stroke="#a15446" stroke-width="2" stroke-dasharray="7 5"/>
      <path data-weight fill="none" stroke="#44533e" stroke-width="15"/><path data-weight-edge fill="none" stroke="#b5a062" stroke-width="3"/>
      <path data-pores fill="none" stroke="#596447" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 12"/>
      <path data-inflow fill="none" stroke="${color}" stroke-linecap="round"/><path data-runoff fill="none" stroke="${color}"/>
      <path data-slow fill="none" stroke="${color}"/><path data-fast fill="none" stroke="${color}"/><path data-spill fill="none" stroke="${color}"/>
      <g data-pivot></g>
      <text data-inflow-label class="fallback-caption" text-anchor="middle">Inflow</text><text data-q text-anchor="middle" class="fallback-small"></text>
      <text data-weight-label text-anchor="middle">Drag weight</text>
      <text x="167" y="327" text-anchor="middle" class="fallback-small">Pivot</text>
      <path data-slow-leader fill="none" stroke="#91a08d" stroke-width="1"/>
      <text x="203" y="442" text-anchor="middle">Slow leak</text>
      <text data-opening x="402" y="439" text-anchor="middle"></text><text data-flow x="402" y="460" text-anchor="middle" class="fallback-small"></text>`;
    root.append(svg);
    const get=(name:string)=>svg.querySelector(`[data-${name}]`)!;
    const pipe=(a:Point3,b:Point3,width:number,stroke:string)=>`<path d="${linePath([a,b])}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
    const mastX=FEED_X+.56,mastZ=-.68,armY=FEED_Y+.32;
    // One bent spout with round joints, matching the rounded pipe used in 3D.
    get("fixed").innerHTML=pipe({x:mastX,y:.23,z:mastZ},{x:mastX,y:armY+.07,z:mastZ},29,"#b8a060")
      +`<path d="${linePath([{x:mastX,y:armY,z:mastZ},{x:FEED_X,y:armY,z:FEED_Z},{x:FEED_X,y:FEED_Y,z:FEED_Z}])}" stroke="#c3aa69" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
      +[-.56,.56].map(z=>pipe({x:0,y:.23,z},{x:0,y:PIVOT_HEIGHT+.08,z},19,"#b8a060")).join("");
    const pivot=project({x:0,y:PIVOT_HEIGHT,z:.70});get("pivot").innerHTML=`<circle cx="${pivot.x}" cy="${pivot.y}" r="8" fill="#8e7745"/><circle cx="${pivot.x}" cy="${pivot.y}" r="3" fill="#d8c58b"/>`;
    const inletLabel=project({x:FEED_X-.06,y:FEED_Y+.35,z:0});get("inflow-label").setAttribute("x",String(inletLabel.x));get("inflow-label").setAttribute("y",String(inletLabel.y));get("q").setAttribute("x",String(inletLabel.x));get("q").setAttribute("y",String(inletLabel.y+21));
    let lastAngle=NaN,lastVolume=NaN,lastH=NaN,lastLineAngle=NaN,waterlineVolume=NaN;
    let waterlinePoints:Point3[]=[];
    let section=waterSection(.7,0),weightX=counterweightPosition(index?1:.75);
    return{svg,get,update(state:SimulationView["tanks"][number]){
      const angle=state.angle;
      if(state.h!==lastVolume||angle!==lastAngle){section=waterSection(state.h,angle);lastVolume=state.h;}
      if(state.params.H!==lastH){weightX=counterweightPosition(state.params.H);lastH=state.params.H;}
      if(angle!==lastAngle){
        const verts=chamber.vertices.map(p=>world(p,angle));
        const back:number[][]=[],clear:number[][]=[];
        chamber.faces.forEach((f,i)=>{const z=f.reduce((sum,j)=>sum+chamber.vertices[j].z,0)/f.length;(i===0||z<-.16?back:clear).push(f);});
        get("shell-back").setAttribute("d",back.map(f=>pointsPath(f.map(j=>verts[j]))).join(" "));
        get("shell-clear").setAttribute("d",clear.map(f=>pointsPath(f.map(j=>verts[j]))).join(" "));
        const circles=(x:number,r=CHAMBER_RADIUS)=>Array.from({length:40},(_,i)=>world({x,y:r*Math.cos(i*Math.PI/20),z:r*Math.sin(i*Math.PI/20)},angle));
        const a=circles(-1.34),b=circles(.1);get("tail").setAttribute("d",silhouettePath([...a,...b]));
        get("back-cap").setAttribute("d",pointsPath(circles(-1.345)));
        get("nodes").setAttribute("d",[-1.31,-.12,.1].map(x=>pointsPath(circles(x,.444))).join(" "));
        get("mouth").setAttribute("d",pointsPath(chamber.mouth.map(p=>world(p,angle))));
        get("lip").setAttribute("d",pointsPath(chamber.lip.map(p=>world(p,angle))));
        get("pores").setAttribute("d",linePath([world({x:.23,y:-.428,z:.085},angle),world({x:2.2,y:-.428,z:.085},angle)]));
        lastAngle=angle;
      }
      const waterVertices=section.vertices.map(p=>({...p,y:p.y+PIVOT_HEIGHT}));
      get("water").setAttribute("d",silhouettePath(waterVertices));
      get("water-surface").setAttribute("d",pointsPath(section.surface.map(p=>({...p,y:p.y+PIVOT_HEIGHT}))));
      const surfaceX=section.surface.map(p=>p.x),y=section.level+PIVOT_HEIGHT;
      const left=project({x:Math.min(...surfaceX),y,z:0}),right=project({x:Math.max(...surfaceX),y,z:0});
      // The centre-line is explicitly horizontal in world coordinates; the filled
      // polygon also shows the depth of the same horizontal free surface.
      get("surface").setAttribute("x1",String(left.x));get("surface").setAttribute("x2",String(right.x));get("surface").setAttribute("y1",String((left.y+right.y)/2));get("surface").setAttribute("y2",String((left.y+right.y)/2));
      get("surface").setAttribute("data-world-level",String(section.level));
      const weightCircle=(x:number,r:number)=>Array.from({length:40},(_,i)=>world({x,y:r*Math.cos(i*Math.PI/20),z:r*Math.sin(i*Math.PI/20)},angle));
      get("weight").setAttribute("d",pointsPath(weightCircle(weightX,.479)));
      get("weight-edge").setAttribute("d",pointsPath(weightCircle(weightX-.07,.49))+pointsPath(weightCircle(weightX+.07,.49)));
      const weightPoint=world({x:weightX,y:0,z:0},angle),weightLabel=project({...weightPoint,y:weightPoint.y+.67});
      get("weight-label").setAttribute("x",String(weightLabel.x));get("weight-label").setAttribute("y",String(weightLabel.y));
      const back=rotatePoint(SLOW_OUTLET,angle),front=rotatePoint(OUTLET,angle);
      const bottom=back.y+(front.y-back.y)*(FEED_X-back.x)/(front.x-back.x),landing=Math.max(section.level,bottom);
      get("inflow").setAttribute("d",linePath([{x:FEED_X,y:FEED_Y,z:FEED_Z},{x:FEED_X,y:landing+PIVOT_HEIGHT,z:FEED_Z}]));get("inflow").setAttribute("stroke-width",String(1.7+6*Math.sqrt(state.q/.3)));
      const floorX=Math.abs(front.y-back.y)>1e-9?back.x+(front.x-back.x)*(section.level-back.y)/(front.y-back.y):FEED_X;
      get("runoff").setAttribute("d",state.q>0&&section.level<bottom?linePath([{x:FEED_X,y:bottom+PIVOT_HEIGHT,z:0},{x:floorX,y:section.level+PIVOT_HEIGHT,z:0}]):"");get("runoff").setAttribute("stroke-width","3");
      const seep=slowLeakPoint(angle),rim=rimSpillPoint(angle),drip=slowLeakWet(section.level,angle);
      for(const [name,p,rate] of [["slow",seep,state.params.k*state.h],["fast",front,state.params.kappa*state.opening*state.h],["spill",rim,state.spillRate]] as const){const flowing=rate>1e-9&&(name!=="slow"||drip);get(name).setAttribute("d",flowing?linePath([{...p,y:p.y+PIVOT_HEIGHT},{x:p.x,y:.21,z:p.z}]):"");get(name).setAttribute("stroke-width",String(name==="slow"?2+2*Math.sqrt(rate/.16):2+15*Math.sqrt(rate)));}
      const seepEnd=project({x:seep.x,y:.27,z:0});get("slow-leader").setAttribute("d",`M 211 423 L ${seepEnd.x} ${seepEnd.y}`);
      // The retaining baffle is an apparatus fitting: it follows the throttled
      // outlet, not the current balance, so the threshold slider cannot move it.
      get("lip").setAttribute("data-deployed",String(isBaffleFitted(state.params)));
      // The tipping threshold is marked on the vessel; the return line and the
      // equilibria stay in the plots so the trough keeps one clean level.
      const volume=Math.min(state.params.H,CHAMBER_CAPACITY);
      let linesDirty=angle!==lastLineAngle;
      lastLineAngle=angle;
      if(volume!==waterlineVolume){waterlineVolume=volume;waterlinePoints=receivingWaterline(volume);linesDirty=true;}
      if(linesDirty)get("tip-line").setAttribute("d",waterlinePoints.length>=3?pointsPath(waterlinePoints.map(p=>world(p,angle))):"");
      get("q").textContent=`q ${state.q.toFixed(3)}`;get("opening").textContent=`Outlet · ${state.params.kappa>=4?"wide":"throttled"}`;get("flow").textContent=state.opening>0?`flow ${(state.params.kappa*state.opening*state.h).toFixed(3)}`:"closed";
      svg.dataset.angle=angle.toFixed(6);svg.dataset.bodyAngle=(REST_ANGLE-angle).toFixed(6);svg.dataset.volume=state.h.toFixed(6);
      svg.setAttribute("aria-label",`Reservoir ${index?"B":"A"}: stored water ${state.h.toFixed(3)}, tipping threshold ${state.params.H.toFixed(2)}, bamboo angle ${((REST_ANGLE-angle)*180/Math.PI).toFixed(1)} degrees.`);
      const ctm=svg.getScreenCTM();if(ctm){const hostRect=host.getBoundingClientRect();const screen=(p:Point3)=>{const q=project(p),r=new DOMPoint(q.x,q.y).matrixTransform(ctm);return{x:r.x-hostRect.left,y:r.y-hostRect.top};};controls.update(index as 0|1,{center:screen(weightPoint),railStart:screen(world({x:startX,y:0,z:0},angle)),railEnd:screen(world({x:endX,y:0,z:0},angle)),threshold:state.params.H,thresholdAtFraction:f=>thresholdForCounterweight(startX+(endX-startX)*f)});}
    }};
  });
  return{update(view:SimulationView){displays.forEach((display,index)=>display.update(view.tanks[index]));},dispose(){controls.dispose();notice.remove();root.remove();}};
}

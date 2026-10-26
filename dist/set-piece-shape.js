// Set-piece targets are tactical instructions; the simulator walks players there.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function planSetPiece(kind,team,taker,spot,players) {
  const active=players.filter(p=>!p.sentOff);
  const targets=new Map(active.map(p=>[p.id,{x:p.x,y:p.y}]));
  const own=p=>team===0?p.x:100-p.x;
  const world=x=>team===0?x:100-x;
  const put=(p,x,y)=>targets.set(p.id,{x:world(clamp(x,1,99)),y:clamp(y,3,97)});
  const ours=active.filter(p=>p.team===team&&p!==taker&&!p.keeper);
  const theirs=active.filter(p=>p.team!==team&&!p.keeper);
  const keeper=active.find(p=>p.team!==team&&p.keeper);
  const ballX=team===0?spot.x:100-spot.x;
  const backCover=[],runners=[],wall=[],defensiveSupport=[];
  if(kind==='penalty'){
    // Keep existing spacing, relocating only players who must clear the area.
    active.filter(p=>p!==taker&&!p.keeper).forEach(p=>{
      const x=own(p);
      const inArea=x>83&&p.y>20&&p.y<80;
      const inArc=Math.hypot(x-ballX,p.y-spot.y)<9.15;
      if(inArea||inArc||x>=ballX)put(p,78+(p.number%3)*.8,p.y);
    });
    if(keeper)targets.set(keeper.id,{x:world(100),y:50});
  }else if(kind==='corner'||kind==='freekick'){
    // Three players cover counters; prefer actual defenders and wide backs.
    const protect=ours.slice().sort((a,b)=>(a.originalBaseX??a.baseX)-(b.originalBaseX??b.baseX)).slice(0,Math.min(3,Math.max(1,ours.length-2)));
    protect.forEach(p=>{backCover.push(p.id);put(p,Math.min(48,Math.max(22,p.baseX)),p.baseY);});
    const available=ours.filter(p=>!protect.includes(p));
    const anchor=available.filter(p=>p.role==='Midfielder').sort((a,b)=>a.baseX-b.baseX)[0];
    const dangerous=kind==='corner'||ballX>62;
    if(anchor)put(anchor,dangerous?66:Math.min(60,ballX+8),50);
    const attacking=available.filter(p=>p!==anchor).sort((a,b)=>b.finishing-a.finishing).slice(0,5);
    attacking.forEach((p,i)=>{
      const x=dangerous?82+(i%3)*3:Math.min(76,ballX+12+(i%2)*6);
      const y=attacking.length===1?50:30+i*40/(attacking.length-1);
      put(p,x,y);runners.push(p.id);
    });
    if(dangerous){
      if(keeper)put(keeper,99,50);
      // Keep one forward as an outlet. Everyone else helps with marking or cover.
      const outlet=theirs.slice().sort((a,b)=>b.originalBaseX-a.originalBaseX)[0];
      const recovering=theirs.filter(p=>p!==outlet);
      if(kind==='freekick'){
        const rank=p=>p.role==='Midfielder'?0:p.role==='Attacker'?1:2;
        const wallPlayers=recovering.slice().sort((a,b)=>rank(a)-rank(b)||Math.abs(own(a)-ballX)-Math.abs(own(b)-ballX)).slice(0,3);
        wallPlayers.forEach((p,i)=>{put(p,Math.min(96,ballX+9),spot.y+(i-1)*4);wall.push(p.id);});
      }
      const markers=recovering.filter(p=>!wall.includes(p.id)).sort((a,b)=>a.originalBaseX-b.originalBaseX);
      markers.forEach((p,i)=>{
        const runner=attacking[i%Math.max(1,attacking.length)];
        const mark=runner?targets.get(runner.id):null;
        put(p,mark?Math.min(96,(team===0?mark.x:100-mark.x)+2):85+(i%3)*3,mark?mark.y+(i>=attacking.length?5:0):28+i*6);
        defensiveSupport.push(p.id);
      });
      if(outlet)put(outlet,Math.min(48,own(outlet)),outlet.y);
    }else{
      // Deep free kicks retain the ordinary defensive shape, with midfield cover.
      theirs.filter(p=>p.role==='Midfielder').forEach(p=>{
        put(p,clamp(ballX+20,48,73),p.baseY);
        defensiveSupport.push(p.id);
      });
    }
  }
  // Goal kicks and throw-ins preserve all other players' existing positions.
  const sign=team===0?1:-1;
  targets.set(taker.id,{
    x:clamp(spot.x-(kind==='throwin'?0:sign*4),0,100),
    y:clamp(spot.y+(kind==='corner'?(spot.y<50?4:-4):kind==='throwin'?0:2),0,100)
  });
  return {targets,backCover,runners,wall,defensiveSupport};
}

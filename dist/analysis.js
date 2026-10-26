const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function buildAnalysis(event, teams, roster) {
  const r=event.review;
  if(!r)return {attackTitle:'Event context',defendTitle:'Other team',attackPoints:[event.text],defendPoints:['No positional evidence recorded.'],options:[]};
  const team=r.team??r.attackTeam??event.team??0;
  const actor=r.snapshot.players.find(p=>p.id===r.playerId)??r.snapshot.players.find(p=>p.team===team&&r.player.startsWith('#'+p.number+' ·'));
  const attackers=r.snapshot.players.filter(p=>p.team===team);
  const defenders=r.snapshot.players.filter(p=>p.team!==team);
  const profile=p=>roster.find(o=>o.id===p.id);
  const progress=p=>team===0?p.x:100-p.x;
  const scoring=p=>{
    const finishing=profile(p)?.finishing??.5;
    const pressure=defenders.filter(o=>o.number!==1&&dist(o,p)<13).length;
    return clamp(.08+finishing*.38+(1-dist(p,{x:team===0?100:0,y:50})/100)*.18-pressure*.055-Math.abs(p.y-50)/100+(r.counterBonus??0),.03,.88);
  };
  const sequence=(r.sequence??[]).filter(e=>e.team===team);
  const passes=sequence.filter(e=>e.type==='pass');
  const lastPass=passes.at(-1);
  const attackPoints=[
    passes.length?passes.slice(-3).map(e=>'#'+e.player+' → #'+e.receiver).join(' · ')+': the recorded passing sequence leading into this moment.':'No completed passing combination was recorded in the preceding 12 seconds.',
    sequence.some(e=>e.type==='dribble')?'#'+sequence.findLast(e=>e.type==='dribble').player+' carried the ball forward and gained ground before this event.':(actor?'#'+actor.number+' reached '+Math.round(progress(actor))+'% of the way toward the opposition end.':'The attacking team retained an option to advance.'),
    event.type==='goal'?(lastPass&&lastPass.receiver===actor?.number?'#'+lastPass.player+' supplied the last completed pass to scorer #'+actor.number+'.':'The scorer finished the move; no verified direct assist is recorded.'):(r.explanation??event.text)
  ];
  const nearest=actor?defenders.filter(p=>p.number!==1).sort((a,b)=>dist(a,actor)-dist(b,actor))[0]:null;
  const defendPoints=[
    nearest?'#'+nearest.number+' was the nearest outfield defender, '+dist(nearest,actor).toFixed(1)+' pitch units from #'+actor.number+' at the decision.':'No nearby outfield defender was recorded.',
    event.type==='foul'||['yellow','red','penalty','freekick'].includes(event.type)?'The challenge stopped the attack but conceded a restart. Staying goal-side and delaying the runner was an alternative.':r.pressure===0?'The attacker had no opponent within 13 pitch units. Closing that space earlier could reduce the shooting estimate.':'The attacker faced '+r.pressure+' nearby opponent(s). The defence could hold its shape and avoid committing an extra player to the ball.',
    lastPass?'An alternative was to cover the lane from #'+lastPass.player+' to #'+lastPass.receiver+' before the pass arrived; success is not guaranteed.':'An alternative was to protect the central lane and force play toward the touchline.'
  ];
  let options=[];
  if(actor){
    if(r.kind==='penalty'){
      options=[{action:'Take the penalty',probability:r.alternatives[0].probability,detail:'Estimated chance of scoring this penalty.',tone:'positive'}];
    }else{
      options.push({action:r.kind==='freekick'?'Shoot the free kick':'Shoot',probability:r.alternatives[0].probability,detail:'Estimated chance this shot results in a goal.'});
      const mates=attackers.filter(p=>p.id!==actor.id&&p.number!==1);
      const forward=mates.filter(p=>progress(p)>progress(actor)).sort((a,b)=>scoring(b)-scoring(a))[0];
      const back=mates.filter(p=>progress(p)<progress(actor)).sort((a,b)=>dist(a,actor)-dist(b,actor))[0]??attackers.find(p=>p.number===1);
      if(forward){
        const completion=clamp(.9-dist(actor,forward)*.004-(defenders.some(d=>dist(d,forward)<10)?.2:0),.15,.95);
        options.push({action:'Pass to #'+forward.number,probability:completion*scoring(forward),detail:Math.round(completion*100)+'% estimated completion, followed by a shot from the receiver. Combined estimated chance of a goal.'});
      }
      if(r.kind==='open')options.push({action:'Dribble forward',probability:clamp(.5+(profile(actor)?.dribbling??.5)*.3-r.pressure*.12,.12,.9)*Math.min(.88,scoring(actor)+.05),detail:'Riskier move: beat the defender while retaining possession, then attempt a shot.',tone:'risky'});
      if(back)options.push({action:'Pass back to #'+back.number,probability:clamp(.9-dist(actor,back)*.004,.15,.95)*scoring(back)*.25,detail:'Safer reset of possession; estimated immediate goal chance after a follow-up shot is lower.',tone:'safe'});
      options=options.slice(0,4);
      options.filter(o=>!o.tone).sort((a,b)=>b.probability-a.probability).slice(0,2).forEach(o=>o.tone='positive');
      const order={positive:0,safe:1,risky:2};
      options.sort((a,b)=>(order[a.tone]??1)-(order[b.tone]??1));
    }
  }
  return {attackTitle:teams[team].name,defendTitle:teams[1-team].name,attackPoints,defendPoints,options};
}

// Calculate answers from the WHOLE time-filtered match, not just retrieved snippets.
// An LLM can phrase these facts, but never decides who leads a count.
export function playerAnalysis(events,teams) {
  const players=new Map();let unattributedLosses=0,unattributedFouls=0;
  const row=(team,player)=>{
    if(![0,1].includes(team)||!Number.isInteger(player)||player<1||player>99)return null;
    const key=`${team}-${player}`;
    if(!players.has(key))players.set(key,{team,name:teams[team].name,player,goals:0,shots:0,passes:0,dribbles:0,fouls:0,losses:0,mistakes:0,eventIds:[],mistakeIds:[]});
    return players.get(key);
  };
  for(const e of events) {
    const actor=row(e.team,e.player);
    const metric={pass:'passes',shot:'shots',goal:'goals',dribble:'dribbles'}[e.type];
    if(actor&&metric){actor[metric]++;actor.eventIds.push(e.id);}
    if(['turnover','tackle','throwin'].includes(e.type)) {
      // Older page sessions may lack structured attribution. Recover only
      // unambiguous literal simulator wording, never guess an intercepted passer.
      const legacy=e.type==='tackle'?e.text.match(/wins the ball directly from #(\d+)/i):e.type==='throwin'?e.text.match(/heavy touch by #(\d+)/i):null;
      const loser=row(e.lostTeam??(legacy&&[0,1].includes(e.team)?1-e.team:null),e.lostPlayer??(legacy?Number(legacy[1]):null));
      if(loser){loser.losses++;loser.mistakes++;loser.mistakeIds.push(e.id);}
      else unattributedLosses++;
    }
    if(e.type==='foul') {
      const legacy=e.text.match(/^(?:Handball|Foul)!\s*#(\d+)/i);
      const offender=row(e.offenderTeam??([0,1].includes(e.team)?1-e.team:null),e.offender??(legacy?Number(legacy[1]):null));
      if(offender){offender.fouls++;offender.mistakes++;offender.mistakeIds.push(e.id);}
      else unattributedFouls++;
    }
  }
  return {players:[...players.values()],unattributedLosses,unattributedFouls};
}

export function answerQuestion(question,analysis,stats) {
  const q=String(question).toLowerCase();
  const ranking=/most|more|top|highest|worst/.test(q);
  let metric=null;
  if(ranking&&/dribbl|carr(?:y|ies|ied)/.test(q))metric='dribbles';
  else if(ranking&&/mistakes?|errors?|worst/.test(q))metric='mistakes';
  else if(ranking&&/fouls?/.test(q))metric='fouls';
  else if(ranking&&/lost|losses|dispossess|turnovers?/.test(q))metric='losses';
  else if(ranking&&/goals?|scor/.test(q))metric='goals';
  else if(ranking&&/shots?|shoot/.test(q))metric='shots';
  else if(ranking&&/passes?|passing/.test(q))metric='passes';
  if(/accuracy|on target|off target|backward|backwards|forward passes|fastest|distance run|likely|chance|probability/.test(q))metric=null;
  const definition='Mistakes here means recorded possession losses plus committed fouls. Missed shots and cards are not counted again as separate mistakes; this is not an overall player rating.';
  if(!metric) {
    if(/(?:what|current|tell).*(?:score)|who.*winning|winning.*team/.test(q))return {intent:'score',lead:`${stats[0].name} ${stats[0].score}–${stats[1].score} ${stats[1].name}.`,detail:'The score is calculated from recorded goals.',eventIds:[],status:'supported'};
    if(/(?:fastest|speed|distance run|tired|fatigue|injur)/.test(q))return {intent:'unavailable',lead:"I can't answer that reliably: this match feed doesn't include the measurements needed.",detail:'The available evidence covers recorded events, not measured player fitness or physical performance.',eventIds:[],status:'insufficient'};
    return null;
  }
  const unknown=metric==='mistakes'?analysis.unattributedLosses+analysis.unattributedFouls:metric==='losses'?analysis.unattributedLosses:metric==='fouls'?analysis.unattributedFouls:0;
  const teamQuestion=/\b(?:team|side|club)\b/.test(q)&&!(/\bplayer\b/.test(q));
  const rows=teamQuestion?stats.map((t,team)=>{
    const members=analysis.players.filter(p=>p.team===team);
    return {team,name:t.name,player:null,[metric]:(metric==='goals'?t.score:t[metric])??members.reduce((n,p)=>n+p[metric],0),losses:members.reduce((n,p)=>n+p.losses,0),fouls:members.reduce((n,p)=>n+p.fouls,0),eventIds:members.flatMap(p=>p.eventIds),mistakeIds:members.flatMap(p=>p.mistakeIds)};
  }):analysis.players;
  const entries=rows.filter(p=>teamQuestion||p[metric]>0).sort((a,b)=>b[metric]-a[metric]||a.team-b.team||(a.player||0)-(b.player||0));
  const label={mistakes:'recorded mistakes',fouls:'committed fouls',losses:'recorded possession losses',goals:'goals',shots:'shots',passes:'completed passes',dribbles:'recorded dribbles'}[metric];
  if(!entries.length)return {intent:metric,lead:unknown?"I can't rank players reliably yet: the earlier incidents don't identify who was responsible.":`No ${label} have been recorded so far.`,
    detail:metric==='mistakes'?definition:'This answer uses the recorded events up to the requested moment.',eventIds:[],status:unknown?'insufficient':'supported'};
  const max=entries[0][metric],leaders=entries.filter(p=>p[metric]===max);
  const names=leaders.slice(0,3).map(p=>p.player?`#${p.player} of ${p.name}`:p.name).join(', ');
  let lead=leaders.length===1?`${names} has the most ${label}: ${max}.`:
    leaders.length<=3?`${names} are tied for the most ${label}, with ${max} each.`:`${leaders.length} players are tied for the most ${label}, with ${max} each.`;
  if(teamQuestion&&rows.length===2)lead+=` ${rows.map(r=>r.name+': '+r[metric]).join('; ')}.`;
  if(metric==='mistakes'&&leaders.length===1)lead+=` That's ${leaders[0].losses} possession ${leaders[0].losses===1?'loss':'losses'} and ${leaders[0].fouls} committed ${leaders[0].fouls===1?'foul':'fouls'}.`;
  if(unknown)lead=`Among incidents attributed to a player, ${lead.charAt(0).toLowerCase()+lead.slice(1)}`;
  const detail=(metric==='mistakes'?definition:'Counts include every recorded event up to this moment.')+(unknown?` ${unknown} earlier incidents have no player attribution, so this ranking is incomplete.`:'');
  return {intent:metric,lead,detail,status:unknown?'limited':'supported',leaders:leaders.map(p=>({team:p.team,player:p.player,value:max})),
    eventIds:[...new Set(leaders.flatMap(p=>metric==='mistakes'||metric==='losses'||metric==='fouls'?p.mistakeIds:p.eventIds))]};
}

export function narrativeOutline(events,selectedEventId=null,mode='commentary') {
  if(mode==='question'||!events.length)return [];
  const end=events.at(-1).elapsed;
  const goals=events.filter(e=>e.type==='goal');
  const selected=events.find(e=>e.id===selectedEventId);
  const recentGoal=events.at(-1).type==='fulltime'?goals.at(-1):goals.filter(e=>end-e.elapsed<=20).at(-1);
  const action=events.filter(e=>['shot','goal','foul','red','throwin','corner','tackle','pass'].includes(e.type)).at(-1);
  const anchor=selected||recentGoal||action;
  if(!anchor)return [];
  if(mode==='recap'||(mode==='commentary'&&!selected)) {
    const important=events.filter(e=>['goal','red','foul','shot'].includes(e.type));
    const samples=[important[0],...goals,important.find(e=>e.type==='red'),important.find(e=>e.type==='foul'),important.at(-1)].filter(Boolean);
    return [...new Map(samples.map(e=>[e.id,e])).values()].sort((a,b)=>events.indexOf(a)-events.indexOf(b));
  }
  const index=events.indexOf(anchor);
  let boundary=0;
  for(let i=index-1;i>=0;i--)if(['kickoff','goal','turnover','tackle'].includes(events[i].type)){boundary=i+1;break;}
  const buildup=events.slice(boundary,index).filter(e=>e.team===anchor.team&&['pass','dribble'].includes(e.type)&&anchor.elapsed-e.elapsed<=8).slice(-2);
  const output=[...buildup,anchor];
  if(anchor.type==='shot') {
    // Pair a shot only with its immediately following outcome, never another attack.
    const next=events[index+1];if(next&&['goal','save','goalkick','corner','wide'].includes(next.type))output.push(next);
  }
  if(anchor.type==='goal'&&!selected) {
    const response=events.slice(index+1).filter(e=>e.type==='shot'&&e.team!==anchor.team).at(-1);
    if(response)output.push(response);
  }
  return [...new Map(output.map(e=>[e.id,e])).values()];
}

// A chronological, calculated RAG document, not an invented match history.
export function matchArc(events,teams,analysis,audience='broadcaster') {
  const claims=[];const score=[0,0];
  const goals=events.filter(e=>e.type==='goal');
  for(const [index,e] of goals.entries()) {
    score[e.team]++;
    const name=teams[e.team].name,other=teams[1-e.team].name;
    const when=Math.floor(e.elapsed);
    let text;
    if(index===0)text=audience==='fan'?`${name} struck first through #${e.player}.`:`The breakthrough came at ${when} minutes: #${e.player} put ${name} ahead.`;
    else if(score[0]===score[1])text=audience==='fan'?`Then #${e.player} brought ${name} level.`:`${name} answered through #${e.player} at ${when} minutes, bringing the scores level.`;
    else if(score[e.team]===score[1-e.team]+1)text=`#${e.player} then put ${name} ahead of ${other}.`;
    else if(score[e.team]>score[1-e.team])text=`#${e.player} added to ${name}'s lead.`;
    else text=`#${e.player} pulled a goal back for ${name}, who still trailed ${other}.`;
    claims.push({text,eventIds:[e.id]});
  }
  if(!goals.length) {
    const shots=events.filter(e=>e.type==='shot');
    if(shots.length)claims.push({text:`Neither side found the net despite efforts from ${[...new Set(shots.map(e=>'#'+e.player+' of '+teams[e.team].name))].slice(0,2).join(' and ')}.`,eventIds:['stats',...shots.slice(0,2).map(e=>e.id)]});
    else claims.push({text:'Neither side produced a recorded shot in the match so far.',eventIds:['stats']});
  }
  const sorted=[...analysis.players].sort((a,b)=>b.dribbles-a.dribbles);
  const carrier=sorted[0];
  if(carrier?.dribbles>0&&audience==='broadcaster')claims.push({text:`Away from the scoreline, #${carrier.player} of ${carrier.name} ${sorted.filter(p=>p.dribbles===carrier.dribbles).length>1?'shared the lead in':'led'} recorded dribbles with ${carrier.dribbles}${carrier.dribbles>1?', repeatedly carrying the ball forward':''}.`,eventIds:['player-facts']});
  const offender=[...analysis.players].sort((a,b)=>b.mistakes-a.mistakes)[0];
  if(offender?.mistakes>=2&&audience==='broadcaster')claims.push({text:`#${offender.player} of ${offender.name} had a harder match in the recorded incidents: ${offender.losses} possession ${offender.losses===1?'loss':'losses'} and ${offender.fouls} committed ${offender.fouls===1?'foul':'fouls'}.`,eventIds:['player-facts']});
  const red=events.find(e=>e.type==='red');
  const foul=events.find(e=>e.type==='foul');
  if(red)claims.push({text:`${teams[red.team].name} also had #${red.player} sent off.`,eventIds:[red.id]});
  else if(foul&&audience==='broadcaster')claims.push({text:'A foul also interrupted play, adding a stoppage to the match story.',eventIds:[foul.id]});
  // Keep both the opening and final goal even in high-scoring simulations.
  const goalClaims=claims.filter(c=>c.eventIds.some(id=>goals.some(e=>e.id===id)));
  const selected=goalClaims.length>3?[goalClaims[0],...goalClaims.slice(-2),...claims.filter(c=>!goalClaims.includes(c))]:claims;
  return selected.slice(0,audience==='fan'?3:5);
}

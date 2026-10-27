import { createHash } from 'node:crypto';
import { cleanCopy } from './copy.mjs';

export const eventOrder=e=>Number(e.id.split('-')[1]);
export function visibleEvents(match,cutoff=match.elapsed,lastOrder=Number.MAX_SAFE_INTEGER) {
  return [...match.events.values()].filter(e=>e.elapsed<=cutoff&&eventOrder(e)<=lastOrder).sort((a,b)=>eventOrder(a)-eventOrder(b));
}

// Short source passages, not model-generated interpretations. Original event IDs
// remain the authority for citations, counts and historical review boundaries.
export function buildPassages(match) {
  const events=visibleEvents(match),docs=[];
  const describe=e=>`${Math.floor(e.elapsed)} minutes. ${[0,1].includes(e.team)?match.teams[e.team].name+': ':''}${e.player?'Player #'+e.player+'. ':''}${e.receiver?'Receiver #'+e.receiver+'. ':''}${e.type}. ${cleanCopy(e.text).slice(0,500)}`;
  const add=(group,kind)=>{
    const first=group[0],last=group.at(-1),text=(kind==='sequence'?'Recorded possession sequence. ':'Recorded event. ')+group.map(describe).join(' ');
    const metadata={matchId:match.id,kind,team:first.team??-1,start:first.elapsed,elapsed:last.elapsed,lastOrder:eventOrder(last),eventIds:JSON.stringify(group.map(e=>e.id))};
    const participant=(team,player)=>{
      if([0,1].includes(team))metadata[`team_${team}`]=true;
      if(player){metadata[`player_${player}`]=true;if([0,1].includes(team))metadata[`team_${team}_player_${player}`]=true;}
    };
    for(const e of group) {
      participant(e.team,e.player);participant(e.team,e.receiver);
      if(e.offender)participant(e.offenderTeam??(e.team===null?null:1-e.team),e.offender);
      if(e.lostPlayer)participant(e.lostTeam,e.lostPlayer);
    }
    const hash=createHash('sha256').update(JSON.stringify({text,metadata})).digest('hex');
    docs.push({id:`${match.id}_${kind}_${first.id}`,text,metadata:{...metadata,hash}});
  };
  events.forEach(e=>add([e],'event'));
  let group=[];
  const flush=()=>{if(group.length>1)add(group,'sequence');group=[];};
  for(const e of events) {
    const boundary=['kickoff','reset','halftime','fulltime'].includes(e.type);
    if(boundary){flush();continue;}
    if(group.length&&(e.team!==group[0].team||e.elapsed-group[0].elapsed>8||group.length>=3||group.map(describe).join(' ').length+describe(e).length>1200))flush();
    group.push(e);
    if(['goal','foul','throwin','corner','goalkick','save','wide','red'].includes(e.type))flush();
  }
  flush();return docs;
}

export function queryScope(match,query,cutoff,lastOrder) {
  const text=query.toLowerCase();
  const named=match.teams.map((t,i)=>{
    const name=t.name.toLowerCase(),escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    if(name==='red'&&/\bred cards?\b/.test(text)&&!/\bred team\b/.test(text))return null;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`,'u').test(text)?i:null;
  }).filter(i=>i!==null);
  const player=text.match(/(?:#|\b(?:player|number)\s+)(\d{1,2})\b/);
  return {matchId:match.id,cutoff,lastOrder,team:named.length===1?named[0]:null,player:player?Number(player[1]):null};
}

export function retrievalQuery(match,request={}) {
  if(request.question?.trim())return request.question.slice(0,500);
  const selected=match.events.get(request.eventId);
  if(selected)return `Explain this football moment and its buildup: ${cleanCopy(selected.text)}`;
  return request.mode==='recap'?'Football match recap: goals, missed chances, possession losses, fouls, cards and player contributions.':'Football match story: key moments, attacking sequences, chances, player contributions and changes in the score.';
}

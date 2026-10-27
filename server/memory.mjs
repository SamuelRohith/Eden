// Match memory is separate from the LLM context window. No events are retrained
// into a model: each request receives a bounded, time-filtered evidence bundle.
import { playerAnalysis, answerQuestion, narrativeOutline, matchArc } from './insights.mjs';
import { cleanCopy } from './copy.mjs';
const clean = (value, max = 1200) => String(value ?? '').slice(0, max);
const number = (value, max = 90) => Math.max(0, Math.min(max, Number(value) || 0));
export class MatchMemory {
  constructor() { this.matches = new Map(); }
  sync(input) {
    const id = clean(input.id, 80);
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id) || !Array.isArray(input.teams) || input.teams.length !== 2 || !Array.isArray(input.events)) throw new Error('Invalid match payload');
    const existing = this.matches.get(id);
    if (!existing && this.matches.size >= 20) this.matches.delete(this.matches.keys().next().value);
    const match = existing || { id, events: new Map(), created: Date.now() };
    const elapsed = number(input.elapsed);
    // A slow sync must never rewind a match already received by another request.
    if (existing && elapsed < match.elapsed) return match;
    match.scenario={league:['Eden Premier Division','Eden Continental League','Eden Community League'].includes(input.scenario?.league)?input.scenario.league:'Eden Premier Division',stakes:['regular','title','survival','derby'].includes(input.scenario?.stakes)?input.scenario.stakes:'regular'};
    match.elapsed = elapsed; match.finished = Boolean(input.finished); match.updated = Date.now();
    match.teams = input.teams.map(t => ({ name: clean(t.name, 28), formation: clean(t.formation, 20),
      ...Object.fromEntries(['score','passes','shots','fouls','tackles','yellows','reds','corners'].map(k => [k, number(t[k], 10000)])),
      possession: number(t.possession, 100) }));
    if (input.events.length > 2000) throw new Error('Too many events');
    for (const e of input.events) {
      if (!/^event-\d+$/.test(String(e.id)) || Number(e.elapsed) > elapsed + .05) continue;
      const prior = match.events.get(e.id);
      if (prior) continue;
      match.events.set(e.id, { id: e.id, type: clean(e.type, 30), elapsed: number(e.elapsed), text: clean(e.text),
        team: e.team === 0 || e.team === 1 ? e.team : null,
        player: number(e.player, 99), receiver: number(e.receiver, 99),
        lostPlayer:e.lostPlayer==null?null:number(e.lostPlayer,99),lostTeam:[0,1].includes(e.lostTeam)?e.lostTeam:null,
        offender:e.offender==null?null:number(e.offender,99),offenderTeam:[0,1].includes(e.offenderTeam)?e.offenderTeam:null,
        pressure: e.pressure == null ? null : number(e.pressure, 22),
        ball: e.ball && Number.isFinite(e.ball.x) && Number.isFinite(e.ball.y) ? { x: number(e.ball.x, 100), y: number(e.ball.y, 100) } : null,
        score: Array.isArray(e.score) ? e.score.slice(0,2).map(v => number(v, 100)) : null });
    }
    this.matches.set(id, match);
    return match;
  }
  get(id) {
    const match = this.matches.get(id);
    if (!match) throw Object.assign(new Error('Start or sync a match first.'), { status: 404 });
    return match;
  }
}

export function makeContext(match, request, retrievedIds = []) {
  const selected = request.eventId ? match.events.get(request.eventId) : null;
  if (request.eventId && !selected) throw Object.assign(new Error('That event is not in this match.'), { status: 404 });
  const cutoff = selected?.elapsed ?? match.elapsed;
  // Restrict by event order as well as clock: foul/card/restart events can share a timestamp.
  const order = e => Number(e.id.split('-')[1]);
  const all = [...match.events.values()].filter(e => e.elapsed <= cutoff && (!selected || order(e) <= order(selected))).sort((a,b) => order(a)-order(b));
  const term = clean(request.question, 500).toLowerCase();
  const words = term.match(/[\p{L}\p{N}#]+/gu) || [];
  const ranked = all.map((e,i) => ({e, score: i / Math.max(1,all.length)
    + words.filter(w => e.text.toLowerCase().includes(w)).length * 2
    + (['goal','red','penalty','counterattack'].includes(e.type) ? 2 : 0)
    + (retrievedIds.includes(e.id) ? 5 : 0)
    + (selected && cutoff-e.elapsed < 8 ? 4 : 0) }));
  const picked = new Map();
  const add = e => { if (e) picked.set(e.id,e); };
  const outline=narrativeOutline(all,selected?.id,request.mode||'question');
  outline.forEach(add);
  // Semantic hits get evidence slots before recency can crowd them out. They
  // are rehydrated from this match's authoritative time-filtered events only.
  for(const id of retrievedIds){if(picked.size>=24)break;add(all.find(e=>e.id===id));}
  // Keep the actual possession chain near a selected moment before filling with other matches.
  if (selected) all.filter(e => cutoff-e.elapsed <= 8).slice(-10).forEach(add);
  else all.slice(-5).forEach(add);
  ranked.sort((a,b) => b.score-a.score).forEach(({e}) => { if(picked.size<12) add(e); });
  add(selected);
  const asEvidence=e=>({id:e.id,elapsed:e.elapsed,team:e.team,player:e.player,receiver:e.receiver,displayText:cleanCopy(e.text),
    text:`${Math.floor(e.elapsed)}′ (match time ${e.elapsed.toFixed(1)}, minute ${Math.ceil(e.elapsed)}): ${e.text}${e.team!==null&&e.player?` [Event actor: #${e.player} of ${match.teams[e.team].name}.]`:''}`,type:e.type});
  const evidence = [...picked.values()].sort((a,b) => order(a)-order(b)).map(asEvidence);
  const score = all.filter(e=>e.type==='goal').reduce((a,e)=>{if(e.team!==null)a[e.team]++;return a;},[0,0]);
  const derived = match.teams.map((t,i) => ({ name:t.name, score:score[i], passes:all.filter(e=>e.type==='pass'&&e.team===i).length,
    shots:all.filter(e=>e.type==='shot'&&e.team===i).length,dribbles:all.filter(e=>e.type==='dribble'&&e.team===i).length, yellowCards:all.filter(e=>e.type==='yellow'&&e.team===i).length,
    redCards:all.filter(e=>e.type==='red'&&e.team===i).length }));
  // Totals are derived at the requested cutoff, rather than leaking full-time stats into old reviews.
  evidence.unshift({id:'stats',type:'statistics',elapsed:cutoff,text:JSON.stringify({asOfMatchMinute:Number(cutoff.toFixed(1)),teams:derived})});
  const analysis=playerAnalysis(all,match.teams);
  evidence.push({id:'player-facts',type:'statistics',elapsed:cutoff,text:JSON.stringify(analysis.players.map(({team,name,player,goals,shots,passes,dribbles,losses,fouls})=>({team:name,player,goals,shots,passes,dribbles,losses,fouls})))});
  const arc=matchArc(all,match.teams,analysis,request.audience||'broadcaster');
  evidence.push({id:'match-arc',type:'statistics',elapsed:cutoff,text:arc.map(c=>c.text).join(' '),eventIds:arc.flatMap(c=>c.eventIds)});
  const stakes={regular:'a regular league fixture',title:'a fictional title-race showdown',survival:'a fictional survival battle',derby:'a fictional local derby'}[match.scenario.stakes];
  evidence.push({id:'scenario',type:'scenario',elapsed:cutoff,text:`Fictional setting: ${match.scenario.league}, ${stakes}. No real league standings or title outcome are known.`});
  const answer=(request.mode||'question')==='question'?answerQuestion(request.question,analysis,derived):null;
  if(answer) {
    evidence.push({id:'answer-facts',type:'statistics',elapsed:cutoff,text:answer.lead+' '+answer.detail,displayText:answer.lead+' '+answer.detail,eventIds:answer.eventIds});
    for(const id of answer.eventIds.slice(-6)){const e=all.find(e=>e.id===id);if(e&&!evidence.some(s=>s.id===id))evidence.push(asEvidence(e));}
  }
  const patterns = [];
  for(let i=0;i<2;i++) {
    const recent = all.filter(e=>e.team===i&&cutoff-e.elapsed<=10);
    const shots = recent.filter(e=>e.type==='shot');
    if(shots.length>=2) patterns.push({label:`${match.teams[i].name}: ${shots.length} shots in the last 10 match minutes.`,eventIds:shots.map(e=>e.id)});
    const wide = recent.filter(e=>e.ball&&(e.ball.y<30||e.ball.y>70)&&['pass','dribble','shot'].includes(e.type));
    if(wide.length>=3) patterns.push({label:`${match.teams[i].name}: ${wide.length} recorded wide-channel actions in the last 10 match minutes.`,eventIds:wide.map(e=>e.id)});
  }
  patterns.slice(0,3).forEach((p,i)=>evidence.push({id:`pattern-${i+1}`,type:'pattern',elapsed:cutoff,text:p.label}));
  const sourceText = selected ? selected.text : all.slice(-1)[0]?.text || 'The match has just started.';
  return { matchId:match.id, asOf:cutoff, selectedEventId:selected?.id??null, finished:!selected&&match.finished,
    mode:request.mode||'question', audience:request.audience==='fan'?'fan':'broadcaster', language:'en',
    favoriteTeam:request.favoriteTeam===0||request.favoriteTeam===1?request.favoriteTeam:null,
    question:clean(request.question,500), teams:match.teams.map(t=>t.name), stats:derived, patterns,
    evidence,arc,scenario:match.scenario, sourceText, eventCount:all.length,answer,outline:outline.map(e=>asEvidence(e)) };
}

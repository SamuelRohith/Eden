// Evidence keeps precise timings and actor metadata. Displayed/spoken copy never does.
export function cleanCopy(value) {
  return String(value??'')
    .replace(/^\s*\d+(?:\.\d+)?[′']\s*(?:\([^)]*\))?\s*:\s*/g,'')
    .replace(/^\s*\d+(?:\.\d+)? match minutes:\s*/i,'')
    .replace(/\[Event actor:[^\]]*\]/gi,'')
    .replace(/\b\d+(?:\.\d+)?%\s+estimated scoring chance\.?/gi,'')
    .replace(/\b(?:Play continues|They are building something here)\.?/gi,'')
    .replace(/\b(?:EVIDENCE|Event actor|match time)\s*:[^.!?]*(?:[.!?]|$)/gi,'')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/\bscored (a[n]? (?:low drive|powerful strike|placed finish|rising shot|curling free kick))\b/gi,'scored with $1')
    .replace(/\s+/g,' ').trim();
}

export function compactEvent(e) {
  return cleanCopy(e?.displayText||e?.text||'').replace(/^GOAL!\s*/,'Goal! ');
}

export function scoreClaim(context) {
  const [home,away]=context.stats;
  const prefix=context.finished?'Full time':'So far';
  return {text:`${prefix}: ${home.name} ${home.score}–${away.score} ${away.name}.`,eventIds:['stats']};
}

export function groundedScript(context) {
  if(!context.selectedEventId&&context.mode!=='question'&&context.arc?.length)return {claims:context.arc,coreId:'match-arc'};
  const outline=context.outline||[];
  const anchor=outline.find(e=>e.id===context.selectedEventId)||outline.find(e=>e.type==='goal')||outline.find(e=>['shot','foul','red','throwin','corner','tackle'].includes(e.type))||outline.at(-1);
  if(!anchor)return null;
  const team=context.teams[anchor.team];
  const before=outline.filter(e=>e.elapsed<anchor.elapsed&&e.team===anchor.team);
  const pass=before.filter(e=>e.type==='pass').at(-1);
  const carry=before.filter(e=>e.type==='dribble').at(-1);
  const claims=[];
  if(pass)claims.push({text:`In the buildup, #${pass.player} of ${team} found #${pass.receiver}.`,eventIds:[pass.id]});
  else if(carry)claims.push({text:`#${carry.player} of ${team} carried the ball forward.`,eventIds:[carry.id]});
  const name=claims.length?`#${anchor.player}`:`#${anchor.player} of ${team}`;
  if(anchor.type==='goal') {
    const style=compactEvent(anchor).match(/finds the net with (a[n]? [^.]+)/i)?.[1];
    claims.push({text:style?`${name} scored with ${style}.`:`${name} scored to finish the move.`,eventIds:[anchor.id]});
    const response=outline.filter(e=>e.type==='shot'&&e.team!==anchor.team&&e.elapsed>anchor.elapsed).at(-1);
    if(response)claims.push({text:`${context.teams[response.team]} later responded with a shot from #${response.player}.`,eventIds:[response.id]});
  }else if(anchor.type==='shot') {
    const style=compactEvent(anchor).match(/attempts (a[n]? [^.]+)/i)?.[1];
    let text=style?`${name} tried ${style}.`:`${name} took a shot.`;
    const outcome=outline.find(e=>e.elapsed>=anchor.elapsed&&['save','goalkick','wide','corner'].includes(e.type));
    if(outcome?.type==='save')text+=' The goalkeeper held it.';
    if(['goalkick','wide'].includes(outcome?.type))text+=' The effort went wide.';
    if(outcome?.type==='corner')text+=' The keeper turned it out for a corner.';
    claims.push({text,eventIds:[anchor.id,...(outcome?[outcome.id]:[])]});
  }else claims.push({text:compactEvent(anchor),eventIds:[anchor.id]});
  return {claims,coreId:anchor.id};
}

export function presentStory(story,context) {
  let claims=story.claims.map(c=>({...c,text:cleanCopy(c.text)})).filter(c=>c.text);
  const factual=groundedScript(context);
  const globalStory=!context.selectedEventId&&context.mode!=='question'&&context.arc?.length;
  const covered=new Set(claims.flatMap(c=>c.eventIds));
  const arcCovered=covered.has('match-arc')||context.arc?.filter(c=>c.eventIds.some(id=>context.evidence.find(e=>e.id===id)?.type==='goal')).every(c=>c.eventIds.some(id=>covered.has(id)));
  if(factual&&((globalStory&&!arcCovered)||(!globalStory&&context.mode!=='question'&&context.mode!=='recap'&&!claims.some(c=>c.eventIds.includes(factual.coreId))))) {
    claims=factual.claims;
    story={...story,provider:'event_summary',runtime:'Grounded match script',validation:'recorded-evidence-only',
      notes:[...story.notes,'The model omitted the key moment; a concise factual script was retained.']};
  }
  if(context.mode==='question'&&context.answer) {
    // Pin the calculated answer before any AI commentary so a rewrite cannot
    // replace a leader, tie, or "insufficient data" with unrelated match events.
    claims=[{text:context.answer.lead,eventIds:['answer-facts']}];
  }
  if(globalStory&&(claims.length<2||story.provider==='event_summary'||(context.audience==='fan'&&claims.map(c=>c.text).join(' ').split(/\s+/).length>55)))claims=context.arc;
  if(globalStory&&context.audience!=='fan'&&!claims.some(c=>c.eventIds.includes('player-facts'))) {
    const contribution=context.arc.find(c=>c.eventIds.includes('player-facts'));
    if(contribution&&!claims.some(c=>/dribbl|possession losses/i.test(c.text)))claims.push(contribution);
  }
  if(globalStory&&context.scenario?.stakes!=='regular') {
    const setting=context.evidence.find(e=>e.id==='scenario');
    if(setting&&!claims.some(c=>c.eventIds.includes('scenario')))claims=[{text:`In this fictional ${context.scenario.league} ${ {title:'title-race showdown',survival:'survival battle',derby:'local derby'}[context.scenario.stakes]}, the match had its own stakes.`,eventIds:['scenario']},...claims];
  }
  if(context.mode==='recap'||(globalStory&&context.finished))claims=[scoreClaim(context),...claims.filter(c=>!c.eventIds.includes('stats')||c.eventIds.length>1||!(/\d+\s*[–-]\s*\d+/).test(c.text))];
  const script=claims.map(c=>c.text).join(' ');
  return {...story,claims,script,spokenText:script,
    answerStatus:context.mode==='question'?context.answer?.status||'generated':null,
    answerDefinition:context.mode==='question'?context.answer?.detail||'':null};
}

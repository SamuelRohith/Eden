import { planSetPiece } from './set-piece-shape.js';
// The simulation owns positions, events and stats. The UI only renders its state.
// Swap this source for a real feed adapter later without changing the pitch UI.
export const FORMATIONS = ['4-3-3', '4-5-1', '4-4-2', '4-2-3-1', '3-5-2'];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const relativeX = (p, team) => team === 0 ? p.x : 100 - p.x;

class CoreSimulator {
  constructor(config, onEvent = () => {}) {
    this.config = config;
    this.onEvent = onEvent;
    this.seed = (config.seed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff))) >>> 0;
    this.rngState = this.seed;
    this.duration = 90;
    this.elapsed = 0;
    this.finished = false;
    this.started = false;
    this.players = [];
    this.ball = { x: 50, y: 50, z: 0 };
    this.teams = config.teams.map((team, index) => ({
      id: index, name: team.name, formation: FORMATIONS.includes(team.formation) ? team.formation : '4-3-3',
      score: 0, passes: 0, shots: 0, possessionSeconds: 0
    }));
    this.events = [];
    this.frames = [];
    this.lastFrameAt = -1;
    this.possession = 0;
    this.possessor = null;
    this.flight = null;
    this.nextAction = 1;
    this.restartAt = null;
    this.phase = .1;
    this.passesThisAttack = 0;
    this.halfTimeEmitted = false;
    this.teams.forEach(team => this.makePlayers(team));
    this.kickoff(0, false);
    this.recordFrame();
  }

  random() {
    this.rngState += 0x6D2B79F5;
    let n = this.rngState;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  }
  range(lo, hi) { return lo + (hi - lo) * this.random(); }
  pick(items) { return items[Math.floor(this.random() * items.length)]; }

  makePlayers(team) {
    const rows = team.formation.split('-').map(Number);
    let number = 1;
    this.players.push({ id: `${team.id}-1`, team: team.id, number: number++, x: team.id === 0 ? 7 : 93, y: 50, baseX: 7, baseY: 50, keeper: true, vx: 0, vy: 0, phase: this.random() * 10 });
    const rowXs = rows.length === 4 ? [24, 41, 61, 78] : [25, 49, 76];
    rows.forEach((count, row) => {
      for (let j = 0; j < count; j++) {
        const baseX = rowXs[row];
        const baseY = count === 1 ? 50 : 15 + 70 * j / (count - 1);
        this.players.push({ id: `${team.id}-${number}`, team: team.id, number: number++, x: team.id === 0 ? baseX : 100 - baseX, y: baseY, baseX, baseY, keeper: false, vx: 0, vy: 0, phase: this.random() * 10 });
      }
    });
  }

  emit(type, text, extra = {}) {
    const event = { id: `event-${this.events.length + 1}`, type, elapsed: this.elapsed, matchClockMs: Math.round(this.elapsed * 60000), text, ...extra };
    this.events.push(event);
    this.onEvent(event);
    return event;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.emit('kickoff', `Kick-off! ${this.teams[0].name} start with the ball. A full match, in 90 seconds.`, { team: 0 });
  }

  kickoff(teamId, reposition = true) {
    this.possession = teamId;
    this.phase = .12;
    this.passesThisAttack = 0;
    this.flight = null;
    this.restartAt = null;
    if (reposition) this.players.forEach(p => { p.x = p.team === 0 ? p.baseX : 100 - p.baseX; p.y = p.baseY; p.vx = 0; p.vy = 0; });
    const midfielders = this.players.filter(p => p.team === teamId && !p.keeper && p.baseX > 35 && p.baseX < 65);
    this.possessor = this.pick(midfielders);
    this.possessor.x = teamId === 0 ? 49 : 51;
    this.possessor.y = 50;
    this.ball.x = this.possessor.x;
    this.ball.y = this.possessor.y;
    this.ball.z = 0;
    this.nextAction = this.elapsed + .65;
  }

  advance(seconds) {
    if (!this.started || this.finished || !Number.isFinite(seconds) || seconds <= 0) return;
    let remaining = Math.min(seconds, this.duration - this.elapsed);
    while (remaining > .000001 && !this.finished) {
      const dt = Math.min(remaining, .04, this.duration - this.elapsed);
      this.step(dt);
      remaining -= dt;
    }
  }

  step(dt) {
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    this.teams[this.possession].possessionSeconds += dt;
    this.movePlayers(dt);
    if (this.restartAt !== null) {
      if (this.elapsed >= this.restartAt) {
        this.kickoff(this.restartTeam);
        this.emit('kickoff', `${this.teams[this.possession].name} restart from the centre.`, { team: this.possession });
      }
    } else if (this.flight) {
      this.moveFlight();
    } else {
      const p = this.possessor;
      this.ball.x = p.x + (p.team === 0 ? 1.1 : -1.1);
      this.ball.y = p.y + .5;
      this.ball.z = Math.abs(Math.sin(this.elapsed * 13)) * .12;
      if (this.elapsed >= this.nextAction && this.elapsed < 89.4) this.nextPlay();
    }
    if (!this.halfTimeEmitted && this.elapsed >= 45) {
      this.halfTimeEmitted = true;
      this.emit('halftime', `Halfway through: ${this.teams[0].name} ${this.teams[0].score}–${this.teams[1].score} ${this.teams[1].name}. The second half is already under way.`);
    }
    if (this.elapsed - this.lastFrameAt >= .199 || this.elapsed >= this.duration - .00001) this.recordFrame();
    if (this.elapsed >= this.duration - .00001) this.finish();
  }

  movePlayers(dt) {
    const ball = this.ball;
    for (const p of this.players) {
      const attacking = p.team === this.possession;
      const lateral = (ball.y - 50) * (attacking ? .12 : .2);
      let ownX = p.baseX + (attacking ? this.phase * 18 - 5 : -this.phase * 15);
      let targetY = p.baseY + lateral + Math.sin(this.elapsed * .65 + p.phase) * 3;
      if (p.keeper) { ownX = 6 + (attacking ? 2 : 0); targetY = 50 + (ball.y - 50) * .19; }
      else if (p === this.possessor && !this.flight && this.restartAt === null) {
        ownX = Math.max(ownX, 42 + this.phase * 43);
        targetY = p.baseY * .7 + 50 * .3 + Math.sin(this.elapsed * .9 + p.phase) * 4;
      } else if (!attacking && !p.keeper) {
        // One nearby defender closes down while the others retain their shape.
        const near = this.players.filter(o => o.team === p.team && !o.keeper).sort((a, b) => distance(a, ball) - distance(b, ball));
        if (p === near[0]) { ownX = relativeX(ball, p.team) - 3; targetY = ball.y + 3; }
      }
      ownX = clamp(ownX, p.keeper ? 4 : 12, p.keeper ? 10 : 93);
      const tx = p.team === 0 ? ownX : 100 - ownX;
      const ty = clamp(targetY, 7, 93);
      const dx = tx - p.x, dy = ty - p.y;
      const len = Math.hypot(dx, dy);
      const speed = Math.min(p.keeper ? 10 : 16, len * 2.3);
      const targetVx = len > .01 ? dx / len * speed : 0;
      const targetVy = len > .01 ? dy / len * speed : 0;
      const smoothing = Math.min(1, dt * 5);
      p.vx += (targetVx - p.vx) * smoothing;
      p.vy += (targetVy - p.vy) * smoothing;
      p.x = clamp(p.x + p.vx * dt, 2, 98);
      p.y = clamp(p.y + p.vy * dt, 4, 96);
    }
  }

  nextPlay() {
    const team = this.teams[this.possession];
    const p = this.possessor;
    if (this.passesThisAttack >= 4 || (this.phase > .64 && this.passesThisAttack >= 2)) {
      this.takeShot();
      return;
    }
    const ownX = relativeX(p, p.team);
    let receivers = this.players.filter(o => o.team === p.team && o !== p && !o.keeper && relativeX(o, p.team) >= ownX - 12);
    if (!receivers.length) receivers = this.players.filter(o => o.team === p.team && o !== p && !o.keeper);
    const target = this.pick(receivers);
    const opponents = this.players.filter(o => o.team !== p.team && !o.keeper).sort((a, b) => distance(a, target) - distance(b, target));
    const intercepted = this.random() < .12 && distance(opponents[0], target) < 19;
    const receiver = intercepted ? opponents[0] : target;
    this.flight = { type: 'pass', team: p.team, from: p, target: receiver, intended: target, intercepted, start: this.elapsed, duration: this.range(.32, .58), fromX: this.ball.x, fromY: this.ball.y };
  }

  moveFlight() {
    const f = this.flight;
    const progress = clamp((this.elapsed - f.start) / f.duration, 0, 1);
    const target = f.type === 'pass' ? f.target : { x: f.toX, y: f.toY };
    this.ball.x = f.fromX + (target.x - f.fromX) * progress;
    this.ball.y = f.fromY + (target.y - f.fromY) * progress;
    this.ball.z = Math.sin(progress * Math.PI) * (f.type === 'shot' ? 1.1 : f.delivery === 'throwin' ? .85 : .45);
    if (progress < 1) return;
    this.flight = null;
    this.ball.z = 0;
    if (f.type === 'pass') {
      this.possessor = f.target;
      if (f.intercepted) {
        this.possession = f.target.team;
        this.phase = .15;
        this.passesThisAttack = 0;
        this.emit('turnover', `#${f.target.number} of ${this.teams[f.target.team].name} intercepts the pass. A chance to break!`, { team: f.target.team, player: f.target.number, lostTeam:f.from.team, lostPlayer:f.from.number });
      } else {
        this.teams[f.team].passes++;
        this.phase = Math.min(.92, this.phase + this.range(.14, .23));
        this.passesThisAttack++;
        this.emit('pass', `#${f.from.number} of ${this.teams[f.team].name} passes to #${f.target.number}${this.passesThisAttack >= 3 ? '. They are building something here.' : '.'}`, { team: f.team, player: f.from.number, receiver: f.target.number });
      }
      this.nextAction = this.elapsed + this.range(.53, 1.03);
    } else this.resolveShot(f);
  }

  takeShot() {
    const p = this.possessor;
    const team = this.teams[p.team];
    team.shots++;
    const roll = this.random();
    const outcome = roll < .38 ? 'goal' : roll < .85 ? 'saved' : 'wide';
    const keeper = this.players.find(o => o.team !== p.team && o.keeper);
    const targetX = outcome === 'saved' ? keeper.x : p.team === 0 ? 99.7 : .3;
    const targetY = outcome === 'saved' ? keeper.y : outcome === 'wide' ? this.pick([34, 66]) : this.range(45, 55);
    this.flight = { type: 'shot', team: p.team, from: p, start: this.elapsed, duration: this.range(.4, .62), fromX: this.ball.x, fromY: this.ball.y, toX: targetX, toY: targetY, outcome, keeper };
    this.emit('shot', `#${p.number} of ${team.name} takes a shot!`, { team: p.team, player: p.number });
  }

  resolveShot(f) {
    const opponent = 1 - f.team;
    if (f.outcome === 'goal') {
      this.teams[f.team].score++;
      this.emit('goal', `GOAL! #${f.from.number} of ${this.teams[f.team].name} shoots the ball into the back of the net!`, { team: f.team, player: f.from.number, score: this.teams.map(t => t.score) });
      this.restartAt = this.elapsed + 1.15;
      this.restartTeam = opponent;
      this.possession = opponent;
    } else {
      this.possession = opponent;
      this.phase = .1;
      this.passesThisAttack = 0;
      this.possessor = f.keeper;
      if (f.outcome === 'saved') this.emit('save', `Saved! #1 of ${this.teams[opponent].name} keeps out #${f.from.number}'s effort.`, { team: opponent, player: 1 });
      else this.emit('wide', `Just wide! #${f.from.number}'s effort misses the target. ${this.teams[opponent].name} have the goal kick.`, { team: f.team, player: f.from.number });
      this.ball.x = f.keeper.x;
      this.ball.y = f.keeper.y;
      this.nextAction = this.elapsed + .7;
    }
  }

  recordFrame() {
    this.lastFrameAt = this.elapsed;
    this.frames.push({ timeSeconds: Number(this.elapsed.toFixed(3)), matchClockMs: Math.round(this.elapsed * 60000), possessionTeam: this.possession,
      ball: { x: this.ball.x, y: this.ball.y, z: this.ball.z },
      players: this.players.map(p => ({ id: p.id, team: p.team, number: p.number, x: p.x, y: p.y, vx: p.vx, vy: p.vy })) });
  }

  getPossession() {
    const total = this.teams.reduce((sum, t) => sum + t.possessionSeconds, 0);
    const home = total ? Math.round(this.teams[0].possessionSeconds / total * 100) : 50;
    return [home, 100 - home];
  }

  finish() {
    if (this.finished) return;
    this.elapsed = this.duration;
    this.finished = true;
    this.flight = null;
    this.emit('fulltime', `Full time! ${this.teams[0].name} ${this.teams[0].score}–${this.teams[1].score} ${this.teams[1].name}. The final whistle brings our 90-second story to a close.`, { score: this.teams.map(t => t.score) });
  }
}


class EventSimulator extends CoreSimulator {
  constructor(config,onEvent) {
    super(config,onEvent);
    this.paused=false; this.pending=null; this.setPiece=null;
    this.teams.forEach(t=>Object.assign(t,{fouls:0,tackles:0,yellows:0,reds:0,corners:0}));
    this.players.forEach(p=>{
      p.role=p.keeper?'Goalkeeper':p.baseX<35?'Defender':p.baseX<70?'Midfielder':'Attacker';
      p.finishing=({Goalkeeper:.12,Defender:.35,Midfielder:.56,Attacker:.79})[p.role]+this.range(-.09,.09);
      p.dribbling=this.range(.4,.85);p.yellowCards=0;p.sentOff=false;p.originalBaseX=p.baseX;p.originalBaseY=p.baseY;
    });
  }
  active(team) { return this.players.filter(p=>p.team===team&&!p.sentOff); }
  chance(p,kind='open') {
    const d=distance(p,{x:p.team===0?100:0,y:50});
    const pressure=this.active(1-p.team).filter(o=>!o.keeper&&distance(o,p)<13).length;
    return clamp(kind==='penalty'?.67+p.finishing*.17:.08+p.finishing*.38+(1-d/100)*.18-pressure*.055-Math.abs(p.y-50)/100-(kind==='freekick'?.07:0),.03,.88);
  }
  review(p=this.possessor,kind='open') {
    if(!p?.role)return null;
    const opponents=this.active(1-p.team);
    const pressure=opponents.filter(o=>!o.keeper&&distance(o,p)<13).length;
    const passes=this.active(p.team).filter(o=>o!==p&&!o.keeper).map(o=>{
      const nearest=Math.min(...opponents.map(d=>distance(d,o)));
      return {o,nearest,value:relativeX(o,p.team)+nearest};
    }).sort((a,b)=>b.value-a.value).slice(0,2).map(({o,nearest})=>({
      action:'Pass to #'+o.number,detail:o.role+', '+distance(p,o).toFixed(0)+' pitch units away; nearest opponent '+nearest.toFixed(0)+' units.',
      probability:clamp(.9-distance(p,o)*.004-(nearest<10?.2:0),.15,.95),metric:'estimated completion'
    }));
    return {playerId:p.id,team:p.team,player:'#'+p.number+' · '+this.teams[p.team].name,role:p.role,finishing:p.finishing,pressure,kind,
      explanation:p.role+' with '+Math.round(p.finishing*100)+'/100 finishing. '+pressure+' opponent(s) within 13 pitch units.',
      alternatives:[{action:kind==='penalty'?'Take the penalty':kind==='freekick'?'Shoot from the free kick':'Shoot',detail:'Adjusted for finishing, distance, angle and pressure.',probability:this.chance(p,kind),metric:'estimated scoring'},
      ...(kind==='penalty'?[]:passes),...(kind==='open'?[{action:'Dribble forward',detail:'Retain the ball while advancing against nearby opponents.',probability:clamp(.5+p.dribbling*.3-pressure*.12,.12,.9),metric:'estimated retention'}]:[])],
      snapshot:{ball:{...this.ball},players:this.players.filter(o=>!o.sentOff).map(o=>({id:o.id,team:o.team,number:o.number,x:o.x,y:o.y}))}};
  }
  emit(type,text,extra={}) {
    const key=['goal','foul','freekick','penalty','throwin','goalkick','yellow','red','tackle','corner'].includes(type);
    const stop=key && type!=='tackle' && extra.stop!==false;
    if(stop)this.paused=true;
    if(type==='tackle' && this.teams[extra.team])this.teams[extra.team].tackles++;
    if(type==='yellow' && this.teams[extra.team])this.teams[extra.team].yellows++;
    if(type==='red' && this.teams[extra.team])this.teams[extra.team].reds++;
    const review=key?(extra.review??this.review()):null;
    if(review && !review.sequence) {
      const recent=[];
      for(let i=this.events.length-1;i>=0;i--){
        const e=this.events[i];
        if(this.elapsed-e.elapsed>12 || ['goal','kickoff'].includes(e.type))break;
        if(['pass','dribble','shot','turnover','tackle'].includes(e.type))recent.unshift({type:e.type,team:e.team,player:e.player,receiver:e.receiver,text:e.text});
      }
      review.sequence=recent;
      review.attackTeam=review.snapshot.players.find(p=>('#'+p.number+' · '+this.teams[p.team].name)===review.player)?.team??this.possession;
    }
    return super.emit(type,text,{key,stop,review,...extra});
  }
  advance(dt) {
    if(this.paused||!Number.isFinite(dt)||dt<=0)return;
    let remaining=Math.min(dt,this.duration-this.elapsed);
    while(remaining>.000001&&!this.paused&&!this.finished&&this.started){
      const step=Math.min(.04,remaining);this.step(step);remaining-=step;
    }
  }
  resume() {
    if(this.finished)return;
    this.paused=false;const action=this.pending;this.pending=null;if(action)action();
  }
  kickoff(team,reposition=true) {
    const all=this.players;this.players=all.filter(p=>!p.sentOff);
    super.kickoff(team,reposition);this.players=all;this.lastMove=null;
  }
  movePlayers(dt) {
    const all=this.players;this.players=all.filter(p=>!p.sentOff);
    super.movePlayers(dt);this.players=all;
  }
  restart(type,team,x,y,text,evidence) {
    this.flight=null;this.possession=team;this.phase=.12;this.passesThisAttack=0;this.lastMove=null;
    const taker=type==='goalkick'?this.active(team).find(p=>p.keeper):this.active(team).filter(p=>!p.keeper).sort((a,b)=>distance(a,{x,y})-distance(b,{x,y}))[0];
    this.possessor=taker;this.ball={x,y,z:0};
    this.pending=()=>{taker.x=clamp(x,2,98);taker.y=clamp(y,4,96);this.ball={x:taker.x,y:taker.y,z:0};this.nextAction=this.elapsed+.55;};
    this.emit(type,text,{team,player:taker.number,review:evidence??this.review(taker)});
  }
  rebalance(teamId) {
    const team=this.teams[teamId];
    const rows=team.formation.split('-').map(Number);
    const remaining=this.active(teamId).filter(p=>!p.keeper).sort((a,b)=>a.originalBaseX-b.originalBaseX||a.originalBaseY-b.originalBaseY);
    let remove=10-remaining.length;
    // Sacrifice attacking slots first; preserve a defensive line and midfield cover.
    while(remove>0) {
      let row=rows.length-1;
      while(row>0 && rows[row]<=1) row--;
      if(rows[row]===0) break;
      rows[row]--; remove--;
    }
    const rowXs=rows.length===4?[24,41,61,78]:[25,49,76];
    let at=0;
    rows.forEach((count,row)=>{
      for(let j=0;j<count;j++){
        const player=remaining[at++];
        player.baseX=rowXs[row];player.baseY=count===1?50:15+70*j/(count-1);
      }
    });
    team.currentFormation=rows.filter(n=>n>0).join('-');
    team.dismissals=10-remaining.length;
    return team.currentFormation;
  }
  nextPlay() {
    const p=this.possessor;
    const opponents=this.active(1-p.team).filter(o=>!o.keeper).sort((a,b)=>distance(a,p)-distance(b,p));
    const nearest=opponents[0],roll=this.random();
    if(!p.keeper&&nearest&&distance(nearest,p)<22&&roll<.025){this.foul(p,nearest,'handball');return;}
    if(!p.keeper&&nearest&&distance(nearest,p)<22&&roll<.16){this.foul(p,nearest);return;}
    if(!p.keeper&&roll<.23){
      this.restart('throwin',1-p.team,p.x,p.y<50?0:100,'#'+p.number+' tries to beat the defender down the flank, but the final touch runs over the touchline. Throw-in to '+this.teams[1-p.team].name+'.',this.review(p));return;
    }
    if(!p.keeper&&roll<.36){
      this.phase=Math.min(.95,this.phase+.16);p.x=clamp(p.x+(p.team===0?5:-5),2,98);
      this.lastMove={player:p.id,type:'dribble'};this.ball.x=p.x;this.ball.y=p.y;this.nextAction=this.elapsed+.7;
      this.emit('dribble','#'+p.number+' drops a shoulder and carries the ball into space. The defence has to turn.',{team:p.team,player:p.number});return;
    }
    if(!p.keeper&&nearest&&distance(nearest,p)<16&&roll<.43){
      const review=this.review(p);this.possessor=nearest;this.possession=nearest.team;this.phase=.1;this.passesThisAttack=0;this.lastMove=null;this.nextAction=this.elapsed+.6;
      this.emit('tackle','#'+nearest.number+' times the tackle on #'+p.number+' and wins the ball cleanly. Play continues.',{team:nearest.team,player:nearest.number,review});return;
    }
    if(!p.keeper&&(this.passesThisAttack>=4||(this.phase>.64&&this.passesThisAttack>=2))){this.takeShot();return;}
    const ownX=relativeX(p,p.team);
    let receivers=this.active(p.team).filter(o=>o!==p&&!o.keeper&&relativeX(o,p.team)>=ownX-12);
    if(!receivers.length)receivers=this.active(p.team).filter(o=>o!==p&&!o.keeper);
    const target=this.pick(receivers);
    const defenders=this.active(1-p.team).filter(o=>!o.keeper).sort((a,b)=>distance(a,target)-distance(b,target));
    const intercepted=defenders.length>0&&this.random()<.12&&distance(defenders[0],target)<19;
    this.lastMove=null;
    this.flight={type:'pass',team:p.team,from:p,target:intercepted?defenders[0]:target,intended:target,intercepted,start:this.elapsed,duration:this.range(.32,.58),fromX:this.ball.x,fromY:this.ball.y};
  }
  takeShot(kind='open') {
    const p=this.possessor,review=this.review(p,kind),probability=this.chance(p,kind),roll=this.random();
    const outcome=roll<probability?'goal':roll<probability+(1-probability)*.68?'saved':'wide';
    const keeper=this.active(1-p.team).find(o=>o.keeper);this.teams[p.team].shots++;
    const style=kind==='penalty'?'penalty':kind==='freekick'?'curling free kick':this.lastMove?.player===p.id?'shot after a driving dribble':this.pick(['powerful strike','low drive','placed finish','rising shot']);
    this.flight={type:'shot',team:p.team,from:p,start:this.elapsed,duration:this.range(.4,.62),fromX:this.ball.x,fromY:this.ball.y,toX:outcome==='saved'?keeper.x:p.team===0?100:0,toY:outcome==='saved'?keeper.y:outcome==='wide'?this.pick([30,70]):this.range(45,55),outcome,keeper,style,review,probability};
    this.emit('shot','#'+p.number+' of '+this.teams[p.team].name+' attempts a '+style+'. '+Math.round(probability*100)+'% estimated scoring chance.',{team:p.team,player:p.number,review,probability});
  }
  resolveShotOutcome(f) {
    const opponent=1-f.team;this.lastMove=null;
    if(f.outcome==='goal'){
      this.teams[f.team].score++;this.restartAt=this.elapsed+1.15;this.restartTeam=opponent;this.possession=opponent;
      this.emit('goal','GOAL! #'+f.from.number+' of '+this.teams[f.team].name+' finds the net with a '+f.style+'. The keeper cannot reach it!',{team:f.team,player:f.from.number,score:this.teams.map(t=>t.score),review:f.review});
    }else if(f.outcome==='wide'){
      this.restart('goalkick',opponent,opponent===0?7:93,50,'#'+f.from.number+'’s '+f.style+' flashes beyond the post and over the goal line. Goal kick to '+this.teams[opponent].name+'.',f.review);
      this.ball={x:f.toX,y:f.toY,z:0};
    }else{
      this.possession=opponent;this.phase=.1;this.passesThisAttack=0;this.possessor=f.keeper;
      this.ball={x:f.keeper.x,y:f.keeper.y,z:0};this.nextAction=this.elapsed+.7;
      this.emit('save','#1 of '+this.teams[opponent].name+' gets behind the '+f.style+' and holds it.',{team:opponent,player:1});
    }
  }
  foul(p,defender,cause='challenge') {
    const evidence=this.review(p),spot={x:p.x,y:p.y};
    const penalty=relativeX(p,p.team)>84.3 && p.y>20.4 && p.y<79.6;
    const roll=this.random(),card=roll<.01?'red':roll<.36?'yellow':null;
    this.teams[defender.team].fouls++;
    let discipline='No card is shown.';
    if(card==='yellow'){
      defender.yellowCards++;
      this.emit('yellow','#'+defender.number+' of '+this.teams[defender.team].name+' receives '+(defender.yellowCards===2?'a second yellow.':'a yellow card.'),{team:defender.team,player:defender.number,review:evidence,stop:false});
    }
    if(card==='red'||defender.yellowCards>=2){
      defender.sentOff=true;this.rebalance(defender.team);
      discipline=card==='red'?'Straight red: #'+defender.number+' is sent off.':'Second yellow, then red: #'+defender.number+' is sent off.';
      this.emit('red',discipline,{team:defender.team,player:defender.number,review:evidence,stop:false});
    }else if(card==='yellow')discipline='Yellow card for #'+defender.number+'.';
    const taker=this.active(p.team).filter(o=>!o.keeper).sort((a,b)=>b.finishing-a.finishing)[0];
    const kind=penalty?'penalty':'freekick';
    this.prepareSetPiece(kind,p.team,taker,penalty?{x:p.team===0?89.5:10.5,y:50}:spot);
    this.pending=()=>{this.setPiece.running=true;};
    const reason=cause==='handball'?'blocks the ball with an outstretched arm':this.pick(['clips the runner’s heel','arrives late and catches the ankle','pulls the attacker’s shirt']);
    const text=(cause==='handball'?'Handball! ':'Foul! ')+'#'+defender.number+' of '+this.teams[defender.team].name+' '+reason+' against #'+p.number+' of '+this.teams[p.team].name+'. '+discipline+' '+(penalty?'Penalty':'Free kick')+' to '+this.teams[p.team].name+'; #'+taker.number+' will take it.';
    this.emit(kind,(penalty?'Penalty':'Free kick')+' awarded to '+this.teams[p.team].name+'.',{team:p.team,player:taker.number,review:evidence,stop:false});
    this.emit('foul',text,{team:p.team,player:p.number,offender:defender.number,cause,card,penalty,taker:taker.number,review:evidence});
  }
  prepareSetPiece(kind,team,taker,spot) {
    this.flight=null;this.restartAt=null;this.possession=team;this.possessor=taker;
    this.ball={...spot,z:0};
    const sign=team===0?1:-1;
    const opponents=this.active(1-team),mates=this.active(team).filter(p=>p!==taker&&!p.keeper);
    if(kind==='penalty'){
      opponents.forEach((p,i)=>{p.x=p.keeper?(team===0?99:1):(team===0?79:21);p.y=p.keeper?50:12+i*7;});
      mates.forEach((p,i)=>{p.x=team===0?77:23;p.y=15+i*7;});
    }else if(kind==='corner'){
      mates.forEach((p,i)=>{p.x=team===0?this.range(76,92):this.range(8,24);p.y=30+i*5;});
      opponents.forEach((p,i)=>{p.x=p.keeper?(team===0?98:2):(team===0?90-i%3*4:10+i%3*4);p.y=p.keeper?50:24+i*5;});
    }else{
      const wall=opponents.filter(p=>!p.keeper).slice(0,3);
      wall.forEach((p,i)=>{p.x=clamp(spot.x+sign*9,2,98);p.y=clamp(spot.y+(i-1)*4,4,96);});
      opponents.find(p=>p.keeper).y=50;
      mates.forEach((p,i)=>{p.x=clamp(spot.x+sign*(12+i%3*4),5,95);p.y=22+i*7;});
    }
    taker.x=clamp(spot.x-sign*5,1,99);taker.y=clamp(spot.y+(kind==='corner'?(spot.y<50?5:-5):2),1,99);
    this.active(team).concat(opponents).forEach(p=>{p.vx=0;p.vy=0;});
    this.setPiece={kind,team,taker,spot:{...spot},from:{x:taker.x,y:taker.y},elapsed:0,duration:.6,running:false};
  }
  step(dt) {
    if(!this.setPiece)return super.step(dt);
    const piece=this.setPiece;
    if(!piece.running)return;
    this.elapsed=Math.min(this.duration,this.elapsed+dt);
    this.teams[this.possession].possessionSeconds+=dt;
    piece.elapsed+=dt;
    const progress=clamp(piece.elapsed/piece.duration,0,1);
    piece.taker.x=piece.from.x+(piece.spot.x-piece.from.x)*progress;
    piece.taker.y=piece.from.y+(piece.spot.y-piece.from.y)*progress;
    this.ball={...piece.spot,z:0};
    if(progress>=1){
      this.setPiece=null;
      if(piece.kind==='penalty'||piece.kind==='freekick'&&relativeX(piece.taker,piece.team)>62){
        this.takeShot(piece.kind);
        this.flight.duration=.32;
      }else{
        const options=this.active(piece.team).filter(p=>!p.keeper&&p!==piece.taker);
        const target=piece.kind==='corner'?options.sort((a,b)=>b.finishing-a.finishing)[0]:this.pick(options);
        const intercepted=this.random()<(piece.kind==='corner'?.3:.1);
        const defender=this.active(1-piece.team).filter(p=>!p.keeper).sort((a,b)=>distance(a,target)-distance(b,target))[0];
        this.flight={type:'pass',team:piece.team,from:piece.taker,target:intercepted?defender:target,intended:target,intercepted,start:this.elapsed,duration:.38,fromX:piece.spot.x,fromY:piece.spot.y};
        this.phase=piece.kind==='corner'?.8:.45;this.passesThisAttack=piece.kind==='corner'?2:0;
        this.emit('delivery','#'+piece.taker.number+' strikes the '+(piece.kind==='corner'?'corner into the area.':'free kick toward #'+target.number+'.'),{team:piece.team,player:piece.taker.number});
      }
    }
    if(!this.halfTimeEmitted&&this.elapsed>=45){this.halfTimeEmitted=true;this.emit('halftime','Half time: the second half is under way.');}
    if(this.elapsed-this.lastFrameAt>=.199)this.recordFrame();
    if(this.elapsed>=this.duration){this.setPiece=null;this.finish();}
  }
  resolveShot(f) {
    if(f.outcome==='saved' && this.random()<.3){
      const team=f.team,taker=this.active(team).filter(p=>!p.keeper).sort((a,b)=>a.finishing-b.finishing)[0];
      const spot={x:team===0?99:1,y:f.toY<50?1:99};
      this.teams[team].corners++;
      this.prepareSetPiece('corner',team,taker,spot);
      this.pending=()=>{this.setPiece.running=true;};
      this.emit('corner','The keeper gets fingertips to #'+f.from.number+'’s shot and diverts it over the goal line. Corner to '+this.teams[team].name+'; #'+taker.number+' will deliver.',{team,player:taker.number,review:this.review(taker,'corner')});
      return;
    }
    this.resolveShotOutcome(f);
  }
}

// Spatial simulation: stochastic decisions are permitted only when positions allow them.
export class MatchSimulator extends EventSimulator {
  constructor(config,onEvent) {
    super(config,onEvent);
    this.motion=null;this.counterattack=null;this.lastSetPiece=null;
  }
  kickoff(team,reposition=true) {
    if(!this.started||!reposition){
      super.kickoff(team,reposition);
      this.counterattack=null;this.lastSetPiece=null;this.motion=null;
      return;
    }
    this.possession=team;this.flight=null;this.restartAt=null;this.pending=null;
    this.setPiece=null;this.counterattack=null;this.lastSetPiece=null;this.lastMove=null;
    this.phase=.12;this.passesThisAttack=0;
    const active=this.players.filter(p=>!p.sentOff);
    const midfield=this.active(team).filter(p=>!p.keeper&&p.baseX>35&&p.baseX<65);
    const kicker=this.pick(midfield.length?midfield:this.active(team).filter(p=>!p.keeper));
    const receiver=this.active(team).filter(p=>p!==kicker&&!p.keeper).sort((a,b)=>Math.abs(a.baseX-49)-Math.abs(b.baseX-49))[0];
    const targets=new Map(active.map(p=>{
      const ownX=p.keeper?7:Math.min(44,p.baseX*.55);
      return [p.id,{x:p.team===0?ownX:100-ownX,y:p.baseY}];
    }));
    targets.set(kicker.id,{x:50,y:50});
    targets.set(receiver.id,{x:team===0?44:56,y:50});
    const duration=Math.max(1.5,...active.map(p=>distance(p,targets.get(p.id))/18));
    this.possessor=kicker;
    this.motion={kind:'kickoff',team,kicker,receiver,targets,fromBall:{...this.ball},duration,elapsed:0};
    this.emit('reset','Both teams walk back into their own halves. '+this.teams[team].name+' will restart at the centre.',{team});
  }
  stepKickoff(dt) {
    this.clockStep(dt);
    const m=this.motion;m.elapsed+=dt;
    let remaining=0;
    for(const p of this.players.filter(p=>!p.sentOff))remaining=Math.max(remaining,this.approach(p,m.targets.get(p.id),dt,18));
    const t=clamp(m.elapsed/m.duration,0,1);
    this.ball={x:m.fromBall.x+(50-m.fromBall.x)*t,y:m.fromBall.y+(50-m.fromBall.y)*t,z:0};
    if(remaining<.05&&t===1){
      this.motion=null;
      this.flight={type:'pass',team:m.team,from:m.kicker,target:m.receiver,intended:m.receiver,intercepted:false,start:this.elapsed,duration:.4,fromX:50,fromY:50};
      this.emit('kickoff',this.teams[m.team].name+' restart with #'+m.kicker.number+' rolling the ball to #'+m.receiver.number+'. Both sides can now move forward.',{team:m.team,player:m.kicker.number});
    }
    this.finishStep();
  }
  chance(p,kind='open') {
    const base=super.chance(p,kind);
    return Math.min(.88,base+this.counterBonus(p.team,kind));
  }
  counterBonus(team,kind='open') {
    return kind==='open'&&this.counterattack?.team===team&&this.possession===team&&this.elapsed<this.counterattack.until? .06:0;
  }
  review(p=this.possessor,kind='open') {
    const r=super.review(p,kind);
    if(r){
      r.counterBonus=this.counterBonus(p.team,kind);
      if(r.counterBonus)r.explanation+=' Fast break after a defended '+this.counterattack.source+': +6 percentage points to open-play scoring for up to 8 seconds, while possession lasts.';
    }
    return r;
  }
  beginCounter(team,recovery='tackle') {
    const origin=this.lastSetPiece;
    if(this.counterattack?.team!==team)this.counterattack=null;
    // Eden's counter rule: a live free kick/corner must be recovered by the
    // defending team. Ordinary open-play tackles never create this origin.
    if(!origin||!['freekick','corner'].includes(origin.kind)||origin.team===team||
      this.elapsed>=origin.until||this.setPiece||this.possession!==team||
      this.possessor?.team!==team||this.possessor.sentOff)return false;
    this.lastSetPiece=null;
    this.counterattack={team,until:this.elapsed+8,source:origin.kind,recovery};
    this.phase=Math.max(this.phase,.58);this.nextAction=this.elapsed+.2;
    const source=origin.kind==='freekick'?'free kick':'corner';
    this.emit('counterattack',this.teams[team].name+' win the ball after defending the '+source+' and break toward the opposite goal.',
      {team,player:this.possessor.number,source:origin.kind,recovery,stop:false});
    return true;
  }
  moveFlight() {
    const flight=this.flight;
    super.moveFlight();
    if(flight?.type==='pass'&&!this.flight){
      if(flight.intercepted)this.beginCounter(this.possession,'interception');
      if(this.counterBonus(this.possession)>0){this.phase=Math.max(this.phase,.58);this.nextAction=this.elapsed+.22;}
    }
  }
  nextPlay() {
    const p=this.possessor;
    if(!p||p.sentOff||distance(p,this.ball)>2.5)return;
    const nearest=this.active(1-p.team).filter(o=>!o.keeper).sort((a,b)=>distance(a,p)-distance(b,p))[0];
    const roll=this.random();
    const fast=this.counterBonus(p.team)>0;
    // Schedule one demo foul, but still approach the actual carrier before contact.
    const foulDue=this.elapsed>22&&this.teams.reduce((n,t)=>n+t.fouls,0)===0;
    if(!p.keeper&&nearest&&(foulDue||(distance(nearest,p)<6.5&&roll<.12))){
      this.motion={kind:'challenge',carrier:p,defender:nearest,cause:!foulDue&&roll<.005?'handball':'challenge',foul:foulDue||roll<.045,elapsed:0};
      this.nextAction=Infinity;return;
    }
    // A heavy touch can cross a touchline only from an actual wide position.
    if(!p.keeper&&(p.y<22||p.y>78)&&roll<.22){
      const side=p.y<50?0:100;
      this.motion={kind:'outflight',axis:'y',restart:'throwin',from:{...this.ball},to:{x:this.ball.x,y:side===0?-1:101},duration:Math.max(.5,Math.abs(this.ball.y-side)/24),elapsed:0,lastTouch:p.team,player:p.number,review:this.review(p)};
      this.nextAction=Infinity;return;
    }
    if(!p.keeper&&roll<.36){
      const x=clamp(p.x+(p.team===0?1:-1)*(fast?9:5),3,97);
      this.motion={kind:'carry',carrier:p,to:{x,y:p.y},elapsed:0};
      this.lastMove={player:p.id,type:'dribble'};
      this.nextAction=Infinity;
      this.emit('dribble','#'+p.number+(fast?' drives forward on the counterattack.':' carries the ball forward with close touches.'),{team:p.team,player:p.number});return;
    }
    if(!p.keeper&&((fast&&relativeX(p,p.team)>62&&this.passesThisAttack>=1)||this.passesThisAttack>=4||(this.phase>.64&&this.passesThisAttack>=2))){this.takeShot();return;}
    const ownX=relativeX(p,p.team);
    let receivers=this.active(p.team).filter(o=>o!==p&&!o.keeper&&relativeX(o,p.team)>=ownX-12);
    if(!receivers.length)receivers=this.active(p.team).filter(o=>o!==p&&!o.keeper);
    const forward=receivers.filter(o=>relativeX(o,p.team)>ownX+3).sort((a,b)=>relativeX(b,p.team)-relativeX(a,p.team));
    const target=fast&&forward.length?forward[0]:this.pick(receivers);
    const defenders=this.active(1-p.team).filter(o=>!o.keeper).sort((a,b)=>distance(a,target)-distance(b,target));
    const intercepted=defenders.length>0&&this.random()<.12&&distance(defenders[0],target)<8;
    this.lastMove=null;
    this.flight={type:'pass',team:p.team,from:p,target:intercepted?defenders[0]:target,intended:target,intercepted,start:this.elapsed,duration:Math.max(.3,distance(p,target)/(fast?85:65)),fromX:this.ball.x,fromY:this.ball.y};
  }
  foul(p,defender,cause='challenge') {
    if(this.flight||p!==this.possessor||p.team!==this.possession||distance(p,this.ball)>2.5||distance(p,defender)>2.2)return false;
    this.counterattack=null;
    this.foulSpot={x:this.ball.x,y:this.ball.y};
    super.foul(p,defender,cause);
    return true;
  }
  prepareSetPiece(kind,team,taker,spot) {
    if(kind==='freekick'&&this.foulSpot)spot={...this.foulSpot};
    this.flight=null;this.restartAt=null;this.possession=team;this.possessor=taker;
    const plan=planSetPiece(kind,team,taker,spot,this.players);
    this.setPiece={kind,team,taker,spot:{...spot},targets:plan.targets,shape:plan,stage:'collect',running:false,fromBall:{...this.ball},elapsed:0};
    this.foulSpot=null;this.counterattack=null;this.lastSetPiece=null;
  }
  restart(type,team,x,y,text,evidence) {
    this.flight=null;this.possession=team;this.phase=.12;this.passesThisAttack=0;this.lastMove=null;
    const taker=type==='goalkick'?this.active(team).find(p=>p.keeper):this.active(team).filter(p=>!p.keeper).sort((a,b)=>distance(a,{x,y})-distance(b,{x,y}))[0];
    this.prepareSetPiece(type,team,taker,{x,y});
    if(type==='throwin'){
      this.setPiece.targets.set(taker.id,{x,y});
      // Throw-ins use an infield receiver, rather than a free-kick wall.
      this.setPiece.targets=new Map(this.players.filter(p=>!p.sentOff).map(p=>[p.id,{x:p.x,y:p.y}]));
      this.setPiece.targets.set(taker.id,{x,y});
    }
    this.pending=()=>{this.setPiece.running=true;};
    this.emit(type,text+' #'+taker.number+' comes to take the restart.',{team,player:taker.number,spot:{x,y},review:evidence??this.review(taker)});
  }
  clockStep(dt) {
    this.elapsed=Math.min(this.duration,this.elapsed+dt);
    this.teams[this.possession].possessionSeconds+=dt;
  }
  finishStep() {
    if(!this.halfTimeEmitted&&this.elapsed>=45){this.halfTimeEmitted=true;this.emit('halftime','Half time: the second half is under way.');}
    if(this.elapsed-this.lastFrameAt>=.199||this.elapsed>=90)this.recordFrame();
    if(this.elapsed>=90){this.motion=null;this.setPiece=null;this.finish();}
  }
  approach(p,to,dt,speed) {
    const dx=to.x-p.x,dy=to.y-p.y,len=Math.hypot(dx,dy);
    const step=Math.min(len,speed*dt);
    p.vx=len?dx/len*speed:0;p.vy=len?dy/len*speed:0;
    if(len){p.x+=dx/len*step;p.y+=dy/len*step;}
    return len-step;
  }
  step(dt) {
    if(this.motion?.kind==='kickoff'){this.stepKickoff(dt);return;}
    if(this.setPiece){this.stepRestart(dt);return;}
    if(this.motion){this.stepMotion(dt);return;}
    super.step(dt);
  }
  stepMotion(dt) {
    this.clockStep(dt);
    const m=this.motion;m.elapsed+=dt;
    if(m.kind==='outflight'){
      const t=clamp(m.elapsed/m.duration,0,1);
      this.ball={x:m.from.x+(m.to.x-m.from.x)*t,y:m.from.y+(m.to.y-m.from.y)*t,z:0};
      // The crossing point, not the random decision, awards the restart.
      const crossed=m.axis==='y'?(this.ball.y<=0||this.ball.y>=100):(this.ball.x<=0||this.ball.x>=100);
      if(crossed){
        this.motion=null;
        const spot={x:clamp(this.ball.x,0,100),y:clamp(this.ball.y,0,100)};
        if(m.restart==='throwin'){
          this.restart('throwin',1-m.lastTouch,spot.x,spot.y,'The heavy touch by #'+m.player+' of '+this.teams[m.lastTouch].name+' crosses the touchline. Throw-in to '+this.teams[1-m.lastTouch].name+'.',m.review);
        }else if(m.restart==='corner'){
          this.awardCorner(m.team,spot);
        }
      }
    }else if(m.kind==='challenge'){
      // Hold the carrier at the ball while the opponent closes the final gap.
      this.approach(m.defender,m.carrier,dt,18);
      this.ball={x:m.carrier.x+(m.carrier.team===0?1:-1),y:m.carrier.y,z:0};
      if(distance(m.defender,m.carrier)<=1.8){
        this.motion=null;
        if(m.foul)this.foul(m.carrier,m.defender,m.cause);
        else{
          const review=this.review(m.carrier);
          this.possessor=m.defender;this.possession=m.defender.team;this.phase=.1;this.passesThisAttack=0;this.nextAction=this.elapsed+.6;
          this.emit('tackle','#'+m.defender.number+' wins the ball directly from #'+m.carrier.number+'. Play continues.',{team:m.defender.team,player:m.defender.number,lostTeam:m.carrier.team,lostPlayer:m.carrier.number,review});
          this.beginCounter(m.defender.team,'tackle');
        }
      }
    }else{
      const p=m.carrier;
      // Other players still move during a carry; the carrier follows its own target.
      const old={x:p.x,y:p.y};super.movePlayers(dt);p.x=old.x;p.y=old.y;
      const to=m.kind==='widecarry'?{x:p.x,y:m.side===0?2:98}:m.to;
      const remaining=this.approach(p,to,dt,14);
      this.ball={x:p.x+(p.team===0?1:-1),y:p.y,z:0};
      if(remaining<.05){
        this.motion=null;
        if(m.kind==='widecarry'){
          this.motion={kind:'outflight',axis:'y',restart:'throwin',from:{...this.ball},to:{x:this.ball.x,y:m.side===0?-1:101},duration:.38,elapsed:0,lastTouch:p.team,player:p.number,review:this.review(p)};
        }else{this.phase=Math.min(.95,this.phase+.1);this.nextAction=this.elapsed+.45;}
      }
    }
    this.finishStep();
  }
  stepRestart(dt) {
    const sp=this.setPiece;
    if(!sp.running)return;
    this.clockStep(dt);sp.elapsed+=dt;
    if(sp.stage==='collect'||sp.stage==='place'){
      for(const p of this.players.filter(p=>!p.sentOff&&p!==sp.taker))this.approach(p,sp.targets.get(p.id),dt,24);
      const target=sp.stage==='collect'?{x:clamp(sp.fromBall.x,0,100),y:clamp(sp.fromBall.y,0,100)}:sp.spot;
      const remaining=this.approach(sp.taker,target,dt,24);
      if(sp.stage==='collect'){
        this.ball={...sp.fromBall};
        if(remaining<.1)sp.stage='place';
      }else{
        this.ball={x:sp.taker.x,y:sp.taker.y,z:0};
        if(remaining<.1){this.ball={...sp.spot,z:0};sp.stage='arrange';}
      }
    }else if(sp.stage==='arrange'){
      let remaining=0;
      for(const p of this.players.filter(p=>!p.sentOff))remaining=Math.max(remaining,this.approach(p,sp.targets.get(p.id),dt,24));
      this.ball={...sp.spot,z:0};
      if(remaining<.1){sp.stage='runup';sp.elapsed=0;sp.from={x:sp.taker.x,y:sp.taker.y};this.active(sp.team).concat(this.active(1-sp.team)).forEach(p=>{p.vx=0;p.vy=0;});}
    }else{
      const t=clamp(sp.elapsed/.55,0,1);
      sp.taker.x=sp.from.x+(sp.spot.x-sp.from.x)*t;
      sp.taker.y=sp.from.y+(sp.spot.y-sp.from.y)*t;
      this.ball={...sp.spot,z:0};
      if(t===1){
        this.setPiece=null;this.possessor=sp.taker;
        if(['freekick','corner'].includes(sp.kind))this.lastSetPiece={team:sp.team,kind:sp.kind,until:this.elapsed+10};
        if(sp.kind==='penalty'||sp.kind==='freekick'&&relativeX(sp.taker,sp.team)>62){this.takeShot(sp.kind);this.flight.duration=.4;}
        else{
          const mates=this.active(sp.team).filter(p=>!p.keeper&&p!==sp.taker);
          const target=sp.kind==='corner'?mates.sort((a,b)=>b.finishing-a.finishing)[0]:mates.sort((a,b)=>distance(a,sp.spot)-distance(b,sp.spot))[0];
          const defender=this.active(1-sp.team).filter(p=>!p.keeper).sort((a,b)=>distance(a,target)-distance(b,target))[0];
          const intercepted=distance(defender,target)<8&&this.random()<(sp.kind==='corner'?.3:.1);
          this.flight={type:'pass',team:sp.team,from:sp.taker,target:intercepted?defender:target,intended:target,intercepted,start:this.elapsed,duration:Math.max(.4,distance(sp.spot,target)/65),delivery:sp.kind,fromX:sp.spot.x,fromY:sp.spot.y};
          this.phase=sp.kind==='corner'?.8:.3;this.passesThisAttack=sp.kind==='corner'?2:0;
          this.emit('delivery','#'+sp.taker.number+(sp.kind==='throwin'?' throws the ball in to #':' delivers the '+sp.kind+' toward #')+target.number+'.',{team:sp.team,player:sp.taker.number});
        }
      }
    }
    this.finishStep();
  }
  awardCorner(team,crossing) {
    const taker=this.active(team).filter(p=>!p.keeper).sort((a,b)=>distance(a,crossing)-distance(b,crossing))[0];
    const spot={x:team===0?100:0,y:crossing.y<50?0:100};
    this.teams[team].corners++;
    this.prepareSetPiece('corner',team,taker,spot);
    this.pending=()=>{this.setPiece.running=true;};
    this.emit('corner','The keeper deflects the ball over the goal line. Corner to '+this.teams[team].name+'; #'+taker.number+' comes across to take it.',{team,player:taker.number,spot,review:this.review(taker,'corner')});
  }
  resolveShot(f) {
    if(f.outcome==='saved'&&this.random()<.3){
      this.motion={kind:'outflight',axis:'x',restart:'corner',team:f.team,lastTouch:1-f.team,player:1,from:{...this.ball},to:{x:f.team===0?101:-1,y:this.ball.y<50?39:61},duration:.5,elapsed:0};
      return;
    }
    this.resolveShotOutcome(f);
    if(f.outcome==='saved')this.beginCounter(this.possession,'save');
  }
  resolveShotOutcome(f) {
    if(f.outcome==='wide'){
      this.restart('goalkick',1-f.team,f.team===0?93:7,50,'#'+f.from.number+' shoots wide over the goal line. Goal kick to '+this.teams[1-f.team].name+'.',f.review);
    }else {
      super.resolveShotOutcome(f);
      if(f.outcome==='goal'){
        this.restartAt=null;
        this.pending=()=>this.kickoff(1-f.team,true);
      }
    }
  }
}

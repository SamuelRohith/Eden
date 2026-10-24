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
    this.ball.z = Math.sin(progress * Math.PI) * (f.type === 'shot' ? 1.1 : .45);
    if (progress < 1) return;
    this.flight = null;
    this.ball.z = 0;
    if (f.type === 'pass') {
      this.possessor = f.target;
      if (f.intercepted) {
        this.possession = f.target.team;
        this.phase = .15;
        this.passesThisAttack = 0;
        this.emit('turnover', `#${f.target.number} of ${this.teams[f.target.team].name} intercepts the pass. A chance to break!`, { team: f.target.team, player: f.target.number });
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


export class MatchSimulator extends CoreSimulator {
  constructor(config,onEvent) {
    super(config,onEvent);
    this.paused=false; this.pending=null;
    this.players.forEach(p=>{
      p.role=p.keeper?'Goalkeeper':p.baseX<35?'Defender':p.baseX<70?'Midfielder':'Attacker';
      p.finishing=({Goalkeeper:.12,Defender:.35,Midfielder:.56,Attacker:.79})[p.role]+this.range(-.09,.09);
      p.dribbling=this.range(.4,.85);p.yellowCards=0;p.sentOff=false;
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
    const key=['goal','foul','freekick','penalty','throwin','goalkick','yellow','red','tackle'].includes(type);
    if(key)this.paused=true;
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
    return super.emit(type,text,{key,review,...extra});
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
  foul(p,defender) {
    const evidence=this.review(p);
    const penalty=relativeX(p,p.team)>84.3&&p.y>20.4&&p.y<79.6;
    const reason=this.pick(['clips the runner’s heel while chasing the ball','arrives late and catches the ankle','pulls the shirt as the attacker turns']);
    const roll=this.random();const card=roll<.045?'red':roll<.36?'yellow':null;
    this.pending=()=>{
      const award=()=>{
        const taker=this.active(p.team).filter(o=>!o.keeper).sort((a,b)=>b.finishing-a.finishing)[0];
        this.possessor=taker;
        taker.x=penalty?(p.team===0?89.5:10.5):p.x;taker.y=penalty?50:p.y;
        this.ball={x:taker.x,y:taker.y,z:0};
        this.pending=()=>{if(penalty||relativeX(taker,taker.team)>62)this.takeShot(penalty?'penalty':'freekick');else this.nextAction=this.elapsed+.4;};
        this.emit(penalty?'penalty':'freekick',(penalty?'Penalty':'Free kick')+' to '+this.teams[p.team].name+'. #'+taker.number+' stands over the ball after the late challenge.',{team:p.team,player:taker.number,review:this.review(taker,penalty?'penalty':'freekick')});
      };
      if(card){
        if(card==='yellow')defender.yellowCards++;
        const red=card==='red'||defender.yellowCards>=2;defender.sentOff=red;
        this.pending=award;
        this.emit(red?'red':'yellow','#'+defender.number+' of '+this.teams[defender.team].name+': '+(red?(card==='yellow'?'second yellow, then red — sent off.':'straight red for a dangerous challenge — sent off.'):'yellow card for the late challenge.'),{team:defender.team,player:defender.number,review:evidence});
      }else award();
    };
    this.emit('foul','Foul! #'+defender.number+' of '+this.teams[defender.team].name+' '+reason+' on #'+p.number+'. '+(penalty?'Contact is inside the area.':'Play stops at the point of contact.'),{team:p.team,player:p.number,review:evidence});
  }
  nextPlay() {
    const p=this.possessor;
    const opponents=this.active(1-p.team).filter(o=>!o.keeper).sort((a,b)=>distance(a,p)-distance(b,p));
    const nearest=opponents[0],roll=this.random();
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
      this.emit('tackle','#'+nearest.number+' times the tackle on #'+p.number+' and wins the ball cleanly. A counterattack is on.',{team:nearest.team,player:nearest.number,review});return;
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
  resolveShot(f) {
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
}

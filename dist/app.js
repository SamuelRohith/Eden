import { buildAnalysis } from './analysis.js';
import { MatchSimulator } from './simulator.js';

const $ = id => document.getElementById(id);
const canvas = $('pitchCanvas');
const context = canvas.getContext('2d');
const dialog = $('setupDialog');
const colors = ['#eb5368', '#4089f4'];
let simulation = null;
let lastTimestamp = null;
let animationId = null;
let goalTimeout = null;
let field = null;
let confettiId = null;
let displayedSecond = -1;
let stoppedEvent = null;
const reviewCache = new Map();

function openSetup() { if (!dialog.open) dialog.showModal(); }
$('runSimulation').addEventListener('click', openSetup);
$('closeSetup').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
});
$('yesRematch').addEventListener('click', openSetup);
$('anotherMatch').addEventListener('click', openSetup);
$('noRematch').addEventListener('click', () => {
  $('rematchQuestion').hidden = true;
  $('reviewActions').hidden = false;
  $('anotherMatch').focus();
});
$('setupForm').addEventListener('submit', event => {
  event.preventDefault();
  const home = $('homeName').value.trim();
  const away = $('awayName').value.trim();
  if (!home || !away) {
    const input = !home ? $('homeName') : $('awayName');
    input.setCustomValidity('Give your team a name to start the match.');
    input.reportValidity();
    input.addEventListener('input', () => input.setCustomValidity(''), { once: true });
    return;
  }
  dialog.close();
  startMatch({ teams: [{ name: home, formation: $('homeShape').value }, { name: away, formation: $('awayShape').value }] });
});

function startMatch(config) {
  if (animationId) cancelAnimationFrame(animationId);
  if (confettiId) cancelAnimationFrame(confettiId);
  clearTimeout(goalTimeout);
  clearConfetti();
  $('welcome').hidden = true;
  $('matchRoom').hidden = false;
  $('finishPanel').hidden = true;
  $('rematchQuestion').hidden = false;
  $('reviewActions').hidden = true;
  $('goalToast').hidden = true;
  $('commentary').replaceChildren();
  $('eventOverlay').hidden = true;
  $('pitchCanvas').classList.remove('pitch-blurred');
  $('reviewDialog').close();
  reviewCache.clear(); stoppedEvent = null;
  $('headerMatchTitle').hidden = false;
  document.body.classList.add('in-match');
  $('playControl').disabled = false;
  $('headerStatus').textContent = 'THE MATCH ROOM';
  $('matchBadge').textContent = 'SIMULATION LIVE';
  $('commentaryLive').textContent = 'LIVE';
  $('pitchStatus').textContent = 'The match is under way';
  $('progressStatus').textContent = 'THE STORY IS UNFOLDING';
  $('pitchMinute').textContent = '1 real second = 1 match minute';
  simulation = new MatchSimulator(config, onMatchEvent);
  displayedSecond = -1;
  ['Home', 'Away'].forEach((side, index) => {
    $(`score${side}Name`).textContent = simulation.teams[index].name;
    $(`stat${side}Name`).textContent = simulation.teams[index].name;
    $(`${side.toLowerCase()}Formation`).textContent = simulation.teams[index].formation.replaceAll('-', '–');
  });
  resizePitch();
  updateStats(true);
  simulation.start();
  lastTimestamp = performance.now();
  animationId = requestAnimationFrame(animate);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function animate(timestamp) {
  if (!simulation) return;
  const dt = Math.max(0, (timestamp - lastTimestamp) / 1000);
  lastTimestamp = timestamp;
  simulation.advance(dt);
  drawPitch();
  updateStats(simulation.paused);
  $('playControl').textContent = simulation.paused ? '▶ Play / resume match' : 'Pause match';
  $('pauseNote').textContent = simulation.paused ? 'Paused. Review a green moment, then press Play.' : 'Major moments pause automatically for review.';
  if (simulation.finished) {
    animationId = null;
    finishMatch();
  } else animationId = requestAnimationFrame(animate);
}

function updateStats(force = false) {
  const s = simulation;
  const totalMatchSeconds = Math.min(5400, Math.floor(s.elapsed * 60));
  const minute = Math.floor(totalMatchSeconds / 60);
  const seconds = totalMatchSeconds % 60;
  $('matchClock').textContent = s.finished ? '90:00' : `${String(minute).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const elapsedSecond = Math.floor(s.elapsed);
  if (elapsedSecond !== displayedSecond || force || s.finished) {
    displayedSecond = elapsedSecond;
    const possession = s.getPossession();
    $('homePossession').textContent = `${possession[0]}%`;
    $('awayPossession').textContent = `${possession[1]}%`;
    $('possessionHome').style.width = `${possession[0]}%`;
    $('possessionBar').setAttribute('aria-label', `Possession: ${s.teams[0].name} ${possession[0]} percent; ${s.teams[1].name} ${possession[1]} percent`);
    $('realTimer').textContent = s.finished ? '90 seconds · match complete' : `${Math.max(0, Math.ceil(90 - s.elapsed))} seconds remaining`;
    $('homePasses').textContent = s.teams[0].passes;
    $('awayPasses').textContent = s.teams[1].passes;
    $('homeShots').textContent = s.teams[0].shots;
    $('awayShots').textContent = s.teams[1].shots;
    $('homeScore').textContent = s.teams[0].score;
    $('awayScore').textContent = s.teams[1].score;
  }
  $('progressFill').style.width = `${Math.min(100, s.elapsed / 90 * 100)}%`;
  $('matchProgress').setAttribute('aria-valuenow', s.elapsed.toFixed(1));
}

function onMatchEvent(event) {
  const entry = document.createElement('article');
  entry.className = `commentary-item ${event.type}`;
  if (event.key) {
    entry.classList.add('key-event');
    entry.tabIndex = 0; entry.setAttribute('role','button');
    entry.setAttribute('aria-label', 'Review ' + event.type + ' at ' + Math.floor(event.elapsed) + ' minutes');
    entry.addEventListener('click', () => showReview(event));
    entry.addEventListener('keydown', e => { if(e.key==='Enter'||e.key===' '){e.preventDefault();showReview(event);} });
  }
  const time = document.createElement('span');
  time.className = 'commentary-time';
  time.textContent = `${Math.min(90, Math.floor(event.elapsed))}′`;
  const body = document.createElement('div');
  body.className = 'commentary-body';
  const labels = { goal: 'INTO THE NET', shot: 'A CHANCE', save: 'SAFE HANDS', turnover: 'POSSESSION CHANGES', halftime: 'HALF TIME', fulltime: 'FINAL WHISTLE', kickoff: 'KICK-OFF' };
  if (labels[event.type]) {
    const label = document.createElement('div');
    label.className = 'commentary-type';
    label.textContent = labels[event.type];
    body.append(label);
  }
  const text = document.createElement('div');
  text.textContent = event.text;
  body.append(text);
  entry.append(time, body);
  $('commentary').prepend(entry);
  if (event.key) { stoppedEvent = event; showEventStop(event); }
  // Keep the newest highlight visible while retaining the complete feed for review.
  $('commentary').scrollTop = 0;
  if (event.type === 'goal') {
    $('homeScore').textContent = event.score[0];
    $('awayScore').textContent = event.score[1];
    $('goalScorer').textContent = `#${event.player} · ${simulation.teams[event.team].name}`;
    $('goalToast').hidden = true;
    $('pitchStatus').textContent = `Goal for ${simulation.teams[event.team].name}!`;
    clearTimeout(goalTimeout);
    goalTimeout = setTimeout(() => { $('goalToast').hidden = true; }, 1250);
  } else if (event.type === 'shot') {
    $('pitchStatus').textContent = `#${event.player} has a go for ${simulation.teams[event.team].name}`;
  } else if (['save', 'turnover', 'kickoff'].includes(event.type)) {
    $('pitchStatus').textContent = `${simulation.teams[event.team].name} on the ball`;
  } else if (event.type === 'wide') $('pitchStatus').textContent = 'Just wide of the target';
}

function finishMatch() {
  $('playControl').disabled = true;
  $('eventOverlay').hidden = true;
  const [home, away] = simulation.teams;
  updateStats(true);
  clearTimeout(goalTimeout);
  $('goalToast').hidden = true;
  $('finishPanel').hidden = false;
  $('matchBadge').textContent = 'MATCH COMPLETE';
  $('commentaryLive').textContent = 'FULL TIME';
  $('pitchStatus').textContent = 'Full time. A story worth replaying.';
  $('pitchMinute').textContent = 'Final score · 90:00';
  $('progressStatus').textContent = 'THE FINAL WHISTLE';
  $('headerStatus').textContent = 'FULL TIME / MATCH ROOM';
  $('finishTitle').textContent = home.score === away.score ? 'Honours even.' : `${home.score > away.score ? home.name : away.name} take the win.`;
  $('finishSummary').textContent = `${home.name} ${home.score}–${away.score} ${away.name}. Keep this match open to explore the stats and every highlight.`;
  launchConfetti();
}

function resizePitch() {
  if ($('matchRoom').hidden) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const pad = Math.max(24, rect.width * .038);
  field = { x: pad, y: rect.width < 500 ? 112 : 108, w: rect.width - pad * 2, h: rect.height - (rect.width < 500 ? 135 : 138), width: rect.width, height: rect.height };
  drawPitch();
}

function drawPitch() {
  if (!field || !simulation) return;
  const c = context;
  const f = field;
  c.clearRect(0, 0, f.width, f.height);
  c.fillStyle = '#277852';
  c.fillRect(0, 0, f.width, f.height);
  // Alternating grass cuts are tied to field coordinates, not player coordinates.
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 ? '#2b8059' : '#2a7b55';
    c.fillRect(f.x + f.w * i / 12, f.y, f.w / 12, f.h);
  }
  const x = v => f.x + v / 100 * f.w;
  const y = v => f.y + v / 100 * f.h;
  c.lineWidth = Math.max(1, f.width / 620);
  c.strokeStyle = '#d0e7d6b3';
  c.fillStyle = '#d0e7d6b3';
  c.strokeRect(f.x, f.y, f.w, f.h);
  line(x(50), y(0), x(50), y(100));
  const circleR = f.h * .137;
  c.beginPath(); c.arc(x(50), y(50), circleR, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(x(50), y(50), 2, 0, Math.PI * 2); c.fill();
  c.strokeRect(x(0), y(20.4), f.w * .157, f.h * .592);
  c.strokeRect(x(84.3), y(20.4), f.w * .157, f.h * .592);
  c.strokeRect(x(0), y(36.5), f.w * .052, f.h * .27);
  c.strokeRect(x(94.8), y(36.5), f.w * .052, f.h * .27);
  for (const spot of [10.5, 89.5]) { c.beginPath(); c.arc(x(spot), y(50), 1.7, 0, Math.PI * 2); c.fill(); }
  c.beginPath(); c.arc(x(10.5), y(50), circleR, -.94, .94); c.stroke();
  c.beginPath(); c.arc(x(89.5), y(50), circleR, Math.PI - .94, Math.PI + .94); c.stroke();
  // Goal frames and mesh remain visible behind each end line.
  for (const side of [0, 1]) {
    const gx = side ? x(100) : x(0) - 10;
    c.strokeStyle = '#dbefe2c4';
    c.strokeRect(gx, y(44), 10, f.h * .12);
    c.strokeStyle = '#d4eee346';
    for (let n = 1; n < 4; n++) line(gx, y(44 + n * 3), gx + 10, y(44 + n * 3));
    line(gx + 5, y(44), gx + 5, y(56));
  }
  c.strokeStyle = '#d0e7d6b3';
  const cornerR = Math.max(4, f.h * .023);
  [[0, 0, 0, Math.PI / 2], [100, 0, Math.PI / 2, Math.PI], [0, 100, -Math.PI / 2, 0], [100, 100, Math.PI, Math.PI * 1.5]].forEach(([px, py, a, b]) => { c.beginPath(); c.arc(x(px), y(py), cornerR, a, b); c.stroke(); });
  const radius = Math.max(6, Math.min(12.5, f.w * .0145));
  // Players are all drawn every frame. IDs and shirt numbers never change.
  for (const p of simulation.players.filter(p => !p.sentOff)) {
    const px = x(p.x), py = y(p.y);
    if (p === simulation.possessor && !simulation.flight && simulation.restartAt === null && !simulation.finished) {
      c.beginPath(); c.arc(px, py, radius + 4, 0, Math.PI * 2); c.strokeStyle = '#ffffff66'; c.lineWidth = 1; c.stroke();
    }
    c.shadowColor = '#092c2845'; c.shadowBlur = 5; c.shadowOffsetY = 2;
    c.fillStyle = colors[p.team]; c.beginPath(); c.arc(px, py, radius, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = '#ffffffeb'; c.lineWidth = Math.max(1.1, radius * .14); c.stroke();
    if (p.yellowCards) { c.fillStyle = '#ffe15a'; c.fillRect(px + radius - 3, py - radius - 4, 5, 8); }
    c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${Math.max(7, radius * .83)}px "DM Sans", sans-serif`; c.fillText(String(p.number), px, py + .45);
  }
  drawBall(x(simulation.ball.x), y(simulation.ball.y) - simulation.ball.z * 7, Math.max(5.4, radius * .62));
}

function line(x1, y1, x2, y2) { context.beginPath(); context.moveTo(x1, y1); context.lineTo(x2, y2); context.stroke(); }

function drawBall(bx, by, r) {
  const c = context;
  c.save();
  c.shadowColor = '#061c2266'; c.shadowBlur = 5; c.shadowOffsetY = 2;
  c.beginPath(); c.arc(bx, by, r, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
  c.strokeStyle = '#1b252d'; c.lineWidth = .6; c.stroke();
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    const px = bx + Math.cos(a) * r * .43, py = by + Math.sin(a) * r * .43;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath(); c.fillStyle = '#19212c'; c.fill();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
    c.beginPath(); c.moveTo(bx + Math.cos(a) * r * .4, by + Math.sin(a) * r * .4); c.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); c.stroke();
    c.beginPath(); c.arc(bx + Math.cos(a) * r * .92, by + Math.sin(a) * r * .92, r * .19, 0, Math.PI * 2); c.fill();
  }
  c.restore();
}

function clearConfetti() {
  const cc = $('confettiCanvas');
  cc.getContext('2d').clearRect(0, 0, cc.width, cc.height);
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cc = $('confettiCanvas');
  const c = cc.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  cc.width = w * dpr; cc.height = h * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const palette = ['#215ced', '#76a5ff', '#eb5368', '#f4c74d', '#60cda7'];
  const particles = Array.from({ length: 160 }, (_, i) => {
    const side = i % 2;
    return { x: side ? w + 8 : -8, y: h * .6, vx: (side ? -1 : 1) * (130 + Math.random() * 430), vy: -(240 + Math.random() * 440), color: palette[i % palette.length], rotation: Math.random() * 6, spin: (Math.random() - .5) * 9, size: 4 + Math.random() * 6 };
  });
  let start = null, last = null;
  const run = now => {
    if (start === null) { start = now; last = now; }
    const dt = Math.min(.04, (now - last) / 1000); last = now;
    c.clearRect(0, 0, w, h);
    const alpha = Math.min(1, Math.max(0, (4200 - (now - start)) / 900));
    c.globalAlpha = alpha;
    particles.forEach(p => {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 350 * dt; p.vx *= 1 - .12 * dt; p.rotation += p.spin * dt;
      c.save(); c.translate(p.x, p.y); c.rotate(p.rotation); c.fillStyle = p.color; c.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); c.restore();
    });
    if (now - start < 4200) confettiId = requestAnimationFrame(run);
    else { c.clearRect(0, 0, w, h); confettiId = null; }
  };
  confettiId = requestAnimationFrame(run);
}

const observer = new ResizeObserver(resizePitch);
observer.observe(canvas);
window.addEventListener('resize', resizePitch);
// Useful for a future feed adapter and inspecting the generated match in DevTools.
window.eden = { get match() { return simulation; } };


function showEventStop(event) {
  $('eventTitle').textContent = event.type.replace('throwin','Throw-in').replace('goalkick','Goal kick').replace('freekick','Free kick').toUpperCase();
  $('eventSummary').textContent = event.text;
  $('eventOverlay').hidden = false;
  $('pitchCanvas').classList.add('pitch-blurred');
}
function resumeMatch() {
  if (!simulation || simulation.finished) return;
  $('reviewDialog').close();
  $('eventOverlay').hidden = true;
  $('pitchCanvas').classList.remove('pitch-blurred');
  simulation.resume();
  lastTimestamp = performance.now();
}
$('overlayResume').addEventListener('click', resumeMatch);
$('overlayReview').addEventListener('click', () => { if(stoppedEvent) showReview(stoppedEvent); });
$('reviewResume').addEventListener('click', resumeMatch);
$('playControl').addEventListener('click', () => {
  if(!simulation||simulation.finished)return;
  if(simulation.paused)resumeMatch();else simulation.paused=true;
});
$('closeReview').addEventListener('click', () => $('reviewDialog').close());
$('reviewDialog').addEventListener('close', () => {
  if(!simulation?.finished) $('playControl').focus();
});
function showReview(event) {
  if(!simulation.finished) simulation.paused=true;
  $('eventOverlay').hidden=true;
  $('pitchCanvas').classList.remove('pitch-blurred');
  if(!reviewCache.has(event.id)) reviewCache.set(event.id, buildAnalysis(event,simulation.teams,simulation.players));
  const data=reviewCache.get(event.id);
  $('reviewTitle').textContent=Math.floor(event.elapsed)+'′ · '+event.type.replace('throwin','Throw-in').replace('goalkick','Goal kick').replace('freekick','Free kick').toUpperCase();
  $('reviewText').textContent=event.text;
  $('attackTitle').textContent=data.attackTitle;
  $('defendTitle').textContent=data.defendTitle;
  for(const side of ['attack','defend']){
    const list=$(side+'Points');list.replaceChildren();
    data[side+'Points'].forEach(point=>{const li=document.createElement('li');li.textContent=point;list.append(li);});
  }
  $('reviewOptions').replaceChildren();
  data.options.forEach(option=>{
    const card=document.createElement('article');card.className='alternative-card '+(option.tone??'neutral');
    const title=document.createElement('strong');title.textContent=option.action;title.className='option-action';
    const percent=document.createElement('b');percent.textContent=Math.round(option.probability*100)+'%';percent.className='option-percent';
    const metric=document.createElement('span');metric.textContent='estimated goal chance';metric.className='option-metric';
    const detail=document.createElement('p');detail.textContent=option.detail;
    card.append(title,percent,metric,detail);$('reviewOptions').append(card);
  });
  $('reviewContext').textContent='Based on saved positions and the recorded build-up. Passing and dribbling estimates combine retaining possession with a hypothetical follow-up shot; opponent responses are not simulated.';
  $('reviewResume').hidden=simulation.finished;
  if(!$('reviewDialog').open)$('reviewDialog').showModal();
}

// シンプルな縦スクロール・シューティング（canvas）
// タッチ操作（仮想ジョイスティック + 発射ボタン）対応版

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const startBtn = document.getElementById('startBtn');

const joystick = document.getElementById('joystick');
const joystickHandle = document.getElementById('joystick-handle');
const fireBtn = document.getElementById('fireBtn');

let W, H;
function resize() {
  W = canvas.width = Math.min(720, window.innerWidth - 20);
  H = canvas.height = Math.max(400, window.innerHeight - 140);
}
window.addEventListener('resize', resize);
resize();

// ゲーム状態
let keys = {};
let bullets = [];
let enemies = [];
let player = null;
let score = 0;
let lives = 3;
let running = false;
let spawnTimer = 0;

startBtn.addEventListener('click', startGame);
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

// --- タッチコントロール用状態 ---
let joystickId = null;
let joystickOrigin = { x: 0, y: 0 };
let joystickAxis = 0; // -1 .. 1 (水平)
const joystickMax = 40; // ハンドルの最大移動距離（px）
let firing = false;     // 発射ボタンが押されているか

// ジョイスティック操作
joystick.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    if (joystickId === null) {
      joystickId = t.identifier;
      joystickOrigin = { x: t.clientX, y: t.clientY };
      updateJoystickHandle(0);
      break;
    }
  }
}, { passive: false });

joystick.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    if (t.identifier === joystickId) {
      const dx = t.clientX - joystickOrigin.x;
      let axis = dx / joystickMax;
      if (axis > 1) axis = 1;
      if (axis < -1) axis = -1;
      joystickAxis = axis;
      updateJoystickHandle(axis);
      break;
    }
  }
}, { passive: false });

joystick.addEventListener('touchend', (e) => {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    if (t.identifier === joystickId) {
      joystickId = null;
      joystickAxis = 0;
      updateJoystickHandle(0, true);
      break;
    }
  }
}, { passive: false });

joystick.addEventListener('touchcancel', (e) => {
  joystickId = null;
  joystickAxis = 0;
  updateJoystickHandle(0, true);
}, { passive: false });

function updateJoystickHandle(axis, reset=false) {
  const x = axis * joystickMax;
  joystickHandle.style.transform = `translate(${x}px, 0px)`;
  if (reset) {
    // スムーズに戻す
    joystickHandle.style.transition = 'transform 0.12s ease';
    setTimeout(() => joystickHandle.style.transition = 'transform 0.05s linear', 150);
  }
}

// 発射ボタン
fireBtn.addEventListener('touchstart', (e) => {
  e.preventDefault();
  firing = true;
}, { passive: false });
fireBtn.addEventListener('touchend', (e) => {
  e.preventDefault();
  firing = false;
}, { passive: false });
fireBtn.addEventListener('touchcancel', (e) => {
  firing = false;
}, { passive: false });

// キャンバスを直接タッチしても左右移動できる（指位置に追従）
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    // 画面右側のタッチは発射、左側は移動（直接移動）
    const r = window.innerWidth;
    if (t.clientX > r * 0.6) {
      firing = true;
    } else {
      // 直接プレイヤーを指に追従させる
      // store an ad-hoc touch id for direct canvas move
      // here we just set player.x immediately
      const rect = canvas.getBoundingClientRect();
      const canvasX = (t.clientX - rect.left) * (canvas.width / rect.width);
      if (player) player.x = Math.max(player.w/2, Math.min(W-player.w/2, canvasX));
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  for (const t of Array.from(e.changedTouches)) {
    const r = window.innerWidth;
    if (t.clientX > r * 0.6) {
      firing = true;
    } else {
      const rect = canvas.getBoundingClientRect();
      const canvasX = (t.clientX - rect.left) * (canvas.width / rect.width);
      if (player) player.x = Math.max(player.w/2, Math.min(W-player.w/2, canvasX));
    }
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  // 指を離したら発射解除（ただし他の指で押している可能性は考慮していません）
  firing = false;
}, { passive: false });

// ヘルパー
function rand(a,b){return Math.random()*(b-a)+a;}

function createPlayer(){
  return { x: W/2, y: H-60, w: 30, h: 20, speed: 4, cooldown:0 };
}

function spawnEnemy(){
  const size = rand(20,40);
  enemies.push({
    x: rand(size, W-size),
    y: -size,
    w: size,
    h: size,
    speed: rand(1,2.2)
  });
}

function update(){
  if (!running) return;
  // player: キーボード or ジョイスティック or 移動タッチ
  let moveX = 0;
  if (keys['ArrowLeft'] || keys['a']) moveX -= 1;
  if (keys['ArrowRight'] || keys['d']) moveX += 1;
  // ジョイスティック入力を優先して加算
  moveX += joystickAxis * 1.0;

  player.x += moveX * player.speed * 1.8; // ジョイスティック感度を調整
  player.x = Math.max(player.w/2, Math.min(W-player.w/2, player.x));

  // 発射（キーボード or fire 振る舞い）
  const keyboardFire = (keys[' '] || keys['Spacebar'] || keys['z']);
  if ((keyboardFire || firing) && player.cooldown <= 0){
    bullets.push({ x: player.x, y: player.y - player.h/2, w:4, h:8, speed:6 });
    player.cooldown = 12; // 発射間隔
  }
  player.cooldown = Math.max(0, player.cooldown - 1);

  // bullets
  bullets.forEach(b => b.y -= b.speed);
  bullets = bullets.filter(b => b.y + b.h > -10);

  // enemies
  spawnTimer -= 1;
  if (spawnTimer <= 0){
    spawnEnemy();
    spawnTimer = Math.max(20, 90 - Math.min(60, Math.floor(score/10)));
  }
  enemies.forEach(e => e.y += e.speed);
  // 衝突判定（弾と敵）
  for (let i = enemies.length-1; i >=0; i--){
    const e = enemies[i];
    for (let j = bullets.length-1; j>=0; j--){
      const b = bullets[j];
      if (b.x > e.x - e.w/2 && b.x < e.x + e.w/2 && b.y < e.y + e.h/2 && b.y > e.y - e.h/2){
        // ヒット
        bullets.splice(j,1);
        enemies.splice(i,1);
        score += 1;
        break;
      }
    }
  }
  // 敵が下まで行ったらプレイヤーにダメージ
  for (let i = enemies.length-1; i>=0; i--){
    if (enemies[i].y - enemies[i].h/2 > H){
      enemies.splice(i,1);
      lives -= 1;
      if (lives <= 0){ gameOver(); break; }
    } else {
      // 敵とプレイヤーの当たり判定
      const e = enemies[i];
      if (Math.abs(e.x - player.x) < (e.w/2 + player.w/2) && Math.abs(e.y - player.y) < (e.h/2 + player.h/2)) {
        enemies.splice(i,1);
        lives -= 1;
        if (lives <= 0){ gameOver(); break; }
      }
    }
  }

  // UI更新
  scoreEl.textContent = 'Score: ' + score;
  livesEl.textContent = 'Lives: ' + lives;
}

function draw(){
  // 背景
  ctx.fillStyle = '#001320';
  ctx.fillRect(0,0,W,H);

  // player が存在しないときはタイトル表示（Start を押すまでここにいる）
  if (!player) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.textAlign = 'center';
    ctx.font = '28px sans-serif';
    ctx.fillText('Simple Shooting Game', W/2, H/2 - 20);
    ctx.font = '16px sans-serif';
    ctx.fillText('Start ボタンを押してゲームを始めてください', W/2, H/2 + 10);

    // キャンバス内の小さな UI
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(6,6,120,36);
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.fillText('Score: '+score, 12, 26);
    return;
  }

  // プレイヤー
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.fillStyle = '#0ff';
  ctx.beginPath();
  ctx.moveTo(0, -player.h/2);
  ctx.lineTo(player.w/2, player.h/2);
  ctx.lineTo(-player.w/2, player.h/2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 弾
  ctx.fillStyle = '#ff0';
  bullets.forEach(b => ctx.fillRect(b.x - b.w/2, b.y - b.h/2, b.w, b.h));

  // 敵
  ctx.fillStyle = '#f55';
  enemies.forEach(e => {
    ctx.beginPath();
    ctx.ellipse(e.x, e.y, e.w/2, e.h/2, 0, 0, Math.PI*2);
    ctx.fill();
  });

  // スコア等（キャンバス内）
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(6,6,120,36);
  ctx.fillStyle = '#fff';
  ctx.font = '16px sans-serif';
  ctx.fillText('Score: '+score, 12, 26);
}

function loop(){
  try {
    update();
    draw();
  } catch (err) {
    // エラーが起きてもループは継続するようにログだけ出す
    console.error('Game loop error:', err);
  }
  requestAnimationFrame(loop);
}

function startGame(){
  score = 0;
  lives = 3;
  bullets = [];
  enemies = [];
  player = createPlayer();
  running = true;
  spawnTimer = 30;
  scoreEl.textContent = 'Score: 0';
  livesEl.textContent = 'Lives: 3';
}

function gameOver(){
  running = false;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#fff';
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('GAME OVER', W/2, H/2 - 10);
  ctx.font = '18px sans-serif';
  ctx.fillText('Score: ' + score, W/2, H/2 + 20);
}

loop(); // アニメーション開始

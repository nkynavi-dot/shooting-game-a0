// シンプルな縦スクロール・シューティング（canvas）
// タッチ操作（仮想ジョイスティック + 発射ボタン）対応版
// 追加: 敵ヒット時の効果音（WebAudioで合成）と簡易BGM（合成ループ）

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const livesEl = document.getElementById('lives');
const startBtn = document.getElementById('startBtn');

const joystick = document.getElementById('joystick');
const joystickHandle = document.getElementById('joystick-handle');
const fireBtn = document.getElementById('fireBtn');

let W, H;
// ゲーム状態（player を resize 前に宣言して参照エラーを防ぐ）
let player = null;
let keys = {};
let bullets = [];
let enemies = [];
let score = 0;
let lives = 3;
let running = false;
let spawnTimer = 0;

// オーディオ（遅延初期化：ブラウザの自動再生制限対策）
let audioCtx = null;
let masterGain = null;
function ensureAudio() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.25; // 全体ボリューム（必要ならここを下げてください）
    masterGain.connect(audioCtx.destination);
  }
  return audioCtx;
}

// --- 簡易BGM（合成メロディ） ---
let bgmGain = null;
let bgmPlaying = false;
let bgmTimer = null;
let bgmNoteIndex = 0;

function startBGM() {
  try {
    const ac = ensureAudio();
    if (!ac) return;
    if (bgmPlaying) return;
    if (ac.state === 'suspended' && typeof ac.resume === 'function') ac.resume().catch(() => {});

    bgmGain = ac.createGain();
    bgmGain.gain.value = 0.10; // BGM 音量（調整可）
    if (masterGain) bgmGain.connect(masterGain); else bgmGain.connect(ac.destination);

    // 簡単なメロディ（周波数, 秒）
    const notes = [
      [440, 0.28], [0, 0.06], [440, 0.28], [0, 0.06], [523.25, 0.36], [0, 0.06],
      [659.25, 0.44], [0, 0.12], [659.25, 0.22], [0, 0.06], [523.25, 0.36], [0, 0.06]
    ];

    bgmNoteIndex = 0;
    bgmPlaying = true;

    function scheduleNext() {
      if (!bgmPlaying) return;
      const [freq, dur] = notes[bgmNoteIndex];
      const now = ac.currentTime;
      if (freq > 0) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(freq, now);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur * 0.9);
        o.connect(g);
        g.connect(bgmGain);
        o.start(now);
        o.stop(now + dur * 0.95);
      }
      bgmNoteIndex = (bgmNoteIndex + 1) % notes.length;
      bgmTimer = setTimeout(scheduleNext, Math.max(30, Math.floor(dur * 1000)));
    }

    scheduleNext();
  } catch (e) {
    console.warn('startBGM error', e);
  }
}

function stopBGM() {
  try {
    bgmPlaying = false;
    if (bgmTimer) { clearTimeout(bgmTimer); bgmTimer = null; }
    if (bgmGain) {
      try { bgmGain.disconnect(); } catch (e) {}
      bgmGain = null;
    }
  } catch (e) { console.warn('stopBGM', e); }
}

function toggleBGM() {
  if (bgmPlaying) stopBGM(); else startBGM();
}

// --- 既存: ヒット音 ---
function playHitSound() {
  try {
    const ac = ensureAudio();
    if (!ac) return;
    if (ac.state === 'suspended' && typeof ac.resume === 'function') {
      ac.resume().catch(() => {});
    }

    const now = ac.currentTime;

    // 高域の短いパルス
    const o1 = ac.createOscillator();
    const g1 = ac.createGain();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(900, now);
    g1.gain.setValueAtTime(0.0001, now);
    g1.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    o1.connect(g1);
    g1.connect(masterGain);
    o1.start(now);
    o1.stop(now + 0.18);

    // 低域のパンチ感
    const o2 = ac.createOscillator();
    const g2 = ac.createGain();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(160, now);
    g2.gain.setValueAtTime(0.0001, now);
    g2.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    o2.connect(g2);
    g2.connect(masterGain);
    o2.start(now);
    o2.stop(now + 0.25);

    // 短いノイズ（アタックを強調）
    const bufferSize = Math.floor(0.2 * ac.sampleRate);
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const nb = ac.createBufferSource();
    nb.buffer = buffer;
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.12, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    nb.connect(ng);
    ng.connect(masterGain);
    nb.start(now);
    nb.stop(now + 0.15);
  } catch (e) {
    console.warn('playHitSound error', e);
  }
}

function setMasterVolume(v) {
  if (!masterGain) return;
  masterGain.gain.value = v;
}

function mute() { if (masterGain) masterGain.gain.value = 0; }
function unmute() { if (masterGain) masterGain.gain.value = 0.25; }

// ゲームの初期化やUI操作があればオーディオの resume を試みる
function unlockAudioOnUserGesture() {
  const ac = ensureAudio();
  if (!ac) return;
  if (ac.state === 'suspended' && typeof ac.resume === 'function') {
    ac.resume().catch(() => {});
  }
}

// イベントで解除（start やタッチで呼ぶ）
startBtn.addEventListener('click', unlockAudioOnUserGesture);
canvas.addEventListener('touchstart', unlockAudioOnUserGesture, { passive: true });

function resize() {
  W = canvas.width = Math.min(720, window.innerWidth - 20);
  H = canvas.height = Math.max(400, window.innerHeight - 140);
  // 画面サイズ変更時はプレイヤーの高さを指で隠れにくい位置に維持
  if (player) player.y = H - 130;
}
window.addEventListener('resize', resize);
resize();

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
  // 指で隠れにくいよう、やや上（底辺から130px上）に配置
  return { x: W/2, y: H-130, w: 30, h: 20, speed: 4, cooldown:0 };
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
    // 弾は機体の先端から出るように調整
    bullets.push({ x: player.x, y: player.y - player.h * 0.9, w:4, h:8, speed:6 });
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
        // 効果音を再生
        playHitSound();
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

function drawPlayer() {
  // 機体（飛行機）を描画。player.x/y を中心に相対描画。
  ctx.save();
  ctx.translate(player.x, player.y);

  // スケール基準（元デザイン幅/高さを30x20とする）
  const sx = player.w / 30;
  const sy = player.h / 20;
  ctx.scale(sx, sy);

  // 機体本体（胴体）
  ctx.fillStyle = '#00ddff';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.quadraticCurveTo(10, -6, 12, 0);
  ctx.quadraticCurveTo(10, 6, 0, 8);
  ctx.quadraticCurveTo(-10, 6, -12, 0);
  ctx.quadraticCurveTo(-10, -6, 0, -8);
  ctx.closePath();
  ctx.fill();

  // ウィング（左右）
  ctx.fillStyle = '#0088cc';
  ctx.beginPath();
  ctx.moveTo(-6, 1);
  ctx.lineTo(-18, 8);
  ctx.lineTo(-12, 10);
  ctx.lineTo(0, 4);
  ctx.lineTo(12, 10);
  ctx.lineTo(18, 8);
  ctx.lineTo(6, 1);
  ctx.closePath();
  ctx.fill();

  // コックピット
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(4, -2, 3, 2, 0, 0, Math.PI*2);
  ctx.fill();

  // 垂直尾翼
  ctx.fillStyle = '#00bcd4';
  ctx.beginPath();
  ctx.moveTo(-10, -2);
  ctx.lineTo(-18, -14);
  ctx.lineTo(-8, -6);
  ctx.closePath();
  ctx.fill();

  // 細かいハイライト
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(2, -6);
  ctx.quadraticCurveTo(6, -4, 6, 0);
  ctx.quadraticCurveTo(6, 4, 2, 6);
  ctx.fill();

  ctx.restore();
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

  // プレイヤー（飛行機）
  drawPlayer();

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
  // ユーザー操作があったタイミングで audio を解除
  unlockAudioOnUserGesture();

  score = 0;
  lives = 3;
  bullets = [];
  enemies = [];
  player = createPlayer();
  running = true;
  spawnTimer = 30;
  scoreEl.textContent = 'Score: 0';
  livesEl.textContent = 'Lives: 3';

  // BGM を開始
  startBGM();
}

function gameOver(){
  running = false;
  // BGM を停止
  stopBGM();

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

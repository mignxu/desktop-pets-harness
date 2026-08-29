'use strict';
/* =====================================================================
 * 小呆动作拼装 demo —— DyberPet 格式播放器 + 状态机
 *
 * 分层（对应笔记第 6 节"契约先行"思路，三层可各自替换）：
 *   [Loader]  解析 act_conf.json / pet_conf.json，探测并预加载帧图
 *   [Player]  按 frame_refresh 逐帧播放一个动作（act_num 循环、anchor 平移、need_move 位移）
 *   [Brain]   状态机：随机动作组(pet_conf.random_act) + 交互事件 + 壳状态优先级(笔记 7.3)
 *
 * DyberPet 格式语义均按官方素材开发文档 art_dev.md 核实：
 *   - 帧图命名 <images>_<序号>.png，从 0 连续编号，按序播放
 *   - act_num      动画整段重复次数
 *   - frame_refresh单帧停留秒数
 *   - need_move + direction + frame_move   行走：每帧水平位移 px
 *   - anchor [x,y] 相对默认位置的平移，+x 向右、+y 向下（睡觉等动作用来微调贴地）
 *   - pet_conf.random_act[].act_list  动作组：按顺序拼接播放
 *   - pet_conf.random_act[].act_type  [饱食度分级, 好感度解锁等级]（养成数值，
 *     本产品锁定"去养成"，demo 里忽略，act_prob 直接当相对权重用）
 *   - pet_conf.patpat  按饱食度分级的摸头反应；demo 无数值，改为"睡觉中点击=吵醒"
 * ===================================================================== */

const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const loadImg = src => new Promise((ok, no) => {
  const im = new Image();
  im.onload = () => ok(im);
  im.onerror = () => no(new Error(src));
  im.src = src;
});

/* ============================ Loader ============================ */

const PACK = '../小呆/';
const FB = window.__FALLBACK__;          // file:// 直开时的配置快照
const acts = {};                         // 动作名 -> act_conf 定义
const frames = {};                       // 素材前缀 -> Image[]
let petConf = FB.pet_conf;

async function fetchJson(url, fallback) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw 0;
    return await r.json();
  } catch (e) {
    log('fetch 失败，使用内嵌配置快照: ' + url);
    return fallback;
  }
}

/* 帧数探测：与 DyberPet 一致，按序号枚举直到第一个缺失（兼容 _0 与 _00 两种命名） */
async function discover(prefix) {
  const out = [];
  for (let i = 0; i < 120; i++) {
    const pad = String(i).padStart(2, '0');
    try {
      out.push(await loadImg(`${PACK}action/${prefix}_${pad}.png`));
    } catch (e) {
      if (i < 10) {
        try { out.push(await loadImg(`${PACK}action/${prefix}_${i}.png`)); }
        catch (e2) { break; }
      } else break;
    }
  }
  return out;
}

async function loadPet() {
  const actConf = await fetchJson(PACK + 'act_conf.json', FB.act_conf);
  petConf = await fetchJson(PACK + 'pet_conf.json', FB.pet_conf);
  Object.assign(acts, actConf);

  const prefixes = [...new Set(Object.values(acts).map(d => d.images))];
  let done = 0;
  await Promise.all(prefixes.map(async p => {
    frames[p] = await discover(p);
    $('#loadTip').textContent = `加载帧素材 ${++done}/${prefixes.length} 套…`;
  }));

  buildActChips();
  buildGroupInfo();
  $('#loadTip').textContent =
    `就绪：${Object.keys(acts).length} 个动作 / ${prefixes.length} 套素材 / ` +
    `${Object.values(frames).reduce((a, f) => a + f.length, 0)} 帧`;
  log(`加载完成：${Object.keys(acts).length} 个动作定义，帧图共 ${Object.values(frames).reduce((a, f) => a + f.length, 0)} 张`);
}

/* ============================ 舞台与绘制 ============================ */

const pet = { x: 0, y: 0, groundY: 0 };          // (x, y) = 脚底中心；y 默认贴地
const petEl = $('#pet'), petImg = $('#petImg');
const bubbleEl = $('#bubble'), lightEl = $('#light');

function resize() {
  pet.groundY = innerHeight - 56;                // 地面线 = 底部地面条上沿
  pet.x = clamp(pet.x || innerWidth / 2, 60, innerWidth - 60);
  pet.y = Math.min(pet.y || pet.groundY, pet.groundY);
}
addEventListener('resize', resize);

/* anchor：+x 向右、+y 向下（art_dev.md 官方语义），叠加在"底部对齐地面"的默认位上 */
function draw(img, def) {
  const s = petConf.scale ?? 1;
  const w = img.naturalWidth * s, h = img.naturalHeight * s;
  const ax = (def.anchor?.[0] ?? 0) * s, ay = (def.anchor?.[1] ?? 0) * s;
  petImg.src = img.src;
  petEl.style.width = w + 'px';
  petEl.style.height = h + 'px';
  petEl.style.left = (pet.x - w / 2 + ax) + 'px';
  petEl.style.top = (pet.y - h + ay) + 'px';
  bubbleEl.style.left = pet.x + 'px';
  bubbleEl.style.top = Math.max(8, pet.y - h - 66) + 'px';
  lightEl.style.left = (pet.x - 48) + 'px';
  lightEl.style.top = (pet.y - 14) + 'px';
}

/* ============================ Player ============================ */

let epoch = 0;   // 抢占计数：拖拽/事件/壳状态切换时 ++epoch，正在播的动作立即中止

async function playAct(name, opts = {}) {
  const def = acts[name];
  if (!def) { log('⚠ 缺少动作定义: ' + name); return 'done'; }
  const fr = frames[def.images] || [];
  if (!fr.length) { log('⚠ 缺少帧素材: ' + def.images); return 'done'; }

  const loops = opts.loops ?? (def.act_num ?? 1);
  const dt = (def.frame_refresh ?? 0.08) * 1000;
  const my = opts.epoch ?? epoch;
  const extra = opts.aborted || (() => false);
  const isAbort = () => epoch !== my || extra();

  setHud(name, def);
  for (let k = 0; k < loops; k++) {
    for (let i = 0; i < fr.length; i++) {
      if (isAbort()) return 'aborted';
      draw(fr[i], def);
      if (def.need_move) stepMove(def);
      hudFrame(i, fr.length, k + 1, loops);
      await sleep(dt);
    }
  }
  return 'done';
}

/* 行走位移：frame_move px/帧（乘 scale），方向由 act_conf 的 direction 决定 */
function stepMove(def) {
  const v = (def.frame_move ?? 3) * (petConf.scale ?? 1);
  pet.x = clamp(pet.x + (def.direction === 'left' ? -v : v), 60, innerWidth - 60);
}

/* ============================ HUD 与日志 ============================ */

const ACT_LABEL = {
  default: '待机呼吸', up: '朝上(复用stand)', down: '朝下(复用stand)',
  left: '朝左(复用stand)', right: '朝右(复用stand)',
  left_walk: '向左走', right_walk: '向右走',
  sleep: '睡觉(持续状态)', sleepy: '打瞌睡(入睡过渡)',
  drag: '被拖拽', edge: '屏幕边缘悬挂(hide)', fall: '自由落体', onfloor: '落地缓冲',
  patpat1: '摸摸头①', patpat2: '摸摸头②', focus: '专注/干活中',
  feed_1: '喂食反应①', feed_2: '喂食反应②', feed_3: '喂食反应③',
  playball: '玩球', hy1: '活跃彩蛋·起手', hy1end: '活跃彩蛋·收尾',
  disturbed: '被吵醒/求关注'
};

function setHud(name, def) {
  $('#actName').textContent = name;
  $('#actLabel').textContent = ACT_LABEL[name] || '';
  $('#actParams').textContent =
    `素材 ${def.images} × ${(frames[def.images] || []).length} 帧 · 单帧 ${def.frame_refresh ?? 0.08}s · 循环 ${def.act_num ?? 1} 次` +
    (def.need_move ? ` · ${def.direction} 位移 ${def.frame_move}px/帧` : '') +
    (def.anchor ? ` · anchor[${def.anchor}]` : '');
  markChip(name);
}
function hudFrame(i, n, k, loops) {
  $('#actFrame').textContent = `帧 ${i + 1}/${n} · 第 ${k}/${loops} 轮`;
}
function setGroupHud(text) { $('#actGroup').textContent = text; }

function log(msg) {
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const div = document.createElement('div');
  div.textContent = `[${t}] ${msg}`;
  const box = $('#log');
  box.prepend(div);
  while (box.children.length > 9) box.lastChild.remove();
}

/* ============================ Brain：状态机 ============================ */
/* 优先级（笔记 7.3）：审批 > 拖拽/下落(物理事件) > 干活中(focus) > 空闲随机组 + 互动插播 */

const bus = [];                        // 交互事件队列
const sim = { harness: 'idle' };       // 壳状态：idle | working | approval
const drag = { active: false, cx: 0, cy: 0, sx: 0, sy: 0, moved: false, t0: 0 };
let manualHold = false;                // 手动模式：Brain 挂起，动作全部由用户点选
let wasSleeping = false;

const idleInterrupt = () => bus.length > 0 || drag.active || manualHold || sim.harness !== 'idle';

function pickIdleGroup() {
  const pool = petConf.random_act.filter(g => g.act_prob > 0);
  let r = Math.random() * pool.reduce((a, g) => a + g.act_prob, 0);
  for (const g of pool) { r -= g.act_prob; if (r <= 0) return g; }
  return pool[pool.length - 1];
}

async function brain() {
  for (;;) {
    if (manualHold) { await sleep(120); continue; }
    if (drag.active) { await dragSequence(); continue; }

    if (sim.harness === 'approval') {                  // 最高优先级：身体反复"求关注"
      showBubble('待审批：Claude Code 想执行命令 →', 'approval', true);
      await playAct('disturbed', {
        loops: Infinity,
        aborted: () => sim.harness !== 'approval' || drag.active || manualHold || bus.length > 0
      });
      if (sim.harness !== 'approval') { hideBubble(); log('审批已处理 → 回到 ' + sim.harness); }
      continue;
    }

    if (bus.length) { await handleEvent(bus.shift()); continue; }

    if (sim.harness === 'working') {                   // 干活中 = 仅播放专注动画（官方 focus 语义）
      await playAct(petConf.focus, {
        loops: Infinity,
        aborted: () => sim.harness !== 'working' || drag.active || manualHold || bus.length > 0
      });
      continue;
    }

    await idleOnce();                                  // 空闲：按权重抽一个动作组
  }
}

/* 动作组拼接：act_list 里的动作按定义顺序依次播放 —— 这就是"拼起来"的第一层 */
async function idleOnce() {
  const g = pickIdleGroup();
  log(`空闲 → 随机组【${g.name}】act_list=[${g.act_list.join(', ')}]`);
  setGroupHud(`动作组【${g.name}】（random_act）`);
  for (const act of g.act_list) {
    const def = acts[act];
    if (def?.need_move) {
      await walkAct(act);
    } else if (def?.images === 'sleep') {              // 睡觉组 → 进入持续睡眠，事件/超时唤醒
      wasSleeping = true;
      const t0 = Date.now();
      await playAct(act, { loops: Infinity, aborted: () => idleInterrupt() || Date.now() - t0 > 25000 });
      const byDrag = drag.active;
      wasSleeping = false;
      if (!byDrag && sim.harness === 'idle' && !manualHold && !bus.length) {
        log('睡醒 → disturbed 伸懒腰');
        await playAct('disturbed');
      }
    } else {
      await playAct(act, { aborted: idleInterrupt });
    }
    if (idleInterrupt()) break;
  }
}

/* 行走：一直走，到屏幕边缘 → 播放 hide(挂边缘) 动作 → 自然掉头走回 */
async function walkAct(act) {
  const def = acts[act];
  const nearEdge = () => pet.x <= 70 || pet.x >= innerWidth - 70;
  await playAct(act, { loops: Infinity, aborted: () => idleInterrupt() || nearEdge() });
  if (nearEdge() && !idleInterrupt()) {
    log(`到达屏幕边缘 → ${petConf.hide}（挂边缘）→ 掉头`);
    await playAct(petConf.hide, { aborted: idleInterrupt });
  }
}

async function handleEvent(ev) {
  if (ev.type === 'pat') {
    if (wasSleeping) {                                 // pet_conf.patpat 的 0 级映射思路：睡觉中点它=吵醒
      wasSleeping = false;
      log('点击：睡觉中被吵醒 → disturbed');
      await playAct('disturbed', { aborted: idleInterrupt });
    } else {
      const a = Math.random() < 0.5 ? 'patpat1' : 'patpat2';
      log(`点击：摸摸头 → ${a}`);
      await playAct(a, { aborted: idleInterrupt });
    }
  } else if (ev.type === 'feed') {
    const a = 'feed_' + (1 + Math.floor(Math.random() * 3));
    log(`喂食 → ${a}（1/2/3 共用 feed 素材）`);
    await playAct(a, { aborted: idleInterrupt });
  } else if (ev.type === 'sleep') {
    log('入睡：sleepy(过渡) → sleep(持续)');
    setGroupHud('手动入睡');
    wasSleeping = true;
    await playAct('sleepy', { aborted: idleInterrupt });
    const t0 = Date.now();
    await playAct('sleep', { loops: Infinity, aborted: () => idleInterrupt() || Date.now() - t0 > 30000 });
    const byDrag = drag.active;
    wasSleeping = false;
    if (!byDrag && sim.harness === 'idle' && !manualHold && !bus.length) {
      log('自然醒 → disturbed');
      await playAct('disturbed', { aborted: idleInterrupt });
    }
  }
}

/* 拖拽 → 松手 fall 下落 → onfloor 落地缓冲（物理事件，优先级仅次于审批） */
async function dragSequence() {
  const def = acts[petConf.drag], fr = frames[def.images] || [];
  const dt = (def.frame_refresh ?? 0.08) * 1000;
  log(`按住拖拽 → ${petConf.drag}`);
  setGroupHud('被拖拽（物理事件）');
  let i = 0, drew = false;
  while (drag.active) {
    pet.x = clamp(drag.cx, 60, innerWidth - 60);
    pet.y = clamp(drag.cy, 40, pet.groundY);
    draw(fr[i % fr.length], def);
    hudFrame(i % fr.length, fr.length, 1, 1);
    i++; drew = true;
    await sleep(dt);
  }
  wasSleeping = false;
  if (pet.y < pet.groundY - 2) {                       // 离地松手才下落
    log(`松手 → ${petConf.fall} 自由落体`);
    const fd = acts[petConf.fall], ff = frames[fd.images] || [];
    let vy = 0, j = 0;
    while (pet.y < pet.groundY - 2) {
      vy = Math.min(vy + 1.1, 26);
      pet.y = Math.min(pet.groundY, pet.y + vy);
      draw(ff[Math.floor(j / 3) % ff.length], fd);
      j++;
      await sleep(16);
    }
    pet.y = pet.groundY;
    log(`落地 → ${petConf.on_floor}`);
    await playAct(petConf.on_floor);
  } else if (drew) {
    pet.y = pet.groundY;
  }
}

/* ============================ 指针交互 ============================ */

petEl.addEventListener('pointerdown', e => {
  e.preventDefault();
  manualHold = false;                                  // 拖拽退出手动模式
  epoch++;                                             // 抢占：中止当前动作
  drag.active = true; drag.moved = false; drag.t0 = Date.now();
  drag.sx = drag.cx = e.clientX; drag.sy = drag.cy = e.clientY;
  petEl.setPointerCapture(e.pointerId);
  petEl.classList.add('grabbing');
});
addEventListener('pointermove', e => {
  if (!drag.active) return;
  drag.cx = e.clientX; drag.cy = e.clientY;
  if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 8) drag.moved = true;
});
addEventListener('pointerup', () => {
  if (!drag.active) return;
  drag.active = false;
  petEl.classList.remove('grabbing');
  if (!drag.moved && Date.now() - drag.t0 < 500) pushEvent({ type: 'pat' });   // 原地点击 = 摸摸
});
function pushEvent(type) { bus.push({ type }); }

/* ============================ 控制面板 ============================ */

$('#btnPat').onclick = () => { manualHold = false; epoch++; pushEvent('pat'); };
$('#btnFeed').onclick = () => { manualHold = false; epoch++; pushEvent('feed'); };
$('#btnSleep').onclick = () => { manualHold = false; epoch++; pushEvent('sleep'); };
$('#btnAuto').onclick = () => { manualHold = false; epoch++; log('返回自动模式'); };

$('#btnIdle').onclick = () => { sim.harness = 'idle'; updateStateChip(); log('壳事件：恢复空闲'); };
$('#btnWork').onclick = () => { sim.harness = 'working'; updateStateChip(); epoch++; log('壳事件：harness 开始干活 → focus（仅播专注动画）'); };
$('#btnApproval').onclick = () => { sim.harness = 'approval'; updateStateChip(); epoch++; log('壳事件：⚠ 审批请求（最高优先级，打断一切）'); };
$('#bubbleBtn').onclick = () => { sim.harness = 'idle'; updateStateChip(); hideBubble(); log('气泡【去处理】→ 审批完成 → 空闲'); };

function updateStateChip() {
  const m = { idle: ['空闲', '#3fbf6f'], working: ['干活中', '#e0a13f'], approval: ['待审批', '#e05656'] };
  const [t, c] = m[sim.harness];
  const el = $('#stateChip');
  el.textContent = t;
  el.style.background = c;
  lightEl.style.background = c;                        // 状态光与状态chip同源（笔记 7.3"三处同源"）
}

let bubbleTimer = null;
function showBubble(text, kind, sticky) {
  bubbleEl.className = 'bubble show' + (kind ? ' ' + kind : '');
  $('#bubbleText').textContent = text;
  $('#bubbleBtn').style.display = sticky ? 'inline-block' : 'none';
  clearTimeout(bubbleTimer);
  if (!sticky) bubbleTimer = setTimeout(hideBubble, 2600);
}
function hideBubble() { bubbleEl.classList.remove('show'); }

function buildActChips() {
  const box = $('#chips');
  box.innerHTML = '';
  for (const name of Object.keys(acts)) {
    const def = acts[name];
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.act = name;
    b.textContent = `${name} · ${def.images}`;
    b.title = (ACT_LABEL[name] || '') +
      (def.anchor ? ` · anchor[${def.anchor}]` : '') +
      (def.need_move ? ` · ${def.direction} 位移` : '');
    b.onclick = () => {
      manualHold = true;                               // 手动模式：Brain 挂起，点谁播谁
      epoch++;
      log(`手动播放：${name}（${ACT_LABEL[name] || ''}）`);
      playAct(name).catch(() => {});
    };
    box.appendChild(b);
  }
}
function markChip(name) {
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.act === name));
}

function buildGroupInfo() {
  const box = $('#groups');
  box.innerHTML = '';
  for (const g of petConf.random_act) {
    const d = document.createElement('div');
    d.className = 'grp';
    d.innerHTML = `<b>${g.name}</b> <span class="dim">act_list=[${g.act_list.join(',')}] 权重 ${g.act_prob}</span>`;
    box.appendChild(d);
  }
}

/* ============================ 启动 ============================ */

(async function init() {
  resize();
  updateStateChip();
  log('三层结构：Loader(解析 act_conf/pet_conf) → Player(逐帧+anchor+位移) → Brain(动作组+事件+壳状态)');
  await loadPet();
  brain();
})();

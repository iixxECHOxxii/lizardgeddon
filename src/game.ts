import Phaser from 'phaser';

// Lizardgeddon v0.45 — wizard visible-height correction; v0.29 gameplay preserved.
// Preserve these exports and the scene class name for the starter's Phaser boot code.
export const WIDTH = 400;
export const HEIGHT = 225;

const WORLD_WIDTH = 1600;
const WORLD_HEIGHT = 1200;
const WALL = 24;
const SPEED = 110;
const FONT = '"Press Start 2P", monospace';
const START = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };



interface Obstacle { x: number; y: number; radius: number; }
// Fixed positions make playtests reproducible; spacing avoids corridors and choke points.
const PILLARS: Obstacle[] = [
  { x: 220, y: 190, radius: 16 }, { x: 560, y: 175, radius: 17 },
  { x: 1050, y: 190, radius: 16 }, { x: 1370, y: 250, radius: 17 },
  { x: 340, y: 470, radius: 16 }, { x: 1180, y: 475, radius: 17 },
  { x: 185, y: 785, radius: 16 }, { x: 525, y: 960, radius: 17 },
  { x: 1060, y: 940, radius: 16 }, { x: 1390, y: 800, radius: 17 },
];

function noise(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function canWalk(x: number, y: number): boolean {
  const margin = WALL + 7;
  if (x < margin || y < margin || x > WORLD_WIDTH - margin || y > WORLD_HEIGHT - margin) return false;
  return !PILLARS.some(p => Math.hypot(x - p.x, y - p.y) < p.radius + 7);
}

const DIRECTIONS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
const WIZARD_HEIGHT = 42; // Same world-space height as the previous 14px x 3 wizard.


// v0.28: self-contained cinematic Web Audio synthesis. No downloaded samples.
class DungeonAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private ambience?: { source: AudioBufferSourceNode; gain: GainNode };
  private volume = 0.38;
  private muted = false;
  private last: Record<string, number> = {};
  private noiseBuffer?: AudioBuffer;

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(ctx.destination);
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;
      this.startAmbience();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  dispose(): void {
    if (this.ambience) { try { this.ambience.source.stop(); } catch { /* already stopped */ } }
    this.ambience = undefined;
    const ctx = this.ctx;
    this.ctx = undefined;
    this.master = undefined;
    if (ctx) void ctx.close();
  }
  get level(): number { return this.muted ? 0 : this.volume; }
  adjust(amount: number): void {
    this.volume = Math.max(0, Math.min(1, Math.round((this.volume + amount) * 100) / 100));
    if (this.volume > 0) this.muted = false;
    this.applyVolume();
  }
  toggleMute(): void { this.muted = !this.muted; this.applyVolume(); }
  private applyVolume(): void {
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.015);
  }
  private allowed(name: string, cooldownMs: number): boolean {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const now = this.ctx.currentTime * 1000;
    if (now - (this.last[name] ?? -Infinity) < cooldownMs) return false;
    this.last[name] = now;
    return true;
  }
  private tone(freq: number, end: number, duration: number, amp: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ctx, output = this.master;
    if (!ctx || !output) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(10, freq), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(10, end), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain); gain.connect(output);
    osc.start(t); osc.stop(t + duration + 0.015);
  }
  private noise(duration: number, amp: number, cutoff: number, highpass = false, delay = 0): void {
    const ctx = this.ctx, output = this.master, buffer = this.noiseBuffer;
    if (!ctx || !output || !buffer) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer;
    filter.type = highpass ? 'highpass' : 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter); filter.connect(gain); gain.connect(output);
    src.start(t); src.stop(t + duration + 0.012);
  }
  private startAmbience(): void {
    const ctx = this.ctx, output = this.master, buffer = this.noiseBuffer;
    if (!ctx || !output || !buffer) return;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    src.buffer = buffer; src.loop = true;
    filter.type = 'lowpass'; filter.frequency.value = 170;
    gain.gain.value = 0.07;
    src.connect(filter); filter.connect(gain); gain.connect(output); src.start();
    this.ambience = { source: src, gain };
    // Very low, sustained dungeon resonance.
    this.tone(43, 42, 8, 0.018, 'sine');
  }
  missile(): void {
    if (!this.allowed('missile', 75)) return;
    this.tone(440, 115, 0.14, 0.13, 'sawtooth');
    this.tone(190, 70, 0.17, 0.18);
    this.noise(0.085, 0.07, 2300, true);
  }
  impact(): void {
    if (!this.allowed('impact', 65)) return;
    this.noise(0.085, 0.12, 2800, true);
    this.tone(140, 50, 0.10, 0.08, 'triangle');
  }
  death(): void {
    // Suppress mass-kill overlap; lightning has its own single large effect.
    if (!this.allowed('death', 170)) return;
    this.tone(160 + Math.random() * 45, 65, 0.17, 0.10, 'sawtooth');
    this.noise(0.12, 0.08, 850);
  }
  // Multi-layer thunder: explosive broadband transient, deep rolling body,
  // and irregular electrical snaps. Dedicated compression keeps peaks controlled.
  lightning(targetCount: number): void {
    if (!this.allowed('lightning', 180)) return;
    const ctx = this.ctx, output = this.master, buffer = this.noiseBuffer;
    if (!ctx || !output || !buffer) return;
    const t = ctx.currentTime;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 12;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.002;
    compressor.release.value = 0.24;
    compressor.connect(output);

    const burst = (delay: number, duration: number, peak: number, cutoff: number,
                   filterType: BiquadFilterType, attack = 0.004) => {
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      const when = t + delay;
      source.buffer = buffer;
      filter.type = filterType;
      filter.frequency.setValueAtTime(cutoff, when);
      if (filterType === 'lowpass') filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.22), when + duration);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(peak, when + attack);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
      source.connect(filter); filter.connect(gain); gain.connect(compressor);
      source.start(when); source.stop(when + duration + 0.015);
    };
    // Lightning's instantaneous air-splitting crack, with a heavy chest-level hit.
    burst(0, 0.16, 1.15, 7000, 'highpass', 0.002);
    burst(0.008, 0.34, 0.95, 2200, 'lowpass', 0.003);
    burst(0.018, 0.85, 0.85, 260, 'lowpass', 0.012);
    // Long, uneven rolling thunder rather than a simple descending oscillator.
    burst(0.20, 1.50, 0.62, 450, 'lowpass', 0.09);
    burst(0.52, 1.22, 0.42, 310, 'lowpass', 0.10);
    // Low-end impact, separate from the hissy electrical components.
    const sub = ctx.createOscillator(), subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(92, t);
    sub.frequency.exponentialRampToValueAtTime(34, t + 0.43);
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.exponentialRampToValueAtTime(0.70, t + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    sub.connect(subGain); subGain.connect(compressor);
    sub.start(t); sub.stop(t + 0.68);
    // Irregular chain snaps: one coherent event, not 100 simultaneous death sounds.
    const snaps = Math.min(12, Math.max(2, Math.ceil(targetCount / 9)));
    for (let i = 0; i < snaps; i++) {
      const delay = 0.065 + i * 0.055 + Math.random() * 0.027;
      burst(delay, 0.045 + Math.random() * 0.045, 0.33, 3100 + Math.random() * 3200, 'highpass', 0.002);
    }
    // Briefly duck ambience so the strike has perceptual impact.
    if (this.ambience) {
      const gain = this.ambience.gain.gain;
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(gain.value, t);
      gain.linearRampToValueAtTime(0.014, t + 0.025);
      gain.linearRampToValueAtTime(0.07, t + 1.6);
    }
  }
  pickup(kind: 'rapid' | 'multi' | 'heal' | 'lightning'): void {
    if (!this.allowed('pickup', 80)) return;
    const base = kind === 'lightning' ? 270 : kind === 'heal' ? 520 : 430;
    this.tone(base, base * 1.5, 0.19, 0.13, 'sine');
    this.tone(base * 1.5, base * 2, 0.24, 0.11, 'sine', 0.09);
    if (kind === 'lightning') this.tone(85, 55, 0.40, 0.15, 'triangle');
  }
  hurt(): void {
    if (!this.allowed('hurt', 300)) return;
    this.tone(135, 43, 0.30, 0.28, 'sawtooth');
    this.noise(0.17, 0.16, 560);
  }
  gameOver(): void {
    if (!this.allowed('gameover', 1000)) return;
    this.tone(140, 35, 1.25, 0.28, 'sawtooth');
    this.tone(70, 26, 1.6, 0.20);
    this.noise(1.0, 0.11, 280);
  }
}

export class IslandScene extends Phaser.Scene {
  private audio = new DungeonAudio();
  private player!: Phaser.GameObjects.Image;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private restart = () => this.scene.restart();
  private bolts: { x: number; y: number; vx: number; vy: number; life: number; view: Phaser.GameObjects.Container; trailClock: number }[] = [];
  private enemies: { x: number; y: number; view: Phaser.GameObjects.Container; limbs: Phaser.GameObjects.Image[]; tail: Phaser.GameObjects.Image; phase: number }[] = [];
  private missileParticles: { view: Phaser.GameObjects.Arc; vx: number; vy: number; life: number; maxLife: number }[] = [];
  private hp = 5;
  private kills = 0;
  private survived = 0;
  private nextFire = 0;
  private nextSpawn = 0;
  private nextDamage = 0;
  private dead = false;
  private lightningHeld = false;
  private lightningReady = 0;
  private lightningCharges = 0;
  private hudGraphics!: Phaser.GameObjects.Graphics;
  private hudContainer!: Phaser.GameObjects.Container;
  private hudHealth!: Phaser.GameObjects.Text;
  private hudKills!: Phaser.GameObjects.Text;
  private hudTime!: Phaser.GameObjects.Text;
  private hudLightning!: Phaser.GameObjects.Text;
  private hudBuffs!: Phaser.GameObjects.Text;
  private titleOpen = true;
  private pickups: { x: number; y: number; kind: 'rapid' | 'multi' | 'heal' | 'lightning'; view: Phaser.GameObjects.Container; life: number }[] = [];
  private rapidUntil = 0;
  private multiUntil = 0;
  private walkClock = 0;
  private walkFrame = -1;
  private atmosphereLights: { glow: Phaser.GameObjects.Image; phase: number; speed: number; baseAlpha: number }[] = [];

  constructor() { super('island'); }

  preload(): void {
    for (const part of ['rear-far','front-far','rear-near','front-near','tail','body']) this.load.image(`lizard-${part}`, `./assets/lizard-rig/${part}.png`);
    this.load.image('stone-floor-art', './assets/dungeon/stone-floor.png');
    this.load.image('broken-column-art', './assets/dungeon/broken-column.png');
    for (const asset of ['brazier', 'crystal', 'rubble', 'torch-glow', 'crystal-glow']) {
      this.load.image(`dungeon-${asset}`, `./assets/dungeon/${asset}.png`);
    }
    for (const direction of DIRECTIONS) {
      this.load.image(`wizard-${direction}`, `./assets/wizard/wizard-${direction}.png`);
    }
    for (const direction of DIRECTIONS) {
      for (let i = 0; i < 6; i++) {
        this.load.image(`wizard-${direction}-walk-${i}`, `./assets/wizard/wizard-${direction}-walk-${i}.png`);
      }
    }
  }

  create(): void {
    this.bolts = []; this.enemies = []; this.pickups = []; this.missileParticles = [];
    this.rapidUntil = 0; this.multiUntil = 0;
    this.hp = 5; this.kills = 0; this.survived = 0;
    this.lightningHeld = false; this.lightningReady = 0;
    this.lightningCharges = 0;
    this.walkClock = 0; this.walkFrame = -1;
    this.atmosphereLights = [];
    this.nextFire = 0; this.nextSpawn = 0; this.nextDamage = 0; this.dead = false;
    this.audio.dispose();
    this.audio = new DungeonAudio();
    this.drawDungeon();
    this.player = this.add.image(START.x, START.y, 'wizard-s')
      .setOrigin(0.5, 1).setDepth(START.y + 2);
    this.setWizardDirection('s');

    this.cameras.main.setZoom(2);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 1, 1);
    this.cameras.main.roundPixels = true;

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT') as typeof this.keys;
    // Suppress the browser's context menu while using right-click lightning.
    const preventMenu = (event: MouseEvent) => event.preventDefault();
    this.game.canvas.addEventListener('contextmenu', preventMenu);
    this.events.once('shutdown', () => this.game.canvas.removeEventListener('contextmenu', preventMenu));
    this.input.keyboard!.addCapture(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE']);
    // Browsers require an explicit user gesture before audio starts.
    const unlockAudio = () => this.audio.unlock();
    this.game.canvas.addEventListener('pointerdown', unlockAudio);
    this.input.keyboard!.on('keydown', unlockAudio);
    const volumeKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyM') this.audio.toggleMute();
      else if (event.code === 'BracketLeft' || event.code === 'Minus') this.audio.adjust(-0.1);
      else if (event.code === 'BracketRight' || event.code === 'Equal') this.audio.adjust(0.1);
    };
    this.input.keyboard!.on('keydown', volumeKey);
    this.events.once('shutdown', () => {
      this.game.canvas.removeEventListener('pointerdown', unlockAudio);
      this.input.keyboard?.off('keydown', unlockAudio);
      this.input.keyboard?.off('keydown', volumeKey);
      this.audio.dispose();
    });
    const restartButton = document.querySelector('#restart');
    restartButton?.addEventListener('click', this.restart);
    this.events.once('shutdown', () => restartButton?.removeEventListener('click', this.restart));
    this.createHud();
    this.updateStatus();
    this.showTitleScreen();
  }

  private showTitleScreen(): void {
    this.titleOpen = true;
    const canvas = this.game.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;
    const oldPosition = parent.style.position;
    if (!oldPosition || oldPosition === 'static') parent.style.position = 'relative';
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Lizardgeddon title screen');
    overlay.style.cssText = `position:absolute;z-index:100;overflow:hidden;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;color:#f9eac7;background:linear-gradient(180deg,rgba(13,7,22,.85),rgba(13,7,22,.04) 38%,rgba(12,7,20,.22) 57%,rgba(12,7,20,.95)),url(./assets/title/lizardgeddon-title.png) center/cover no-repeat;font-family:Georgia,serif;`;
    overlay.innerHTML = `<div style="padding-top:4%;text-shadow:0 3px 8px #09040e,0 0 20px #180820"><div style="font-size:clamp(22px,5vw,62px);font-weight:900;letter-spacing:.065em;color:#f6d58a;-webkit-text-stroke:1px #58341e">LIZARDGEDDON</div><div style="font-size:clamp(10px,1.8vw,19px);font-style:italic;margin-top:4px">One wizard. Too many lizards.</div><div style="font-size:clamp(10px,1.65vw,18px);font-style:italic;margin-top:5px;color:#f4d999">How long can you survive?</div></div><div style="display:flex;flex-direction:column;align-items:center;gap:9px;padding-bottom:4%;width:95%;text-shadow:0 2px 5px #000"><button type="button" id="lizardgeddon-play" style="cursor:pointer;background:linear-gradient(#6938a4,#31144e);border:2px solid #e4ba6d;border-radius:6px;color:#fff1ce;font:700 clamp(12px,2vw,22px) Georgia,serif;padding:10px 24px;box-shadow:0 0 16px #4b1b89">BEGIN THE SLAUGHTER</button><div style="font:clamp(10px,1.35vw,15px) Arial,sans-serif;background:#120b20bd;padding:7px 10px;border-radius:5px;line-height:1.5">WASD / Arrows: Move &nbsp; • &nbsp; Mouse: Aim &nbsp; • &nbsp; Left-click: Fire &nbsp; • &nbsp; Right-click: Chain lightning<br>M: Mute &nbsp; • &nbsp; + / −: Volume &nbsp; • &nbsp; Collect glowing power-ups to survive</div></div>`;
    parent.appendChild(overlay);
    const position = () => {
      const cr = canvas.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      overlay.style.left = `${cr.left - pr.left + parent.scrollLeft}px`;
      overlay.style.top = `${cr.top - pr.top + parent.scrollTop}px`;
      overlay.style.width = `${cr.width}px`;
      overlay.style.height = `${cr.height}px`;
    };
    position();
    window.addEventListener('resize', position);
    const begin = () => {
      if (!this.titleOpen) return;
      this.titleOpen = false;
      this.nextSpawn = this.time.now;
      this.audio.unlock();
      overlay.remove();
      canvas.focus();
    };
    overlay.querySelector('button')?.addEventListener('click', begin);
    const enter = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.code === 'Space') { event.preventDefault(); begin(); } };
    window.addEventListener('keydown', enter);
    this.events.once('shutdown', () => {
      overlay.remove();
      window.removeEventListener('resize', position);
      window.removeEventListener('keydown', enter);
      if (!oldPosition || oldPosition === 'static') parent.style.position = oldPosition;
    });
  }

  update(time: number, delta: number): void {
    if (this.dead || this.titleOpen) return;
    const dt = Math.min(delta, 50) / 1000;
    this.survived += dt;
    // Apocalypse begins after the normal spawn curve reaches its peak at 7:05.
    // Every subsequent 30 seconds, allow 50 more living lizards and spawn faster.
    const apocalypseTier = Math.max(0, Math.floor((this.survived - 425) / 30));
    const maxLizards = 300 + apocalypseTier * 50;
    const normalInterval = Math.max(100, 1500 - this.survived * (1400 / 425));
    const spawnInterval = apocalypseTier === 0 ? normalInterval : Math.max(20, 100 / (1 + apocalypseTier * 0.25));
    if (time >= this.nextSpawn && this.enemies.length < maxLizards) {
      this.spawnEnemy();
      this.nextSpawn = time + spawnInterval;
    }
    const dx = Number(this.keys.D.isDown || this.keys.RIGHT.isDown)
      - Number(this.keys.A.isDown || this.keys.LEFT.isDown);
    const dy = Number(this.keys.S.isDown || this.keys.DOWN.isDown)
      - Number(this.keys.W.isDown || this.keys.UP.isDown);
    const length = Math.hypot(dx, dy);
    if (length > 0) {
      const step = SPEED * Math.min(delta, 50) / 1000;
      const nextX = this.player.x + dx / length * step;
      const nextY = this.player.y + dy / length * step;
      // Separate axes allow the wizard to slide around pillars instead of sticking.
      if (canWalk(nextX, this.player.y)) this.player.x = nextX;
      if (canWalk(this.player.x, nextY)) this.player.y = nextY;
    }
    // Facing follows the mouse, never the movement keys.
    const pointer = this.input.activePointer;
    const mouse = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const angle = Math.atan2(mouse.y - this.player.y, mouse.x - this.player.x);
    const index = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
    const direction = DIRECTIONS[index];
    // Walk in the direction of aim while moving; movement itself remains independent.
    if (length > 0) {
      this.walkClock += dt;
      const frame = Math.floor(this.walkClock * 9) % 6;
      if (frame !== this.walkFrame || this.player.texture.key !== `wizard-${direction}-walk-${frame}`) {
        this.walkFrame = frame;
        this.setWizardDirection(`${direction}-walk-${frame}`);
      }
    } else {
      this.walkClock = 0;
      this.walkFrame = -1;
      this.setWizardDirection(direction);
    }
    this.player.setDepth(this.player.y + 2);
    if (pointer.isDown && pointer.leftButtonDown() && time >= this.nextFire) {
      this.shoot(mouse.x, mouse.y);
      this.nextFire = time + (time < this.rapidUntil ? 95 : 190);
    }
    // One stored chain-lightning charge.
    const rightDown = pointer.rightButtonDown();
    if (rightDown && !this.lightningHeld && time >= this.lightningReady &&
        (this.lightningCharges > 0)) {
      this.castChainLightning(mouse.x, mouse.y);
      this.lightningCharges--;
      this.lightningReady = time + 350;
    }
    this.lightningHeld = rightDown;
    // Only a handful of glow sprites animate; no expensive per-enemy lighting.
    for (const light of this.atmosphereLights) {
      light.glow.setAlpha(light.baseAlpha * (0.89 + 0.11 * Math.sin(time * light.speed + light.phase)));
    }
    this.stepCombat(dt, time);
    this.stepPickups(dt, time);
    this.updateStatus();
  }

  // Visible artwork heights measured from the approved v0.44 wizard PNGs.
  // These are NOT canvas dimensions: all PNG canvases are 480 x 480.
  // Keep the approved northern poses at their existing display sizes.
  private setWizardDirection(direction: string): void {
    const key = `wizard-${direction}`;
    if (this.player.texture.key !== key) this.player.setTexture(key);
    const texture = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const base = direction.split('-')[0];
    const walking = direction.includes('-walk-');

    // Preserve the previously approved NW/N/NE scaling exactly.
    if (base === 'nw' || base === 'n' || base === 'ne') {
      const height = WIZARD_HEIGHT * 1.20 * (walking ? 1.12 : 1);
      this.player.setDisplaySize(height * texture.width / texture.height, height);
      return;
    }

    // Match the *visible silhouette*, rather than the transparent canvas.
    // Target heights are based on the approved north-facing reference:
    // ~43 world px idle and ~45 world px walking. No PNG editing required.
    const idleArtworkHeight: Record<string, number> = {
      e: 459, se: 459, s: 445, sw: 457, w: 464,
    };
    const walkArtworkHeight = 442;
    const artworkHeight = walking ? walkArtworkHeight : idleArtworkHeight[base];
    const targetVisibleHeight = walking ? 45 : 43;
    const displayHeight = targetVisibleHeight * texture.height / artworkHeight;
    this.player.setDisplaySize(displayHeight * texture.width / texture.height, displayHeight);
  }

  private shoot(mx: number, my: number): void {
    this.audio.missile();
    const angle = Math.atan2(my - (this.player.y - 18), mx - this.player.x);
    const spread = this.time.now < this.multiUntil ? [-0.20, 0, 0.20] : [0];
    for (const offset of spread) {
      const a = angle + offset;
      const x = this.player.x + Math.cos(a) * 14;
      const y = this.player.y - 18 + Math.sin(a) * 14;
      // Elongated arcane missile, aligned to travel direction. Pure Phaser shapes;
      // no new artwork or textures needed, and the hitbox is unchanged.
      const view = this.add.container(x, y).setDepth(3000).setRotation(a);
      view.add([
        this.add.ellipse(-6, 0, 19, 7, 0x7e28ff, 0.25).setBlendMode(Phaser.BlendModes.ADD),
        this.add.ellipse(-3, 0, 17, 4, 0xa34aff, 0.7).setBlendMode(Phaser.BlendModes.ADD),
        this.add.ellipse(2, 0, 13, 3, 0xd8a2ff, 0.95).setBlendMode(Phaser.BlendModes.ADD),
        this.add.ellipse(5, 0, 6, 2, 0xffffff, 1),
        this.add.line(-2, -4, -5, 0, 3, 0, 0xa56aff, 0.8).setLineWidth(1),
        this.add.line(-3, 4, -4, 0, 3, 0, 0xb887ff, 0.8).setLineWidth(1)
      ]);
      this.bolts.push({ x, y, vx: Math.cos(a) * 350, vy: Math.sin(a) * 350, life: 1.5, view, trailClock: 0 });
    }
  }

  private emitMissileSpark(x: number, y: number, angle: number, speed: number, life: number): void {
    if (this.missileParticles.length >= 240) return;
    const view = this.add.circle(x, y, Phaser.Math.FloatBetween(0.6, 1.5),
      Math.random() < 0.3 ? 0xf5dfff : 0xa65aff, 0.9)
      .setDepth(2999).setBlendMode(Phaser.BlendModes.ADD);
    this.missileParticles.push({ view, vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed, life, maxLife: life });
  }

  private missileImpact(x: number, y: number): void {
    this.audio.impact();
    this.audio.death();
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7 + Math.random() * 0.3;
      this.emitMissileSpark(x, y, angle, Phaser.Math.FloatBetween(35, 85), 0.22);
    }
  }

  // Rare collectible chain lightning.
  // Acquires the closest lizard near the cursor, then jumps between nearby targets.
  private castChainLightning(mx: number, my: number): void {
    const maxTargets = 100;
    const initialRange = 300;
    const jumpRange = 300;
    let sourceX = mx, sourceY = my;
    const selected: typeof this.enemies = [];
    const available = [...this.enemies];
    for (let i = 0; i < maxTargets; i++) {
      const range = i === 0 ? initialRange : jumpRange;
      let best = -1, bestDist = range;
      for (let j = 0; j < available.length; j++) {
        const d = Math.hypot(available[j].x - sourceX, available[j].y - sourceY);
        if (d < bestDist) { bestDist = d; best = j; }
      }
      if (best < 0) break;
      const target = available.splice(best, 1)[0];
      selected.push(target);
      sourceX = target.x; sourceY = target.y;
    }

    this.audio.lightning(selected.length);
    // Lightning originates at the mouse cursor; even a miss gives visual feedback.
    const graphics = this.add.graphics().setDepth(4500).setBlendMode(Phaser.BlendModes.ADD);
    const drawArc = (x1: number, y1: number, x2: number, y2: number, width: number) => {
      const dx = x2 - x1, dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(2, Math.ceil(dist / 13));
      const nx = dist ? -dy / dist : 0, ny = dist ? dx / dist : 0;
      const points: { x: number; y: number }[] = [{ x: x1, y: y1 }];
      for (let k = 1; k < steps; k++) {
        const t = k / steps, jitter = Phaser.Math.FloatBetween(-7, 7);
        points.push({ x: x1 + dx * t + nx * jitter, y: y1 + dy * t + ny * jitter });
      }
      points.push({ x: x2, y: y2 });
      graphics.lineStyle(width + 5, 0x7428ff, 0.35);
      graphics.beginPath(); graphics.moveTo(points[0].x, points[0].y);
      for (const pt of points.slice(1)) graphics.lineTo(pt.x, pt.y);
      graphics.strokePath();
      graphics.lineStyle(width, 0xb86aff, 0.95);
      graphics.beginPath(); graphics.moveTo(points[0].x, points[0].y);
      for (const pt of points.slice(1)) graphics.lineTo(pt.x, pt.y);
      graphics.strokePath();
      graphics.lineStyle(1.3, 0xffffff, 1);
      graphics.beginPath(); graphics.moveTo(points[0].x, points[0].y);
      for (const pt of points.slice(1)) graphics.lineTo(pt.x, pt.y);
      graphics.strokePath();
    };
    let fromX = mx, fromY = my;
    for (const target of selected) {
      drawArc(fromX, fromY, target.x, target.y, 2.8);
      graphics.fillStyle(0xeac8ff, 0.85);
      graphics.fillCircle(target.x, target.y, 6);
      for (let k = 0; k < 4; k++) {
        const a = Math.random() * Math.PI * 2;
        this.emitMissileSpark(target.x, target.y, a, Phaser.Math.FloatBetween(50, 110), 0.28);
      }
      fromX = target.x; fromY = target.y;
      const index = this.enemies.indexOf(target);
      if (index >= 0) {
        this.dropPickup(target.x, target.y);
        target.view.destroy();
        this.enemies.splice(index, 1);
        this.kills++;
      }
    }
    if (!selected.length) {
      graphics.lineStyle(2, 0xc78aff, 0.9);
      graphics.strokeCircle(mx, my, 12);
    }
    this.tweens.add({ targets: graphics, alpha: 0, duration: 230,
      onComplete: () => graphics.destroy() });
  }

  private dropPickup(x: number, y: number): void {
    // Separate rare drop roll: 0.25% chance per kill (roughly 1 in 400).
    // Never spawn extra lightning charges while one is already held.
    if (this.lightningCharges === 0 &&
        !this.pickups.some(p => p.kind === 'lightning') &&
        Math.random() < 0.0025) {
      this.createPickup(x, y, 'lightning');
    }
    if (Math.random() >= 0.17) return;
    const roll = Math.random();
    const kind: 'rapid' | 'multi' | 'heal' = roll < 0.35 ? 'rapid' : roll < 0.7 ? 'multi' : 'heal';
    this.createPickup(x, y, kind);
  }

  private createPickup(x: number, y: number, kind: 'rapid' | 'multi' | 'heal' | 'lightning'): void {
    const color = kind === 'lightning' ? 0xc47aff : kind === 'rapid' ? 0xffd75c : kind === 'multi' ? 0x70dfff : 0x7bf49b;
    const label = kind === 'lightning' ? '⚡' : kind === 'rapid' ? 'R' : kind === 'multi' ? '3' : '+';
    const view = this.add.container(x, y).setDepth(y + 1);
    view.add([
      this.add.circle(0, 0, kind === 'lightning' ? 11 : 9, 0x171126, 0.92).setStrokeStyle(2, color),
      this.add.text(0, 0, label, { fontFamily: 'sans-serif', fontSize: kind === 'lightning' ? '15px' : '11px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5)
    ]);
    this.pickups.push({ x, y, kind, view, life: 16 });
  }

  private stepPickups(dt: number, time: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      pickup.life -= dt;
      pickup.view.setAlpha(pickup.life < 3 ? (Math.sin(time * 0.016) > 0 ? 1 : 0.35) : 1);
      const collected = Math.hypot(pickup.x - this.player.x, pickup.y - this.player.y) < 21;
      if (collected && (pickup.kind !== 'lightning' || this.lightningCharges === 0)) {
        this.audio.pickup(pickup.kind);
        if (pickup.kind === 'lightning') this.lightningCharges = 1;
        else if (pickup.kind === 'heal') this.hp = Math.min(5, this.hp + 2);
        else if (pickup.kind === 'rapid') this.rapidUntil = Math.max(time, this.rapidUntil) + 12000;
        else this.multiUntil = Math.max(time, this.multiUntil) + 12000;
      }
      if ((collected && (pickup.kind !== 'lightning' || this.lightningCharges > 0)) || pickup.life <= 0) {
        pickup.view.destroy();
        this.pickups.splice(i, 1);
      }
    }
  }

  private spawnEnemy(): void {
    // Spawn just outside the visible camera, not at the dungeon perimeter.
    // The playable-area check prevents wall/pillar spawns when near map edges.
    const visible = this.cameras.main.worldView;
    const padding = 18;
    let x = 0, y = 0;
    let found = false;
    for (let attempt = 0; attempt < 48; attempt++) {
      const side = Phaser.Math.Between(0, 3);
      if (side === 0 || side === 1) {
        x = Phaser.Math.FloatBetween(visible.left, visible.right);
        y = side === 0 ? visible.top - padding : visible.bottom + padding;
      } else {
        x = side === 2 ? visible.left - padding : visible.right + padding;
        y = Phaser.Math.FloatBetween(visible.top, visible.bottom);
      }
      if (canWalk(x, y) && !visible.contains(x, y)) {
        found = true;
        break;
      }
    }
    // When the camera is near a world corner, some edges are unavailable.
    // Skip this spawn if none of the sampled offscreen positions is valid.
    if (!found) return;
    const view = this.add.container(x, y).setDepth(y + 1);
    // One shared five-part articulated lizard rig. All layers share a fixed canvas
    // so the head stays aligned as legs alternate and the tail swings.
    const shadow = this.add.ellipse(0, 5, 29, 11, 0x080a08, 0.35);
    const farRear = this.add.image(0, 0, 'lizard-rear-far');
    const farFront = this.add.image(0, 0, 'lizard-front-far');
    const tail = this.add.image(0, 0, 'lizard-tail');
    const nearRear = this.add.image(0, 0, 'lizard-rear-near');
    const nearFront = this.add.image(0, 0, 'lizard-front-near');
    const body = this.add.image(0, 0, 'lizard-body');
    const limbs = [farFront, nearFront, farRear, nearRear];
    for (const part of [farRear, farFront, tail, nearRear, nearFront, body]) {
      part.setDisplaySize(38, 23);
    }
    view.add([shadow, farRear, farFront, tail, nearRear, nearFront, body]);
    this.enemies.push({ x, y, view, limbs, tail, phase: Math.random() * Math.PI * 2 });
  }

  private stepCombat(dt: number, time: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      b.view.setPosition(b.x, b.y);
      // Emit a restrained sparkle trail; cap the pool for rapid-fire + multishot.
      b.trailClock += dt;
      if (b.trailClock >= 0.035 && this.missileParticles.length < 240) {
        b.trailClock = 0;
        const angle = Math.atan2(b.vy, b.vx);
        this.emitMissileSpark(b.x - Math.cos(angle) * 7, b.y - Math.sin(angle) * 7,
          angle + Math.PI + Phaser.Math.FloatBetween(-0.8, 0.8), 25, 0.19);
      }
      let hit = false;
      for (let j = this.enemies.length - 1; j >= 0; j--) {
        const e = this.enemies[j];
        if (Math.hypot(e.x - b.x, e.y - b.y) < 13) {
          this.dropPickup(e.x, e.y);
          this.missileImpact(b.x, b.y);
          e.view.destroy(); this.enemies.splice(j, 1); this.kills++;
          hit = true; break;
        }
      }
      if (hit || b.life <= 0 || !canWalk(b.x, b.y)) {
        b.view.destroy(); this.bolts.splice(i, 1);
      }
    }
    // Fade and drift existing sparks without creating a new timer for each one.
    for (let i = this.missileParticles.length - 1; i >= 0; i--) {
      const p = this.missileParticles[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.view.destroy(); this.missileParticles.splice(i, 1);
      } else {
        p.view.x += p.vx * dt;
        p.view.y += p.vy * dt;
        p.view.setAlpha(p.life / p.maxLife);
      }
    }
    for (const e of this.enemies) {
      // Scurrying gait in lizard-local coordinates (head points right / +X).
      // Diagonal pairs move fore/aft, rather than rotating inward like clapping.
      // At sin=0 all limbs return to their neutral image positions.
      e.phase = (e.phase + dt * 14) % (Math.PI * 2);
      const stride = Math.sin(e.phase);
      const lift = Math.abs(stride);
      const foreAft = 4.8 * stride;
      // Opposite diagonal pairs: far-front + near-rear versus near-front + far-rear.
      e.limbs[0].setPosition( foreAft, -0.45 * lift).setRotation( 0.045 * stride); // far front
      e.limbs[1].setPosition(-foreAft,  0.45 * lift).setRotation(-0.045 * stride); // near front
      e.limbs[2].setPosition(-foreAft, -0.35 * lift).setRotation(-0.035 * stride); // far rear
      e.limbs[3].setPosition( foreAft,  0.35 * lift).setRotation( 0.035 * stride); // near rear
      // Tail swings laterally, with very little pivot rotation.
      e.tail.setPosition(-0.6 * lift, 2.0 * stride).setRotation(0.07 * stride);
      const dx = this.player.x - e.x, dy = this.player.y - e.y;
      const distance = Math.hypot(dx, dy);
      if (distance > 1) {
        const speed = 43 + Math.min(30, this.survived * 0.2);
        const sx = dx / distance * speed * dt, sy = dy / distance * speed * dt;
        if (canWalk(e.x + sx, e.y)) e.x += sx;
        if (canWalk(e.x, e.y + sy)) e.y += sy;
        e.view.setPosition(e.x, e.y).setDepth(e.y + 1).setRotation(Math.atan2(dy, dx));
      }
      if (distance < 17 && time >= this.nextDamage) {
        this.hp--; this.nextDamage = time + 1000;
        this.audio.hurt();
        this.player.setTint(0xff7777);
        this.time.delayedCall(180, () => { if (this.player.active) {
          this.player.clearTint();
        } });
        if (this.hp <= 0) { this.endGame(); break; }
      }
    }
  }

  private endGame(): void {
    this.dead = true;
    this.audio.gameOver();
    // Keep the final battlefield frame visible while gameplay updates are stopped.
    // Use a DOM overlay, like the title screen, so camera zoom cannot distort UI.
    const canvas = this.game.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;
    const oldPosition = parent.style.position;
    if (!oldPosition || oldPosition === 'static') parent.style.position = 'relative';

    const totalSeconds = Math.floor(this.survived);
    const duration = `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
    const overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Lizardgeddon game over');
    overlay.style.cssText = 'position:absolute;z-index:110;box-sizing:border-box;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;background:rgba(9,6,16,.83);color:#f5e2ba;font-family:Georgia,serif;text-align:center;opacity:0;transition:opacity 350ms ease;';

    const panel = document.createElement('div');
    panel.style.cssText = 'box-sizing:border-box;width:min(100%,480px);max-height:100%;overflow:auto;padding:clamp(16px,4vw,32px);background:linear-gradient(160deg,#1c142b,#100c1b);border:2px solid #9d7847;border-radius:12px;box-shadow:0 12px 55px #000c,0 0 35px #452a57a0;';
    const skull = document.createElement('div');
    skull.textContent = '☠';
    skull.setAttribute('aria-hidden', 'true');
    skull.style.cssText = 'font-size:clamp(28px,5vw,46px);line-height:1;color:#c6a36b;';
    const heading = document.createElement('h2');
    heading.textContent = 'YOU HAVE FALLEN';
    heading.style.cssText = 'margin:12px 0 5px;font-size:clamp(23px,4.3vw,38px);letter-spacing:.045em;color:#d7b477;text-shadow:0 2px 10px #000;';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'The swarm claims another victim.';
    subtitle.style.cssText = 'margin:0 0 22px;font-size:clamp(12px,2vw,16px);color:#b9adc6;font-style:italic;';
    const stats = document.createElement('div');
    stats.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;border-top:1px solid #655035;border-bottom:1px solid #655035;padding:20px 0;margin-bottom:22px;';
    const stat = (label: string, value: string) => {
      const cell = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = label;
      name.style.cssText = 'font:700 clamp(10px,1.5vw,12px) Arial,sans-serif;letter-spacing:.07em;color:#aaa1b2;';
      const number = document.createElement('div');
      number.textContent = value;
      number.style.cssText = 'margin-top:8px;font-size:clamp(24px,4vw,34px);font-weight:bold;color:#f0d9a5;';
      cell.append(name, number);
      return cell;
    };
    stats.append(stat('TIME SURVIVED', duration), stat('LIZARDS SLAIN', String(this.kills)));
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = '⚔ TRY AGAIN';
    retry.style.cssText = 'cursor:pointer;padding:13px 32px;max-width:100%;border:2px solid #bd8d4b;border-radius:7px;background:linear-gradient(#795035,#52301f);color:#fff0d2;font:700 clamp(14px,2.4vw,19px) Georgia,serif;box-shadow:0 4px 0 #302019;';
    panel.append(skull, heading, subtitle, stats, retry);
    overlay.appendChild(panel);
    parent.appendChild(overlay);

    const position = () => {
      const cr = canvas.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      overlay.style.left = `${cr.left - pr.left + parent.scrollLeft}px`;
      overlay.style.top = `${cr.top - pr.top + parent.scrollTop}px`;
      overlay.style.width = `${cr.width}px`;
      overlay.style.height = `${cr.height}px`;
    };
    position();
    window.addEventListener('resize', position);
    // A frame ensures the opacity transition runs after insertion.
    this.time.delayedCall(20, () => { if (overlay.isConnected) overlay.style.opacity = '1'; });
    let restarting = false;
    const restart = () => {
      if (restarting) return;
      restarting = true;
      this.scene.restart();
    };
    retry.addEventListener('click', restart);
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyR' || event.code === 'Enter') {
        event.preventDefault();
        restart();
      }
    };
    window.addEventListener('keydown', onKey);
    retry.focus();
    this.events.once('shutdown', () => {
      overlay.remove();
      window.removeEventListener('resize', position);
      window.removeEventListener('keydown', onKey);
      if (!oldPosition || oldPosition === 'static') parent.style.position = oldPosition;
    });
  }

  // Render the HUD in viewport pixels, independent of the 2x world camera.
  private createHud(): void {
    const cam = this.cameras.main;
    const hud = this.add.container(0, 0).setScrollFactor(0).setDepth(5000);
    this.hudContainer = hud;
    const graphics = this.add.graphics();
    this.hudGraphics = graphics;
    hud.add(graphics);
    const text = (size: string, color: string) => {
      const label = this.add.text(0, 0, '', {
        fontFamily: 'Georgia, serif', fontSize: size, color, fontStyle: 'bold'
      });
      hud.add(label);
      return label;
    };
    this.hudHealth = text('20px', '#f38c9e');
    this.hudTime = text('18px', '#f7dda1').setOrigin(0.5, 0);
    this.hudKills = text('13px', '#d9c9b2').setOrigin(0.5, 0);
    this.hudLightning = text('18px', '#d4a2ff').setOrigin(0.5, 0);
    this.hudBuffs = text('14px', '#f2dcae').setOrigin(0.5, 0);
    const layout = () => {
      const w = cam.width, h = cam.height;
      const zoom = cam.zoom;
      // Phaser's zoom is centered around the camera viewport. Undo it for the HUD.
      hud.setPosition(w * (1 - 1 / zoom) / 2, h * (1 - 1 / zoom) / 2);
      hud.setScale(1 / zoom);
      graphics.clear();
      const panel = (x: number, y: number, width: number, height: number) => {
        graphics.fillStyle(0x100b1b, 0.87);
        graphics.fillRoundedRect(x, y, width, height, 7);
        graphics.lineStyle(2, 0x9c7646, 0.95);
        graphics.strokeRoundedRect(x + 1, y + 1, width - 2, height - 2, 7);
      };
      const margin = 12;
      const side = Math.min(220, Math.max(115, (w - 48) * 0.29));
      const center = w / 2;
      panel(margin, margin, side, 52);
      panel(center - side / 2, margin, side, 52);
      panel(w - side - margin, margin, side, 52);
      panel(Math.max(margin, center - 180), h - 42, Math.min(360, w - 2 * margin), 32);
      this.hudHealth.setPosition(margin + 12, margin + 13);
      this.hudTime.setPosition(center, margin + 4);
      this.hudKills.setPosition(center, margin + 28);
      this.hudLightning.setPosition(w - margin - side / 2, margin + 13);
      this.hudBuffs.setPosition(center, h - 35);
    };
    layout();
    this.scale.on('resize', layout);
    this.events.once('shutdown', () => this.scale.off('resize', layout));
  }

  private updateStatus(): void {
    const seconds = Math.floor(this.survived);
    const time = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    // Colored hearts are clearer than a tiny numerical HP counter.
    this.hudHealth.setText('♥'.repeat(Math.max(0, this.hp)) + '♡'.repeat(Math.max(0, 5 - this.hp)));
    this.hudTime.setText(`⏳ ${time}`);
    this.hudKills.setText(`LIZARDS SLAIN  ${this.kills}`);
    this.hudLightning.setText(`⚡ ${this.lightningCharges}/1`);
    this.hudLightning.setColor((this.lightningCharges > 0) ? '#e5b5ff' : '#95829d');
    const buffs = [
      this.rapidUntil > this.time.now ? `RAPID FIRE ${Math.ceil((this.rapidUntil - this.time.now) / 1000)}s` : '',
      this.multiUntil > this.time.now ? `TRIPLE SHOT ${Math.ceil((this.multiUntil - this.time.now) / 1000)}s` : ''
    ].filter(Boolean).join('  ✦  ');
    this.hudBuffs.setText(buffs || 'COLLECT POWER-UPS TO SURVIVE');
  }

  private drawDungeon(): void {
    // Illustrated textures replace procedural brick shapes. Collision remains unchanged.
    this.add.tileSprite(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 'stone-floor-art')
      .setOrigin(0).setTileScale(0.3, 0.3).setDepth(-20);

    // Atmospheric stains and irregular shadow pools, below all actors.
    for (let i = 0; i < 55; i++) {
      const x = 45 + noise(i, 11) * (WORLD_WIDTH - 90);
      const y = 45 + noise(i, 19) * (WORLD_HEIGHT - 90);
      this.add.ellipse(x, y, 18 + noise(i, 23) * 55, 8 + noise(i, 29) * 24,
        0x100e18, 0.13 + noise(i, 17) * 0.15).setDepth(-12);
    }

    // Stone wall silhouettes. These are perimeter decorations, not new obstacles.
    const walls = this.add.graphics().setDepth(2000);
    walls.fillStyle(0x16131b, 1);
    walls.fillRect(0, 0, WORLD_WIDTH, WALL);
    walls.fillRect(0, WORLD_HEIGHT - WALL, WORLD_WIDTH, WALL);
    walls.fillRect(0, 0, WALL, WORLD_HEIGHT);
    walls.fillRect(WORLD_WIDTH - WALL, 0, WALL, WORLD_HEIGHT);
    walls.lineStyle(3, 0x62534b, 0.7);
    walls.strokeRect(WALL, WALL, WORLD_WIDTH - WALL * 2, WORLD_HEIGHT - WALL * 2);
    // Uneven wall masonry and highlights.
    for (let x = 0; x < WORLD_WIDTH; x += 29) {
      const jitter = noise(x, 1) * 7;
      this.add.rectangle(x + 14, 8 + jitter, 27, 12, 0x3d3538, 0.8).setDepth(2001);
      this.add.rectangle(x + 14, WORLD_HEIGHT - 8 - jitter, 27, 12, 0x3d3538, 0.8).setDepth(2001);
    }
    for (let y = 0; y < WORLD_HEIGHT; y += 29) {
      const jitter = noise(y, 2) * 7;
      this.add.rectangle(8 + jitter, y + 14, 12, 27, 0x3d3538, 0.8).setDepth(2001);
      this.add.rectangle(WORLD_WIDTH - 8 - jitter, y + 14, 12, 27, 0x3d3538, 0.8).setDepth(2001);
    }

    // Large, sparse ritual circles. Independent of floor tiling.
    for (let i = 0; i < 5; i++) {
      const x = 110 + noise(i, 47) * (WORLD_WIDTH - 220);
      const y = 110 + noise(i, 53) * (WORLD_HEIGHT - 220);
      const r = 26 + noise(i, 59) * 23;
      const rune = this.add.graphics().setDepth(-9);
      rune.lineStyle(1.15, 0xc77aff, 0.72);
      rune.strokeCircle(0, 0, r);
      rune.strokeCircle(0, 0, r * 0.76);
      rune.strokeCircle(0, 0, r * 0.28);
      for (let spoke = 0; spoke < 8; spoke++) {
        const a = spoke * Math.PI / 4;
        const inner = r * 0.82, outer = r * 1.06;
        rune.lineBetween(Math.cos(a) * inner, Math.sin(a) * inner,
          Math.cos(a) * outer, Math.sin(a) * outer);
      }
      for (let corner = 0; corner < 4; corner++) {
        const a = corner * Math.PI / 2;
        const cx = Math.cos(a) * r * 0.53;
        const cy = Math.sin(a) * r * 0.53;
        rune.strokeRect(cx - 3, cy - 3, 6, 6);
      }
      rune.setPosition(x, y).setAlpha(0.45);
      this.tweens.add({
        targets: rune, alpha: 0.9,
        duration: 2400 + i * 310, yoyo: true, repeat: -1,
        ease: 'Sine.easeInOut'
      });
    }

    // Sparse atmospheric decorations, independent of floor tiling.
    // Everything is non-colliding and placed away from the central spawn area.
    const addGlow = (x: number, y: number, key: string, size: number, alpha: number, phase: number) => {
      const glow = this.add.image(x, y, key).setDisplaySize(size, size)
        .setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setDepth(-5);
      this.atmosphereLights.push({ glow, phase, speed: 0.0018 + phase * 0.00009, baseAlpha: alpha });
    };
    // Irregularly distributed across the dungeon, not lined up along the walls.
    // Decorative only: existing movement and collision remain unchanged.
    const braziers = [
      { x: 170, y: 165 }, { x: 535, y: 290 }, { x: 980, y: 135 },
      { x: 1375, y: 375 }, { x: 260, y: 590 }, { x: 745, y: 470 },
      { x: 1160, y: 735 }, { x: 420, y: 1040 }, { x: 870, y: 985 },
      { x: 1450, y: 1050 }
    ];
    braziers.forEach((t, i) => {
      addGlow(t.x, t.y - 13, 'dungeon-torch-glow', 135, 0.58, i * 1.7);
      this.add.image(t.x, t.y, 'dungeon-brazier').setDisplaySize(43, 57)
        .setOrigin(0.5, 0.94).setDepth(t.y + 1);
    });
    const crystals = [
      { x: 150, y: 270 }, { x: 1440, y: 590 }, { x: 380, y: 1040 },
      { x: 1200, y: 1010 }, { x: 1320, y: 185 }
    ];
    crystals.forEach((c, i) => {
      addGlow(c.x, c.y - 8, 'dungeon-crystal-glow', 135, 0.43, 2.1 + i * 2);
      this.add.image(c.x, c.y, 'dungeon-crystal').setDisplaySize(43, 58)
        .setOrigin(0.5, 0.9).setDepth(c.y + 1);
    });
    for (let i = 0; i < 32; i++) {
      const x = 65 + noise(i, 73) * (WORLD_WIDTH - 130);
      const y = 65 + noise(i, 79) * (WORLD_HEIGHT - 130);
      // Keep the center relatively clear and avoid placing rubble over pillars.
      if (Math.hypot(x - START.x, y - START.y) < 115) continue;
      if (PILLARS.some(p => Math.hypot(x - p.x, y - p.y) < p.radius + 34)) continue;
      const width = 17 + noise(i, 83) * 22;
      this.add.image(x, y, 'dungeon-rubble').setDisplaySize(width, width * 0.78)
        .setAlpha(0.83).setDepth(-7);
    }

    // Illustration is anchored to the obstacle's floor contact point.
    // The source art is tall, but collision still uses the original circular footprint.
    for (const p of PILLARS) {
      this.add.ellipse(p.x + 9, p.y + 8, p.radius * 4.3, p.radius * 2.2,
        0x09080c, 0.55).setDepth(p.y - 2);
      this.add.image(p.x, p.y + p.radius * 0.75, 'broken-column-art')
        .setOrigin(0.5, 1).setDisplaySize(p.radius * 4.8, p.radius * 7.5)
        .setDepth(p.y + 1);
    }
  }
}

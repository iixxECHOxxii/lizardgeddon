import Phaser from 'phaser';
import { IslandScene } from './game';

const start = () => new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0b0f2a',
  pixelArt: false, // Smoothly render the new hand-painted wizard sprites.
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
  scene: IslandScene,
});

document.fonts.load('8px "Press Start 2P"').then(start, start);

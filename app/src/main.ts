// Entry point: boots the app core, the UI and the automation hooks on window.LE.
import './effects/index.ts';
import { App } from './app.ts';
import { installHooks } from './hooks.ts';

const root = document.getElementById('app')!;
const canvas = document.createElement('canvas');
canvas.id = 'stage';
root.appendChild(canvas);
const app = new App(canvas);
installHooks(app);

// Importing an effect module registers it. Order = the order of the effect grid (keys 1–9, 0, Shift+1–6).
import './broadside.ts';
import './karaoke.ts';
// SDK effects: every file in effects/user/ is discovered at build time and hot-reloads in `npm run dev`.
const user = import.meta.glob('./user/*.ts', { eager: true });
void user;

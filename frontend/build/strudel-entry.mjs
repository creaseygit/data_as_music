// Strudel bundle entry point for Data as Music (dam.fm)
// Imports from @strudel/web SOURCE (web.mjs, not the pre-built dist)
// so that @strudel/core is shared with @strudel/soundfonts — no duplicate.

// Import from the source entry which re-exports individual packages
// (web.mjs re-exports from @strudel/core, mini, tonal, webaudio, transpiler)
export * from '@strudel/web/web.mjs';

// evaluate() is exported by web.mjs but we also put it on window
// so tracks can call it without module imports
import { evaluate } from '@strudel/web/web.mjs';
window.evaluate = evaluate;

// Import soundfonts and expose on window
import { registerSoundfonts, setSoundfontUrl, loadSoundfont } from '@strudel/soundfonts';
window.registerSoundfonts = registerSoundfonts;
window.setSoundfontUrl = setSoundfontUrl;
window.loadSoundfont = loadSoundfont;

// Import aliasBank for drum machine aliases (rd, rim, etc.)
import { aliasBank } from 'superdough';
window.aliasBank = aliasBank;

// Strudel bundle entry point for Polymarket DJ
// Imports @strudel/web (which sets window.initStrudel and all globals via evalScope)
// and @strudel/soundfonts (GM soundfonts including gm_acoustic_bass).

// Import everything from @strudel/web — this runs side effects that set up
// window.initStrudel, Pattern.prototype.play, hush, evaluate, etc.
// The CDN bundle at unpkg.com/@strudel/web is essentially this dist output.
import '@strudel/web';

// Import soundfonts and expose on window so tracks/audio-engine can use them
import { registerSoundfonts, setSoundfontUrl, loadSoundfont } from '@strudel/soundfonts';

window.registerSoundfonts = registerSoundfonts;
window.setSoundfontUrl = setSoundfontUrl;
window.loadSoundfont = loadSoundfont;

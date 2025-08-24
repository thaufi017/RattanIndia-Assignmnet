// server/audio.cjs

// What we send TO Gemini (mic path)
const PCM16KHZ_MIME = "audio/pcm;rate=16000";

// Gemini streams PCM back at 24kHz.
// We won't wrap to WAV anymore — we forward PCM to the browser.
// (Kept here for reference or future use.)

module.exports = { PCM16KHZ_MIME };

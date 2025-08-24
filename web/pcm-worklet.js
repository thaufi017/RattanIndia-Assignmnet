// web/pcm-worklet.js
// Mic Float32 -> Int16 PCM frames (mono) posted to main thread

class PCMEncoder extends AudioWorkletProcessor {
    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const ch = input[0]; // mono channel
        const out = new Int16Array(ch.length);
        for (let i = 0; i < ch.length; i++) {
            let s = Math.max(-1, Math.min(1, ch[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(out.buffer, [out.buffer]); // send raw PCM bytes
        return true;
    }
}

registerProcessor("pcm-encoder", PCMEncoder);

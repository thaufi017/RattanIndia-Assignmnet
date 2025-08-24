// web/player-worklet.js
// Receives Int16 PCM (24kHz, mono) via port messages and plays it smoothly.
// Simple ring buffer in Float32.

class PCMPlayer extends AudioWorkletProcessor {
    constructor() {
        super();
        this.queue = []; // array of Float32Array chunks
        this.readIndex = 0;

        this.port.onmessage = (e) => {
            const buf = e.data; // ArrayBuffer of Int16 PCM
            const int16 = new Int16Array(buf);
            const f32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                f32[i] = int16[i] / 0x8000; // [-1,1]
            }
            this.queue.push(f32);
        };
    }

    pull(output) {
        const out = output[0][0]; // mono
        let i = 0;

        while (i < out.length) {
            if (this.queue.length === 0) {
                // no data — output silence
                while (i < out.length) out[i++] = 0;
                break;
            }

            const cur = this.queue[0];
            const remain = cur.length - this.readIndex;
            const toCopy = Math.min(remain, out.length - i);

            out.set(cur.subarray(this.readIndex, this.readIndex + toCopy), i);
            i += toCopy;
            this.readIndex += toCopy;

            if (this.readIndex >= cur.length) {
                this.queue.shift();
                this.readIndex = 0;
            }
        }
    }

    process(_inputs, outputs) {
        this.pull(outputs);
        return true;
    }
}

registerProcessor("pcm-player", PCMPlayer);

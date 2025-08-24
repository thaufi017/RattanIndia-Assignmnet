// web/app.js
const logDiv = document.getElementById("log");
const btnConnect = document.getElementById("connect");
const btnTalk = document.getElementById("talk");
const btnEnd = document.getElementById("end");
const btnInterrupt = document.getElementById("interrupt");
const btnSendText = document.getElementById("sendText");
const inputText = document.getElementById("textSend");

function log(msg, cls = "") {
    const p = document.createElement("p");
    if (cls) p.className = cls;
    p.textContent = msg;
    logDiv.appendChild(p);
    logDiv.scrollTop = logDiv.scrollHeight;
}

let ws;
let micStream;
let audioCtxIn;
let encoderNode;
let sourceNode;

let audioCtxOut;
let playerNode;

btnConnect.onclick = async () => {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    // Prepare output audio context & player worklet
    audioCtxOut = new AudioContext({ sampleRate: 24000 });
    await audioCtxOut.audioWorklet.addModule("player-worklet.js");
    playerNode = new AudioWorkletNode(audioCtxOut, "pcm-player");
    playerNode.connect(audioCtxOut.destination);
    await audioCtxOut.resume(); // user gesture

    ws = new WebSocket(`ws://${location.host}/live`);
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
        log("Connected to server.", "sys");
        btnTalk.disabled = false;
        btnEnd.disabled = false;
        btnInterrupt.disabled = false;
        btnSendText.disabled = false;
    };

    ws.onclose = () => {
        log("Disconnected.", "sys");
        btnTalk.disabled = true;
        btnEnd.disabled = true;
        btnInterrupt.disabled = true;
        btnSendText.disabled = true;
    };

    ws.onerror = (e) => log("WS error: " + (e.message || e.type), "sys");

    ws.onmessage = async (evt) => {
        try {
            const msg = JSON.parse(typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data));

            if (msg.type === "audioPCM" && msg.data) {
                // Base64 -> ArrayBuffer -> to player worklet
                const buf = base64ToArrayBuffer(msg.data);
                playerNode.port.postMessage(buf, [buf]);
                console.log("🔊 Queued PCM chunk:", buf.byteLength, "bytes");
            } else if (msg.type === "asr") {
                log("You: " + msg.text, "you");
            } else if (msg.type === "text") {
                log("Rev: " + msg.text, "bot");
            } else if (msg.type === "error") {
                log("❌ " + msg.error, "sys");
            } else if (msg.type === "interrupted") {
                log("⏹️ Model interrupted.", "sys");
            } else if (msg.type === "session_open") {
                log("Gemini session open.", "sys");
            }
        } catch (err) {
            console.warn("Bad message", err);
        }
    };
};

btnTalk.onclick = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        log("Please connect first.", "sys");
        return;
    }

    // Mic → encoder (16kHz) → PCM frames → WS
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioCtxIn = new AudioContext({ sampleRate: 16000 });
    await audioCtxIn.audioWorklet.addModule("pcm-worklet.js");

    encoderNode = new AudioWorkletNode(audioCtxIn, "pcm-encoder");
    encoderNode.port.onmessage = (e) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data); // binary Int16 PCM
        }
    };

    sourceNode = audioCtxIn.createMediaStreamSource(micStream);
    sourceNode.connect(encoderNode);

    log("🎤 Recording...", "sys");
};

btnEnd.onclick = async () => {
    // Stop mic
    if (sourceNode) try { sourceNode.disconnect(); } catch { }
    if (encoderNode) try { encoderNode.disconnect(); } catch { }
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    sourceNode = null;
    encoderNode = null;
    micStream = null;

    // Tell server to finalize turn
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "end" }));
    }

    log("📤 Turn submitted. Awaiting reply…", "sys");
};

btnInterrupt.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "interrupt" }));
        log("⏹️ Interrupt requested.", "sys");
    }
};

btnSendText.onclick = () => {
    const t = (inputText.value || "").trim();
    if (!t || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "text", text: t }));
    log("You: " + t, "you");
    inputText.value = "";
};

function base64ToArrayBuffer(b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

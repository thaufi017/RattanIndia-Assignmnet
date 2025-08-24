// server/index.cjs
require("dotenv").config();
const express = require("express");
const path = require("path");
const { WebSocketServer } = require("ws");
const { GoogleGenAI, Modality } = require("@google/genai");
const { PCM16KHZ_MIME } = require("./audio.cjs");

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.MODEL || "gemini-2.0-flash-live-001";

if (!process.env.GEMINI_API_KEY) {
    console.error("❌ Missing GEMINI_API_KEY in .env");
    process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, "../web")));

const httpServer = app.listen(PORT, () =>
    console.log(`✅ HTTP on http://localhost:${PORT}`)
);

const wss = new WebSocketServer({ server: httpServer, path: "/live" });

wss.on("connection", async (client) => {
    console.log("🌐 Browser connected");

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Create a Live session to Gemini
    const session = await ai.live.connect({
        model: MODEL,
        config: {
            responseModalities: [Modality.AUDIO, Modality.TEXT],
            systemInstruction:
                "You are Rev, the official assistant of Revolt Motors. " +
                "Strictly answer only about Revolt Motors—its products (RV400, RV400 BRZ), specs, features, pricing, service, charging, dealership, financing, delivery, and policies. " +
                "If asked anything unrelated, politely steer the user back to Revolt topics. " +
                "Be concise, friendly, and fluent. If interrupted, stop speaking immediately.",
            inputAudioTranscription: {},    // user ASR
            outputAudioTranscription: {}    // model TTS transcript
        },
        callbacks: {
            onopen: () => {
                console.log("🔗 Gemini session open");
                client.send(JSON.stringify({ type: "session_open" }));
            },
            onmessage: (msg) => {
                // Debug entire message to see what we get back
                // console.dir(msg, { depth: 5 });

                // 1) AUDIO from Gemini (PCM@24kHz, base64). Forward as-is to browser.
                if (msg.data) {
                    const b64 = msg.data; // base64 PCM
                    client.send(JSON.stringify({ type: "audioPCM", sampleRate: 24000, data: b64 }));
                }

                // 2) Input transcription (what user said)
                const sc = msg.serverContent;
                if (sc?.inputTranscription?.text) {
                    client.send(JSON.stringify({ type: "asr", text: sc.inputTranscription.text }));
                }

                // 3) Output (what model is saying)
                if (sc?.outputTranscription?.text) {
                    client.send(JSON.stringify({ type: "tts_text", text: sc.outputTranscription.text }));
                }

                // 4) Text parts (finalized text)
                if (sc?.modelTurn?.parts?.length) {
                    const t = sc.modelTurn.parts.filter(p => p.text).map(p => p.text).join(" ");
                    if (t) client.send(JSON.stringify({ type: "text", text: t }));
                }

                // 5) Interruption signal
                if (sc?.interrupted) {
                    client.send(JSON.stringify({ type: "interrupted" }));
                }
            },
            onerror: (e) => {
                console.error("❌ Gemini live error:", e);
                client.send(JSON.stringify({ type: "error", error: e.message || String(e) }));
            },
            onclose: () => {
                console.log("🔒 Gemini session closed");
                client.send(JSON.stringify({ type: "session_close" }));
            }
        }
    });

    // Browser → server
    client.on("message", async (raw) => {
        // Binary: mic PCM (Int16 @ 16kHz) from encoder worklet
        if (Buffer.isBuffer(raw)) {
            console.log("📥 Audio chunk from browser:", raw.length, "bytes");
            await session.sendRealtimeInput({
                audio: { data: raw.toString("base64"), mimeType: PCM16KHZ_MIME }
            });
            return;
        }

        // JSON control messages
        try {
            const msg = JSON.parse(String(raw));
            if (msg.type === "end") {
                console.log("📤 User turn complete → tell Gemini to respond");
                await session.sendClientContent({ turns: [], turnComplete: true });
            } else if (msg.type === "text") {
                console.log("💬 Text turn:", msg.text);
                await session.sendClientContent({
                    turns: [{ role: "user", parts: [{ text: msg.text }] }],
                    turnComplete: true
                });
            } else if (msg.type === "interrupt") {
                console.log("⏹️ Interrupt requested");
                await session.interrupt();
            }
        } catch (e) {
            console.warn("Ignored non-JSON control message");
        }
    });

    client.on("close", async () => {
        try { await session.close(); } catch { }
        console.log("🔌 Browser disconnected");
    });
});

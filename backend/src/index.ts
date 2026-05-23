import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";

import P from "pino";
import qrcode from "qrcode-terminal";
import dotenv from "dotenv";
import Groq from "groq-sdk";

dotenv.config();

// ======================
// ENV CHECK
// ======================
console.log("🔑 GROQ LOADED:", !!process.env.GROQ_API_KEY);

// ======================
// GROQ CLIENT
// ======================
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// ======================
// CACHE
// ======================
const cache = new Map();

// ======================
// GUARDS
// ======================
const activeBots = new Set();
const reconnecting = new Set();
const qrShown = new Set();

// ======================
// SLEEP
// ======================
function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

// ======================
// QUEUE SYSTEM (INI YANG BARU)
// ======================
const queues = new Map();
// key: instanceId, value: Promise chain

function enqueue(instanceId, task) {
    const prev = queues.get(instanceId) || Promise.resolve();

    const next = prev
        .catch(() => { }) // jangan putus chain kalau error
        .then(() => task());

    queues.set(instanceId, next);

    return next;
}

// ======================
// AI FUNCTION
// ======================
async function askAI(text) {
    try {
        console.log("📤 SEND TO AI:", text);

        if (cache.has(text)) return cache.get(text);

        const res = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",
            messages: [
                {
                    role: "system",
                    content: `
Kamu adalah "Fando", asisten WhatsApp.

ATURAN:
- Santai, natural
- Jawab singkat
- Gunakan bahasa user
- Jangan menyebut AI
- Maks 1 emoji
                    `.trim()
                },
                {
                    role: "user",
                    content: text
                }
            ],
            temperature: 0.8,
            max_tokens: 60
        });

        const reply =
            res.choices?.[0]?.message?.content ||
            "lagi error dikit 😅";

        cache.set(text, reply);
        return reply;

    } catch (err) {
        console.log("❌ AI ERROR:", err);

        // silent fail (tidak spam user)
        return null;
    }
}

// ======================
// START BOT
// ======================
async function startBot(instanceId) {

    if (activeBots.has(instanceId)) return;
    activeBots.add(instanceId);

    const authFolder = `auth_info_${instanceId}`;

    const { state, saveCreds } =
        await useMultiFileAuthState(authFolder);

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        printQRInTerminal: false
    });

    // ======================
    // CONNECTION
    // ======================
    sock.ev.on("connection.update", (update) => {

        const { connection, qr, lastDisconnect } = update;

        if (qr && !qrShown.has(instanceId) && !reconnecting.has(instanceId)) {
            qrShown.add(instanceId);
            console.log(`📱 QR UMKM ${instanceId}`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log(`✅ CONNECTED UMKM ${instanceId}`);
            qrShown.delete(instanceId);
            reconnecting.delete(instanceId);
        }

        if (connection === "close") {

            const code = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = code !== DisconnectReason.loggedOut;

            console.log(`❌ CLOSED UMKM ${instanceId}`);

            if (shouldReconnect && !reconnecting.has(instanceId)) {

                reconnecting.add(instanceId);

                setTimeout(() => {
                    activeBots.delete(instanceId);
                    qrShown.delete(instanceId);
                    startBot(instanceId);
                }, 8000);
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // ======================
    // MESSAGE HANDLER (QUEUE + HUMAN DELAY)
    // ======================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages?.[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text) return;

        console.log(`📥 USER ${instanceId}:`, text);

        // ======================
        // INI QUEUE (PENTING)
        // ======================
        enqueue(instanceId, async () => {

            const reply = await askAI(text);

            if (!reply) {
                console.log("⚠️ AI FAIL (silent)");
                return;
            }

            // HUMAN DELAY (biar natural)
            const delay =
                Math.floor(Math.random() * 4000) + 2000; // 2–6 detik

            console.log(`⏳ delay: ${delay}ms`);
            await sleep(delay);

            console.log(`🤖 BOT ${instanceId}:`, reply);

            await sock.sendMessage(from, {
                text: reply
            });
        });
    });
}

// ======================
// RUN MULTI BOT
// ======================
async function runAllBots() {

    for (let i = 1; i <= 10; i++) {
        startBot(i);
        await sleep(2500);
    }
}

runAllBots();
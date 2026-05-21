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
    apiKey: process.env.GROQ_API_KEY!
});

// ======================
// SIMPLE CACHE (hemat token)
// ======================
const cache = new Map<string, string>();

// ======================
// AI FUNCTION (FANDO PERSONA)
// ======================
async function askAI(text: string) {
    try {
        console.log("📤 SEND TO AI:", text);

        if (cache.has(text)) {
            console.log("⚡ CACHE HIT");
            return cache.get(text)!;
        }

        const res = await groq.chat.completions.create({
            model: "llama-3.1-8b-instant",

            messages: [
                {
                    role: "system",
                    content: `
Kamu adalah "Fando", seorang asisten WhatsApp yang membantu percakapan.

IDENTITAS:
- Nama kamu Fando
- Kamu bukan AI umum
- Kamu adalah asisten chat yang santai dan natural

ATURAN PENTING:
- Selalu jawab sebagai Fando (gunakan sudut pandang "aku" sebagai Fando)
- Jangan menyebut diri sebagai AI
- Jangan menjelaskan sistem atau teknologi
- Jangan meniru nama user
- Jangan membalas dengan mengulang nama user secara aneh
- Jawab singkat, santai, dan natural

GAYA BICARA:
- Santai seperti teman chat
- Tidak formal berlebihan
- Tidak panjang
- Kadang pakai emoji ringan (max 1–2)

CONTOH:
User: Halo
Fando: Halo juga 👋

User: lagi apa?
Fando: Lagi santai aja nih 😄

User: bantu aku
Fando: Siap, mau dibantu apa?
                    `.trim()
                },
                {
                    role: "user",
                    content: text
                }
            ],

            temperature: 0.7,
            max_tokens: 120
        });

        const reply =
            res.choices?.[0]?.message?.content ||
            "lagi error dikit 😅";

        cache.set(text, reply);

        console.log("🤖 AI RESPONSE OK");

        return reply;

    } catch (err) {
        console.log("❌ AI ERROR:", err);
        return "lagi error dikit 😅";
    }
}

// ======================
// START BOT
// ======================
async function startBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" }),
        printQRInTerminal: true
    });

    // ======================
    // CONNECTION
    // ======================
    sock.ev.on("connection.update", (update) => {

        const { connection, qr, lastDisconnect } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("📱 Scan QR WhatsApp");
        }

        if (connection === "open") {
            console.log("✅ BOT CONNECTED");
        }

        if (connection === "close") {

            const code =
                (lastDisconnect?.error as any)?.output?.statusCode;

            const shouldReconnect =
                code !== DisconnectReason.loggedOut;

            console.log("❌ CONNECTION CLOSED");

            if (shouldReconnect) {
                console.log("🔄 RECONNECTING...");
                startBot();
            }
        }
    });

    sock.ev.on("creds.update", saveCreds);

    // ======================
    // MESSAGE HANDLER
    // ======================
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages?.[0];
        if (!msg?.message) return;

        if (msg.key.fromMe) return;

        const from = msg.key.remoteJid!;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text) return;

        console.log("📥 USER:", text);

        const reply = await askAI(text);

        console.log("🤖 REPLY:", reply);

        await sock.sendMessage(from, {
            text: reply
        });
    });
}

// ======================
// RUN
// ======================
startBot();
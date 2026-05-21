import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState
} from "@whiskeysockets/baileys";

import P from "pino";
import qrcode from "qrcode-terminal";

async function startBot() {

    // SIMPAN SESSION
    const { state, saveCreds } =
        await useMultiFileAuthState("auth_info");

    const sock = makeWASocket({
        auth: state,
        logger: P({ level: "silent" })
    });

    // QR
    sock.ev.on("connection.update", (update) => {

        const { connection, qr } = update;

        if (qr) {

            qrcode.generate(qr, {
                small: true
            });

            console.log("Scan QR");
        }

        if (connection === "open") {
            console.log("BOT CONNECTED");
        }

        if (connection === "close") {

            console.log("CONNECTION CLOSED");

            // AUTO RECONNECT
            startBot();
        }
    });

    // SAVE SESSION
    sock.ev.on("creds.update", saveCreds);

    // MESSAGE
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages[0];

        if (!msg.message) return;

        const from = msg.key.remoteJid;

        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        console.log("TEXT:", text);

        // AUTO REPLY
        if (text.toLowerCase() === "halo") {

            await sock.sendMessage(from!, {
                text: "Halo 👋 AI Assistant aktif"
            });
        }
    });
}

startBot();
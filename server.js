import express from "express";
import bodyParser from "body-parser";
import TelegramBot from "node-telegram-bot-api";
import { google } from "googleapis";

const app = express();
const PORT = process.env.PORT || 3000;

// === Env Variables ===
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || "Sheet174";

// === Decode Google Credentials Base64 ===
let credentials;
try {
  const decoded = Buffer.from(
    (process.env.GOOGLE_CREDENTIALS_BASE64 || "").trim(),
    "base64"
  ).toString("utf-8");

  credentials = JSON.parse(decoded);
} catch (err) {
  console.error("❌ Gagal decode GOOGLE_CREDENTIALS_BASE64:", err.message);
  process.exit(1);
}

// === Google Sheets Auth ===
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

// === Telegram Bot ===
const bot = new TelegramBot(TELEGRAM_TOKEN);
app.use(bodyParser.json());

// === Webhook Endpoint ===
app.post(`/webhook/${TELEGRAM_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === Health Check Route ===
app.get("/", (req, res) =>
  res.send("✅ Bot aktif di Render! (version base64 credentials)")
);

// === Handle Telegram Messages ===
bot.on("message", async (msg) => {
  const text = msg.caption || msg.text || "";
  const match = text.match(/(T\d{2})\/(\d+)/i);

  if (!match) return;

  const kode = match[1].toUpperCase(); // T01 - T14
  const poin = match[2];

  try {
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!1:1`,
    });

    const headers = headerRes.data.values ? headerRes.data.values[0] : [];
    const colIndex = headers.indexOf(kode);

    if (colIndex === -1) {
      bot.sendMessage(msg.chat.id, `⚠️ Kolom untuk kode ${kode} tidak ditemukan!`);
      return;
    }

    const dataRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A3:${String.fromCharCode(65 + headers.length - 1)}`,
    });

    const rows = dataRes.data.values || [];

    let targetRow = rows.findIndex((row) => !row[colIndex] || row[colIndex] === "");

    if (targetRow === -1) targetRow = rows.length;

    const rowNumber = targetRow + 3; // Mulai dari baris ke-3

    const colLetter = String.fromCharCode(65 + colIndex);
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!${colLetter}${rowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[poin]] },
    });

    bot.sendMessage(
      msg.chat.id,
      `✅ Data disimpan!\nKode: ${kode}\nNilai: ${poin}\n📊 Baris ke-${rowNumber}`
    );
  } catch (err) {
    console.error("❌ Error Sheets:", err.message);
    bot.sendMessage(msg.chat.id, "❌ Gagal menyimpan ke Google Sheets.");
  }
});

// === Start Server ===
app.listen(PORT, async () => {
  const url = process.env.RENDER_EXTERNAL_URL;
  const webhookUrl = `${url}/webhook/${TELEGRAM_TOKEN}`;

  try {
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook aktif di: ${webhookUrl}`);
  } catch (err) {
    console.error("❌ Gagal set webhook:", err.message);
  }

  console.log(`🚀 Server berjalan di port ${PORT}`);
});

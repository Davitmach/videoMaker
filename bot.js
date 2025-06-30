// import { Telegraf } from "telegraf";
// import RunwayML from "@runwayml/sdk";
// import axios from "axios";
// import fs from "fs";
// import path from "path";
// import dotenv from "dotenv";

// // Загружаем переменные окружения из .env
// dotenv.config();

// // ----- НАСТРОЙКИ -----------------------------------------------------------
// const BOT_TOKEN = process.env.BOT_TOKEN;           // токен от @BotFather
// const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY; // ключ Runway ML
// const RUNWAY_VERSION = "2024-11-06";              // актуальная версия API
// const TMP_DIR = path.resolve("./images");         // куда кладём временные фото

// if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

// // ---------------------------------------------------------------------------
// const bot = new Telegraf(BOT_TOKEN);

// // Клиент Runway SDK
// const runway = new RunwayML({
//   apiKey: RUNWAY_API_KEY,
//   headers: { "X-Runway-Version": RUNWAY_VERSION },
// });

// // Временное хранение prompt между сообщениями
// const userPrompts = new Map();

// // 1) Получаем текст-описание
// bot.on("text", async (ctx) => {
//   userPrompts.set(ctx.chat.id, ctx.message.text);
//   await ctx.reply("Теперь пришли фото, по которому нужно сделать видео.");
// });

// // 2) Получаем фото → генерируем видео
// bot.on("photo", async (ctx) => {
//   const prompt = userPrompts.get(ctx.chat.id);
//   if (!prompt) {
//     return ctx.reply("Сначала отправь текст (описание для видео), потом фото.");
//   }

//   const photo = ctx.message.photo.pop();                // самое большое по размеру
//   const fileLink = await ctx.telegram.getFileLink(photo.file_id);
//   const filePath = path.join(TMP_DIR, `${photo.file_id}.jpg`);

//   try {
//     await downloadFile(fileLink.href, filePath);
//     await ctx.reply("Генерирую видео, подожди немного…");

//     const videoUrl = await generateVideo(filePath, prompt);
//     await ctx.replyWithVideo({ url: videoUrl });
//   } catch (err) {
//     console.error(err);
//     await ctx.reply("Произошла ошибка при генерации видео 😔");
//   } finally {
//     if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // чистим tmp
//     userPrompts.delete(ctx.chat.id);
//   }
// });

// // ---------------------------------------------------------------------------
// // Скачиваем файл потоком через axios
// async function downloadFile(url, dest) {
//   const response = await axios.get(url, { responseType: "stream" });
//   const writer = fs.createWriteStream(dest);
//   return new Promise((resolve, reject) => {
//     response.data.pipe(writer);
//     writer.on("finish", resolve);
//     writer.on("error", reject);
//   });
// }

// // Генерируем видео через Runway SDK
// async function generateVideo(imagePath, prompt) {
//   const dataUri = makeDataURI(imagePath);
//   const task = await runway.imageToVideo
//     .create({
//       model: "gen4_turbo",      // либо gen-2/gen-3
//       promptImage: dataUri,      // < 5 МБ base64
//       promptText: prompt,
//       ratio: "1280:720",
//       duration: 5,
//     })
//     .waitForTaskOutput();        // ждём SUCCEEDED

//   return task.output[0];         // ссылка на .mp4
// }

// // Читаем файл и превращаем в Data URI
// function makeDataURI(filePath) {
//   const mime = "image/jpeg"; // сохраняем как .jpg
//   const b64 = fs.readFileSync(filePath).toString("base64");
//   return `data:${mime};base64,${b64}`;
// }
// const DOMAIN = 'https://videomaker-pwn2.onrender.com'; 
// const TOKEN = '8049374841:AAE88n9H8oa4X0phtItDDM1OXEysFxKfOuA'; 

// // ---------------------------------------------------------------------------
// console.log("🤖 Бот запущен! Нажми Ctrl-C для остановки.");
// bot.launch({
//   webhook: {
//     domain: DOMAIN,
//     port:  3000, 
//     hookPath: `/${TOKEN}`
//   }
// });
// // Корректное выключение
// process.once("SIGINT", () => bot.stop("SIGINT"));
// process.once("SIGTERM", () => bot.stop("SIGTERM"));


import { Telegraf } from "telegraf";
import RunwayML, { TaskFailedError, APIError } from "@runwayml/sdk";
import axios from "axios";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import sizeOf from "image-size";
import dotenv from "dotenv";

dotenv.config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;
const RUNWAY_VERSION = "2024-11-06";
const TMP_DIR = path.resolve("./images");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR);

const bot = new Telegraf(BOT_TOKEN);

const runway = new RunwayML({
  apiKey: RUNWAY_API_KEY,
  headers: { "X-Runway-Version": RUNWAY_VERSION },
});

const userPrompts = new Map();

bot.on("text", async (ctx) => {
  userPrompts.set(ctx.chat.id, ctx.message.text);
  await ctx.reply("Теперь пришли фото, по которому нужно сделать видео.");
});

bot.on("photo", async (ctx) => {
  const prompt = userPrompts.get(ctx.chat.id);
  if (!prompt) {
    return ctx.reply("Сначала отправь текст-описание, потом фото.");
  }

  const photo = ctx.message.photo.pop();
  const fileLink = await ctx.telegram.getFileLink(photo.file_id);
  const originalPath = path.join(TMP_DIR, `${photo.file_id}_orig.jpg`);
  const resizedPath = path.join(TMP_DIR, `${photo.file_id}_resized.jpg`);

  try {
    await downloadFile(fileLink.href, originalPath);
    await resizeImage(originalPath, resizedPath);
    const ratio = getAutoRatio(resizedPath);

    await ctx.reply("Генерирую видео, подожди немного…");

    const videoUrl = await generateVideo(resizedPath, prompt, ratio);
    await ctx.replyWithVideo({ url: videoUrl });
  } catch (err) {
    console.error("❌ Ошибка:", err);

    if (err.message?.includes("Runway не смог")) {
      await ctx.reply("⚠️ Runway не смог сгенерировать видео. Попробуй другое описание или фото.");
    } else if (err instanceof APIError && err.body?.error?.includes("ratio")) {
      await ctx.reply("⚠️ Неподдерживаемое разрешение. Отправь фото другого размера.");
    } else {
      await ctx.reply("Произошла ошибка при генерации видео 😔");
    }
  } finally {
    [originalPath, resizedPath].forEach((p) => fs.existsSync(p) && fs.unlinkSync(p));
    userPrompts.delete(ctx.chat.id);
  }
});

// 🧠 Определяем горизонтальное/вертикальное фото
function getAutoRatio(imagePath) {
  const { width, height } = sizeOf(imagePath);
  return width > height ? "1280:768" : "768:1280";
}

// Скачивание фото
async function downloadFile(url, dest) {
  const response = await axios.get(url, { responseType: "stream" });
  const writer = fs.createWriteStream(dest);
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

// Сжатие фото
async function resizeImage(inputPath, outputPath) {
  return sharp(inputPath)
    .resize({ width: 1024 })
    .jpeg({ quality: 80 })
    .toFile(outputPath);
}

// Превращение в base64
function makeDataURI(filePath) {
  const mime = "image/jpeg";
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

// Генерация видео через Runway
async function generateVideo(imagePath, prompt, ratio) {
  const dataUri = makeDataURI(imagePath);

  try {
    const task = await runway.imageToVideo
      .create({
        model: "gen4_turbo",
        promptImage: dataUri,
        promptText: prompt,
        ratio,
        duration: 5,
      })
      .waitForTaskOutput();

    return task.output[0];
  } catch (err) {
    if (err instanceof TaskFailedError) {
      const details = err.taskDetails;
      console.error("❌ Ошибка генерации:", details);

      if (details.failureCode === "INTERNAL.BAD_OUTPUT.CODE01") {
        throw new Error("Runway не смог сгенерировать видео. Попробуй другое описание или фото.");
      }

      throw new Error("Ошибка на стороне модели: " + details.failure);
    } else {
      throw err;
    }
  }
}

// ──────────────── Запуск через webhook ─────────────────────
const DOMAIN = 'https://videomaker-pwn2.onrender.com';
const TOKEN = BOT_TOKEN;

bot.launch({
  webhook: {
    domain: DOMAIN,
    port: 3000,
    hookPath: `/${TOKEN}`,
  },
});

console.log("🤖 Бот запущен! Нажми Ctrl+C для остановки");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

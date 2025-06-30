import { Telegraf } from "telegraf";
import RunwayML, { TaskFailedError, APIError } from "@runwayml/sdk";
import axios from "axios";
import fs from "fs";
import path from "path";
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
  const filePath = path.join(TMP_DIR, `${photo.file_id}.jpg`);

  try {
    await downloadFile(fileLink.href, filePath);

    // Проверяем размеры фото и выдаём предупреждение, если слишком маленькое или соотношение не подходит
    let dimensions;
    try {
      dimensions = sizeOf(filePath);
    } catch (e) {
      await ctx.reply("⚠️ Не удалось определить размер фотографии. Попробуй другое фото.");
      throw e;
    }

    const { width, height } = dimensions;
    if (width < 200 || height < 200) {
      await ctx.reply("⚠️ Фото слишком маленькое, нужно побольше.");
      throw new Error("Фото слишком маленькое");
    }

    const ratioStr = width > height ? "1280:768" : "768:1280";

    await ctx.reply("Генерирую видео, подожди немного…");

    const videoUrl = await generateVideo(filePath, prompt, ratioStr);
    await ctx.replyWithVideo({ url: videoUrl });
  } catch (err) {
    console.error(err);

    if (err instanceof TaskFailedError) {
      const details = err.taskDetails;
      if (details.failureCode === "INTERNAL.BAD_OUTPUT.CODE01") {
        await ctx.reply("⚠️ Runway не смог сгенерировать видео по этому фото и описанию. Попробуй изменить описание или фото.");
      } else {
        await ctx.reply(`⚠️ Ошибка генерации видео: ${details.failure || "неизвестная ошибка"}`);
      }
    } else if (err instanceof APIError && err.body?.error?.includes("ratio")) {
      await ctx.reply("⚠️ Неподдерживаемое соотношение сторон у фото. Отправь фото с другим размером.");
    } else if (err.message === "Фото слишком маленькое") {
      // Уже отправили предупреждение, ничего делать не нужно
    } else {
      await ctx.reply("Произошла ошибка при генерации видео 😔");
    }
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    userPrompts.delete(ctx.chat.id);
  }
});

async function downloadFile(url, dest) {
  const response = await axios.get(url, { responseType: "stream" });
  const writer = fs.createWriteStream(dest);
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
}

async function generateVideo(imagePath, prompt, ratio) {
  const dataUri = makeDataURI(imagePath);

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
}

function makeDataURI(filePath) {
  const mime = "image/jpeg";
  const b64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mime};base64,${b64}`;
}

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

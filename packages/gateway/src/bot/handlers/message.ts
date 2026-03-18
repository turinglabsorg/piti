import type { Context } from "telegraf";
import type { Dispatcher } from "../../orchestrator/dispatcher.js";
import type { MediaAttachment } from "@piti/shared";
import { createLogger, SUPPORTED_LANGUAGES_SET } from "@piti/shared";

const logger = createLogger("message-handler");


export function registerMessageHandler(bot: any, dispatcher: Dispatcher) {
  // Handle language selection callback — validate against whitelist
  bot.action(/^setlang_(.+)$/, async (ctx: any) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const language = ctx.match[1];
    if (!SUPPORTED_LANGUAGES_SET.has(language)) {
      logger.warn("Invalid language callback", { telegramId, language });
      await ctx.answerCbQuery("Invalid language");
      return;
    }
    await dispatcher.setUserLanguage(telegramId, language);

    const langNames: Record<string, string> = {
      english: "English \u{1F1EC}\u{1F1E7}",
      italian: "Italiano \u{1F1EE}\u{1F1F9}",
      spanish: "Espanol \u{1F1EA}\u{1F1F8}",
      french: "Francais \u{1F1EB}\u{1F1F7}",
      german: "Deutsch \u{1F1E9}\u{1F1EA}",
      portuguese: "Portugues \u{1F1E7}\u{1F1F7}",
    };

    const name = langNames[language] || language;
    await ctx.answerCbQuery(`${name}`);
    await ctx.editMessageText(`${name} selected!`);
  });

  // Handle text messages
  bot.on("text", async (ctx: Context) => {
    const text = (ctx.message as any)?.text;
    const telegramId = ctx.from?.id;

    if (!text || !telegramId) return;
    if (text.startsWith("/")) return;

    await handleUserMessage(ctx, dispatcher, telegramId, text);
  });

  // Handle photos
  bot.on("photo", async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const msg = ctx.message as any;
    const caption = msg.caption || "Analyze this image.";
    // Telegram sends multiple sizes — take the largest
    const photos = msg.photo;
    const largest = photos[photos.length - 1];

    try {
      await ctx.sendChatAction("typing");

      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const imageData = await downloadAsBase64(fileLink.href);

      const media: MediaAttachment = {
        type: "image",
        data: [imageData],
        mimeType: "image/jpeg",
        caption,
      };

      await handleUserMessage(ctx, dispatcher, telegramId, caption, media);
    } catch (err) {
      logger.error("Error processing photo", { telegramId, error: err });
      await ctx.reply("Sorry, I couldn't process that image. Please try again.");
    }
  });

  // Handle videos and video notes (round videos)
  bot.on(["video", "video_note"], async (ctx: Context) => {
    const telegramId = ctx.from?.id;
    if (!telegramId) return;

    const msg = ctx.message as any;
    const video = msg.video || msg.video_note;
    const caption = msg.caption || "Analyze this video.";

    // Check video size — Telegram allows up to 20MB download
    if (video.file_size && video.file_size > 20 * 1024 * 1024) {
      await ctx.reply("Video is too large. Please send a shorter clip (max 20MB).");
      return;
    }

    try {
      await ctx.sendChatAction("typing");
      await ctx.reply("🎥 Processing video... extracting frames for analysis.");

      const fileLink = await ctx.telegram.getFileLink(video.file_id);
      const frames = await extractVideoFrames(fileLink.href);

      if (frames.length === 0) {
        await ctx.reply("Couldn't extract frames from this video. Try sending a shorter, clearer clip.");
        return;
      }

      const media: MediaAttachment = {
        type: "video_frames",
        data: frames,
        mimeType: "image/jpeg",
        caption,
      };

      logger.info("Video frames extracted", { telegramId, frameCount: frames.length });
      await handleUserMessage(ctx, dispatcher, telegramId, caption, media);
    } catch (err) {
      logger.error("Error processing video", { telegramId, error: err });
      await ctx.reply("Sorry, I couldn't process that video. Please try again with a shorter clip.");
    }
  });
}

async function handleUserMessage(
  ctx: Context,
  dispatcher: Dispatcher,
  telegramId: number,
  text: string,
  media?: MediaAttachment
) {
  try {
    // Keep typing indicator alive every 4s until response is ready
    const typingInterval = setInterval(() => {
      ctx.sendChatAction("typing").catch(() => {});
    }, 4000);
    await ctx.sendChatAction("typing");

    let result;
    try {
      result = await dispatcher.dispatch(
        telegramId,
        text,
        ctx.from?.username,
        ctx.from?.first_name,
        media
      );
    } finally {
      clearInterval(typingInterval);
    }

    await sendReply(ctx, result.reply);

    // If new user, show compact language picker
    if (result.isNewUser) {
      await ctx.reply(
        "Choose your language:",
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: "\u{1F1EC}\u{1F1E7}", callback_data: "setlang_english" },
                { text: "\u{1F1EE}\u{1F1F9}", callback_data: "setlang_italian" },
                { text: "\u{1F1EA}\u{1F1F8}", callback_data: "setlang_spanish" },
                { text: "\u{1F1EB}\u{1F1F7}", callback_data: "setlang_french" },
                { text: "\u{1F1E9}\u{1F1EA}", callback_data: "setlang_german" },
                { text: "\u{1F1E7}\u{1F1F7}", callback_data: "setlang_portuguese" },
              ],
            ],
          },
        } as any
      );
    }
  } catch (err) {
    logger.error("Error processing message", { telegramId, error: err });
    await ctx.reply("Sorry, I encountered an error processing your message. Please try again.");
  }
}

async function downloadAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("base64");
}

async function extractVideoFrames(videoUrl: string, maxFrames = 6): Promise<string[]> {
  const { execSync } = await import("child_process");
  const { mkdtempSync, readdirSync, readFileSync, rmSync } = await import("fs");
  const { join } = await import("path");
  const { tmpdir } = await import("os");

  const tmpDir = mkdtempSync(join(tmpdir(), "piti-video-"));

  try {
    // Download video
    const videoPath = join(tmpDir, "input.mp4");
    const videoResponse = await fetch(videoUrl);
    const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
    const { writeFileSync } = await import("fs");
    writeFileSync(videoPath, videoBuffer);

    // Get video duration
    let duration = 10;
    try {
      const probeOutput = execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
        { encoding: "utf-8", timeout: 10_000 }
      ).trim();
      duration = parseFloat(probeOutput) || 10;
    } catch {
      // Use default duration
    }

    // Extract frames at even intervals
    const interval = Math.max(duration / (maxFrames + 1), 0.5);
    const framePattern = join(tmpDir, "frame_%03d.jpg");

    execSync(
      `ffmpeg -i "${videoPath}" -vf "fps=1/${interval},scale=640:-1" -frames:v ${maxFrames} -q:v 3 "${framePattern}" -y`,
      { timeout: 30_000, stdio: "pipe" }
    );

    // Read frames as base64
    const files = readdirSync(tmpDir)
      .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
      .sort();

    return files.map((f) => readFileSync(join(tmpDir, f)).toString("base64"));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function sendReply(ctx: Context, reply: string) {
  const html = markdownToTelegramHtml(reply);
  const chunks = html.length > 4096 ? splitMessage(html, 4096) : [html];

  for (const chunk of chunks) {
    await ctx.reply(chunk, { parse_mode: "HTML" }).catch(() =>
      ctx.reply(chunk)
    );
  }
}

/**
 * Convert LLM markdown output to Telegram-compatible HTML.
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a>, <blockquote>
 */
function markdownToTelegramHtml(md: string): string {
  // Step 1: Extract code blocks to protect them from processing
  const codeBlocks: string[] = [];
  let html = md.replace(/```(?:\w+)?\n([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(code);
    return `%%CODEBLOCK_${codeBlocks.length - 1}%%`;
  });

  const inlineCodes: string[] = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `%%INLINE_${inlineCodes.length - 1}%%`;
  });

  // Step 2: Escape HTML special chars in the text
  html = html.replace(/&/g, "&amp;");
  html = html.replace(/</g, "&lt;");
  html = html.replace(/>/g, "&gt;");

  // Step 3: Convert markdown to HTML tags

  // Headers → bold text
  html = html.replace(/^#{1,6}\s+(.+)$/gm, "\n<b>$1</b>\n");

  // Bold+italic ***text***
  html = html.replace(/\*{3}(.+?)\*{3}/g, "<b><i>$1</i></b>");

  // Bold **text**
  html = html.replace(/\*{2}(.+?)\*{2}/g, "<b>$1</b>");

  // Italic *text* (not inside words)
  html = html.replace(/(?<!\w)\*([^\s*](?:.*?[^\s*])?)\*(?!\w)/g, "<i>$1</i>");

  // Strikethrough ~~text~~
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Blockquotes &gt; text (already escaped)
  html = html.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

  // Bullet points: * or - at start of line → •
  html = html.replace(/^[\*\-]\s+/gm, "• ");

  // Step 4: Restore code blocks with HTML tags
  html = html.replace(/%%CODEBLOCK_(\d+)%%/g, (_, i) => {
    const code = codeBlocks[parseInt(i)]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre>${code}</pre>`;
  });

  html = html.replace(/%%INLINE_(\d+)%%/g, (_, i) => {
    const code = inlineCodes[parseInt(i)]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<code>${code}</code>`;
  });

  // Clean up multiple blank lines
  html = html.replace(/\n{3,}/g, "\n\n");

  return html.trim();
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = remaining.lastIndexOf("\n", maxLength);
    if (splitIdx === -1 || splitIdx < maxLength / 2) {
      splitIdx = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIdx === -1) {
      splitIdx = maxLength;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).trimStart();
  }

  return chunks;
}

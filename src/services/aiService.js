const isLive = () => process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "mock" && !!process.env.AI_API_KEY;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toneOpeners = {
  Professional: ["We're excited to share", "Proud to announce", "Here's an update on"],
  Creative: ["Picture this:", "Something new just landed —", "We've been cooking up"],
  Funny: ["Okay, we can't keep this a secret any longer:", "Plot twist:", "Breaking (mildly exciting) news:"],
  Minimalist: ["New:", "Now available:", "Update:"],
  Excited: ["We are SO excited to finally share this!", "Big news, and we mean BIG:", "This is the moment we've been waiting for —"],
};
const buildMockCaption = (prompt, tone) => {
  const openers = toneOpeners[tone] || toneOpeners.Professional;
  const opener = openers[Math.floor(Math.random() * openers.length)];
  const trimmedPrompt = prompt.replace(/^create a post about\s*/i, "").replace(/\.$/, "");
  const hashtags = trimmedPrompt.split(/\s+/).filter((w) => w.length > 3).slice(0, 3).map((w) => `#${w.replace(/[^a-zA-Z0-9]/g, "")}`).join(" ");
  return `${opener} ${trimmedPrompt}. Designed for people who want to get more done without the busywork — take a look and let us know what you think.\n\n${hashtags}`.trim();
};

const openaiRequest = async (url, body, timeoutMs = 45000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error?.message || `AI request failed (${res.status})`);
      err.status = res.status;
      err.retryable = res.status === 429 || res.status >= 500;
      throw err;
    }
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("AI request timed out.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

export const generateCaption = async ({ prompt, tone = "Professional" }) => {
  if (isLive()) {
    const data = await openaiRequest("https://api.openai.com/v1/chat/completions", {
      model: process.env.AI_TEXT_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: `Write a short, engaging social media caption in a ${tone.toLowerCase()} tone. Keep it under 280 characters and include 1-3 relevant hashtags.` },
        { role: "user", content: prompt },
      ],
    });
    const caption = data.choices?.[0]?.message?.content?.trim();
    if (!caption) throw new Error("AI returned an empty caption.");
    return caption.slice(0, 280);
  }
  await delay(300);
  return buildMockCaption(prompt, tone);
};

export const generateImage = async ({ prompt }) => {
  if (isLive()) {
    const data = await openaiRequest("https://api.openai.com/v1/images/generations", {
      model: process.env.AI_IMAGE_MODEL || "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
    }, 90000);
    const url = data.data?.[0]?.url;
    if (!url) throw new Error("AI returned no image URL.");
    return url;
  }
  await delay(400);
  return `https://picsum.photos/seed/${encodeURIComponent(prompt.slice(0, 40) || "loop")}/800/800`;
};

export default { generateCaption, generateImage };

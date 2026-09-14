const cloudflareRequest = async (model, body) => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured.");
  }

  if (!apiToken) {
    throw new Error("CLOUDFLARE_API_TOKEN is not configured.");
  }

  const url =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`;

  console.log("Cloudflare AI URL:", url);

  const response = await fetch(url, {
    method: "POST",

    headers: {
      "Authorization": `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },

    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();

    console.error(
      "Cloudflare response:",
      response.status,
      errorText
    );

    const error = new Error(
      `Cloudflare AI request failed (${response.status}): ${errorText}`
    );

    error.status = response.status;

    throw error;
  }

  return response.json();
};


// =========================
// IMAGE GENERATION
// =========================

export const generateImage = async ({ prompt }) => {
  const cleanPrompt = String(prompt || "").trim();

  if (!cleanPrompt) {
    throw new Error("Image prompt is required.");
  }

  const model =
    process.env.CLOUDFLARE_IMAGE_MODEL ||
    "@cf/black-forest-labs/flux-1-schnell";

  const data = await cloudflareRequest(model, {
    prompt: cleanPrompt,
    steps: 4,
  });

  if (!data?.success) {
    throw new Error(
      data?.errors?.[0]?.message ||
        "Cloudflare AI failed to generate the image."
    );
  }

  if (!data?.result?.image) {
    throw new Error("Cloudflare AI returned no image.");
  }

  return {
    base64: data.result.image,
    mimeType: "image/jpeg",
  };
};


// =========================
// TEXT GENERATION
// =========================

export const generateText = async ({ prompt }) => {
  const cleanPrompt = String(prompt || "").trim();

  if (!cleanPrompt) {
    throw new Error("Text prompt is required.");
  }

  const model =
    process.env.CLOUDFLARE_TEXT_MODEL ||
    "@cf/meta/llama-3.2-3b-instruct";

  const data = await cloudflareRequest(model, {
    messages: [
      {
        role: "system",
        content:
          "You are a professional social media content writer. " +
          "Create engaging, natural and human-sounding social media captions. " +
          "Do not add hashtags unless they are specifically requested. " +
          "Return only the final caption text.",
      },
      {
        role: "user",
        content: cleanPrompt,
      },
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  if (!data?.success) {
    throw new Error(
      data?.errors?.[0]?.message ||
        "Cloudflare AI failed to generate text."
    );
  }

  if (!data?.result?.response) {
    throw new Error("Cloudflare AI returned no text.");
  }

  return data.result.response.trim();
};


export default {
  generateImage,
  generateText,
};
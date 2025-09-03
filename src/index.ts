import { Hono } from 'hono';
import { ExportedHandlerScheduledHandler, KVNamespace } from '@cloudflare/workers-types';

// 型定義
type Env = {
  SWITCH_BOT_TOKEN: string;
  SWITCH_BOT_SECRET: string;
  SWITCH_BOT_DEVICE_ID: string;
  DISCORD_WEBHOOK_URL: string;
};
type EnvWithKV = Env & { WASHER_MONITORRING: KVNamespace };

type PlugMiniStatusResponse = {
  statusCode: number;
  body: {
    deviceId: string;
    deviceType: string;
    hubDeviceId: string;
    voltage: number;
    version: string;
    weight: number;
    electricityOfDay: number;
    electricCurrent: number;
  };
  message: string;
};

const app = new Hono<{ Bindings: EnvWithKV }>();

// 署名生成
async function generateSignature(token: string, secret: string) {
  const nonce = crypto.randomUUID();
  const t = Date.now();
  const stringToSign = `${token}${t}${nonce}`;
  const encoder = new TextEncoder();
  const secretEncoded = encoder.encode(secret);
  const stringToSignEncoded = encoder.encode(stringToSign);

  const key = await crypto.subtle.importKey(
    "raw",
    secretEncoded,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signArrayBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    stringToSignEncoded
  );
  const sign = btoa(String.fromCharCode(...new Uint8Array(signArrayBuffer)));
  return { sign, t, nonce };
}

// SwitchBot Plug Miniのステータス取得
async function fetchPlugMiniStatus(
  token: string,
  deviceId: string,
  sign: string,
  t: number,
  nonce: string
): Promise<PlugMiniStatusResponse> {
  const url = `https://api.switch-bot.com/v1.1/devices/${deviceId}/status`;
  const headers = {
    Authorization: token,
    "Content-Type": "application/json",
    t: t.toString(),
    sign,
    nonce,
  };

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SwitchBot API error: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`SwitchBot API request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("SwitchBot API fetch error:", error);
    return {
      statusCode: -1,
      body: {
        deviceId: "",
        deviceType: "",
        hubDeviceId: "",
        voltage: 0,
        version: "",
        weight: 0,
        electricityOfDay: 0,
        electricCurrent: 0,
      },
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Discord通知
async function sendDiscordNotification(webhookUrl: string, message: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      console.warn(`Discord Webhook rate limited. Retry after ${retryAfter || 1}秒`);
      return "Rate limited";
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Discord通知失敗: ${response.status} ${response.statusText} - ${errorText}`);
      return `Error: ${response.status} ${response.statusText}`;
    }

    return "OK";
  } catch (error) {
    console.error("Discord通知時に例外発生:", error);
    return error instanceof Error ? error.message : String(error);
  }
}

// スケジュールイベントハンドラー
const scheduled: ExportedHandlerScheduledHandler<EnvWithKV> = async (
  event,
  env,
  ctx
) => {
  const { SWITCH_BOT_TOKEN, SWITCH_BOT_SECRET, SWITCH_BOT_DEVICE_ID, DISCORD_WEBHOOK_URL, WASHER_MONITORRING } = env;

  const { sign, t, nonce } = await generateSignature(SWITCH_BOT_TOKEN, SWITCH_BOT_SECRET);
  const res = await fetchPlugMiniStatus(SWITCH_BOT_TOKEN, SWITCH_BOT_DEVICE_ID, sign, t, nonce);

  if (res.statusCode === 100) {
    // 消費電力計算（W = V × A(mA / 1000)）
    const watt = res.body.voltage * (res.body.electricCurrent / 1000);
    const currentStatus = await WASHER_MONITORRING.get("status") ?? "0";

    // 状態変化時のみ通知・KV更新
    if (currentStatus === "0" && watt > 0) {
      await Promise.all([
        sendDiscordNotification(DISCORD_WEBHOOK_URL, "ゴシゴシはじめますわ〜！"),
        WASHER_MONITORRING.put("status", "1"),
      ]);
    } else if (currentStatus === "1" && watt < 1) {
      await Promise.all([
        sendDiscordNotification(DISCORD_WEBHOOK_URL, "早く干してくださいませ〜！"),
        WASHER_MONITORRING.put("status", "0"),
      ]);
    }
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
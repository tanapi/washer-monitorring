import { Hono } from 'hono';
import { ExportedHandlerScheduledHandler, KVNamespace, SecretsStoreSecret } from '@cloudflare/workers-types';

// 型定義
type Env = {
  SWITCH_BOT_TOKEN: SecretsStoreSecret;
  SWITCH_BOT_SECRET: SecretsStoreSecret;
  WEBHOOK_PROXY_SECRET: SecretsStoreSecret;
  SWITCH_BOT_DEVICE_ID: string;
  WEBHOOK_PROXY_URL: string;
  DISCORD_WEBHOOK_URL: string;
  WASHER_START_THRESHOLD?: string;
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
async function sendDiscordNotification(webhookUrl: string, proxyUrl: string, proxySecret: string, message: string) {
  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "authorization": `Bearer ${proxySecret}`
      },
      body: JSON.stringify(
        { 
          content: message, 
          webhook_url: webhookUrl 
        }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      console.warn(`Discord Webhook rate limited. Retry after ${retryAfter || 1}秒`);

      // レスポンスヘッダーからRetry-Afterを取得し、指定された秒数だけ待機して再試行
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
      setTimeout(() => {
        sendDiscordNotification(webhookUrl, proxyUrl, proxySecret, message);
      }, waitTime);
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
  const { 
          SWITCH_BOT_DEVICE_ID, 
          WEBHOOK_PROXY_URL, 
          DISCORD_WEBHOOK_URL, 
          WASHER_MONITORRING, 
          SWITCH_BOT_TOKEN, 
          SWITCH_BOT_SECRET,
          WEBHOOK_PROXY_SECRET 
        } = env;

  // Secrets StoreからSwitch Bot APIの認証情報を取得（未設定時はエラー）
  const switchBotToken = await SWITCH_BOT_TOKEN.get();
  const switchBotSecret = await SWITCH_BOT_SECRET.get();
  const webhookProxySecret = await WEBHOOK_PROXY_SECRET.get();
  if (!switchBotToken || !switchBotSecret || !webhookProxySecret) {
    console.error("シークレットが未設定です");
    return;
  }
  const { sign, t, nonce } = await generateSignature(switchBotToken, switchBotSecret);
  const res = await fetchPlugMiniStatus(switchBotToken, SWITCH_BOT_DEVICE_ID, sign, t, nonce);

  if (res.statusCode === 100) {
    // 消費電力計算（W = V × A(mA / 1000)）
    const watt = res.body.voltage * (res.body.electricCurrent / 1000);
    const currentStatus = await WASHER_MONITORRING.get("status") ?? "0";

    // 起動判定の閾値を環境変数から取得（未設定や不正値はデフォルト5W）
    const WASHER_START_THRESHOLD = (() => {
      const val = parseInt(env.WASHER_START_THRESHOLD ?? "5", 10);
      return isNaN(val) ? 5 : val;
    })();

    // 状態変化時のみ通知・KV更新
    const handleStatusChange = async (nextStatus: "0" | "1", message: string) => {
      const [notificationResult, kvResult] = await Promise.allSettled([
        sendDiscordNotification(
          DISCORD_WEBHOOK_URL,
          WEBHOOK_PROXY_URL,
          webhookProxySecret,
          message
        ),
        WASHER_MONITORRING.put("status", nextStatus),
      ]);
      if (notificationResult.status === 'rejected') {
        console.error("通知送信失敗:", notificationResult.reason);
      }
      if (kvResult.status === 'rejected') {
        console.error("KV更新失敗:", kvResult.reason);
      }
    };

    if (currentStatus === "0" && watt >= WASHER_START_THRESHOLD) {
      await handleStatusChange("1", "ゴシゴシはじめますわ〜！");
    } else if (currentStatus === "1" && watt < WASHER_START_THRESHOLD) {
      await handleStatusChange("0", "早く干してくださいませ〜！");
    }
  }
};

export default {
  fetch: app.fetch,
  scheduled,
};
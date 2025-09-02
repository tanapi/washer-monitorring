import { Hono } from 'hono';
import {ExportedHandlerScheduledHandler, KVNamespace} from '@cloudflare/workers-types';

// 環境変数の型定義
type Env = {
  SWITCH_BOT_TOKEN: string;
  SWITCH_BOT_SECRET: string;
  SWITCH_BOT_DEVICE_ID: string;
  DISCORD_WEBHOOK_URL: string;
};

// 環境変数とKVバインディングを含む型定義
type EnvWithKV = Env & {
  tana_p_washer_status: KVNamespace;
};

// SwitchBot APIのレスポンス型定義
type SwitchBotResponse = {
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

// Honoアプリケーションの初期化
const app = new Hono<{ Bindings: EnvWithKV }>();

// SwitchBot API 1.1の署名生成関数
async function generateSignature(token: string, secret: string) {
  const nonce = crypto.randomUUID(); // UUID v4を生成
  const t = Date.now(); // 現在のタイムスタンプ（ミリ秒）
  const stringToSign = `${token}${t}${nonce}`;
  const encoder = new TextEncoder();
  const secretEncoded = encoder.encode(secret);
  const stringToSignEncoded = encoder.encode(stringToSign);

  // HMAC-SHA256署名を生成
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

// SwitchBot Plug Miniのステータスを取得する関数
async function fetchFromSwitchBotPlugMiniStatus(
  token: string,
  deviceId: string,
  sign: string,
  t: number,
  nonce: string
) {
  // SwitchBot APIのエンドポイント
  const SWITCH_BOT_API_URL = `https://api.switch-bot.com/v1.1/devices/${deviceId}/status`;

  // ヘッダーを設定
  const apiHeader = {
    Authorization: token,
    "Content-Type": "application/json",
    t: t.toString(),
    sign: sign,
    nonce: nonce,
  };

  // APIリクエストを送信
  try {
    const response = await fetch(SWITCH_BOT_API_URL, {
      headers: apiHeader,
    });

    if (!response.ok) {
      // ステータスコードが200系でない場合はエラー内容をログ出力
      const errorText = await response.text();
      console.error(`SwitchBot API error: ${response.status} ${response.statusText} - ${errorText}`);
      throw new Error(`SwitchBot API request failed: ${response.status} ${response.statusText}`);
    }

    const res: SwitchBotResponse = await response.json();
    console.log(res);

    return res;
  } catch (error) {
    // fetch自体が失敗した場合やJSONパースエラー時
    console.error("SwitchBot API fetch error:", error);
    // 必要に応じてエラー内容を返すか、nullやダミー値を返す
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

// Discord通知を送信する関数
async function sendDiscordNotification(webhookUrl: string, message: string) {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: message }),
    });

    // レートリミットに達した場合、Retry-Afterヘッダーに基づいて再試行
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      // Cloudflare Workers では setTimeout は使えないため、リトライはログ出力のみ
      console.warn(
        `Discord Webhook rate limited. Retry after ${retryAfter || 1}秒`
      );
      return "Rate limited";
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `Discord通知失敗: ${response.status} ${response.statusText} - ${errorText}`
      );
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
  // 環境変数を取得
  const token = env.SWITCH_BOT_TOKEN;
  const secret = env.SWITCH_BOT_SECRET;
  const deviceId = env.SWITCH_BOT_DEVICE_ID;
  const discordWebhookUrl = env.DISCORD_WEBHOOK_URL;
  
  // 署名を生成してSwitchBot Plug Miniのステータスを取得
  const { sign, t, nonce } = await generateSignature(token, secret);
  const res = await fetchFromSwitchBotPlugMiniStatus(token, deviceId, sign, t, nonce);
  
  // ステータスが正常に取得できた場合
  if (res.statusCode == 100) {
    // ワット数を計算(電圧 * 電流(A←mA/1000
    const wat = res.body.voltage * (res.body.electricCurrent / 1000); 
    // 現在の洗濯機の状態をKVから取得
    const current_status = await env.tana_p_washer_status.get("status");
    
    // 洗濯機の状態が変化した場合、KVを更新してDiscordに通知
    if (current_status === "0" && wat > 0) {
      await Promise.all([
        sendDiscordNotification(discordWebhookUrl, "ゴシゴシはじめますわ〜！"),
        env.tana_p_washer_status.put("status", "1"),
      ]);
    } else if (current_status === "1" && wat < 1) {
      await Promise.all([
        sendDiscordNotification(discordWebhookUrl, "早く干してくださいませ〜！"),
        env.tana_p_washer_status.put("status", "0"),
      ]);
    }
  };
};

export default {
  fetch: app.fetch,
  scheduled,
};
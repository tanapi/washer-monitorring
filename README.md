# Washer Monitoring Worker

このプロジェクトは、Cloudflare Workers 上で動作する洗濯機監視サービスです。SwitchBot Plug Mini から洗濯機の稼働状況を取得し、状態変化を Discord に通知します。

## 構成ファイル

- `wrangler.jsonc`  
  Cloudflare Workers の設定ファイル。KV バインディングや環境変数などを記述します。

## コード例

`Hono` のインスタンス化時にバインディング型を指定します。

```ts
// src/index.ts
const app = new Hono<{ Bindings: EnvWithKV }>();
```

## 主な機能

- SwitchBot API から洗濯機の状態を取得
- 状態変化時に Discord Webhook へ通知
- 洗濯機の状態を KV に保存
- cron トリガーによる定期監視

## 注意事項

- 機密情報（API トークン等）は wrangler の secrets 機能や vars で管理してください。
- KV や Webhook URL などは `wrangler.jsonc` で設定します。

---

詳しくは [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/) を参照してください。
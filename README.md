# Washer Monitoring Worker

このプロジェクトは、Cloudflare Workers 上で動作する洗濯機監視サービスです。SwitchBot Plug Mini から洗濯機の稼働状況を取得し、状態変化を Discord に通知します。

## 構成

- `CF_Workers` フォルダ
  Cloudflare Workersのソース
  - `wrangler.jsonc`  
    Cloudflare Workers の設定ファイル。KV バインディングや環境変数などを記述します。
- `lambda` フォルダ
  AWS lambda URLsのソース

## デプロイ

- Cloudflare Workers
  `wrangler.jsonc` に正しい設定値を保存後、`CF_Workers` フォルダ上で下記コマンドを実行してください。

```shell
npx wrangler deploy
```

- AWS lambda URLs
  AWSマネジメントコンソールから手動で設置してください。
  (その際、lambdaの環境変数 **SECRET_TOKEN** に認証用のシークレット値を設定してください)

## 主な機能

- SwitchBot API から洗濯機の状態を取得
- 状態変化時に AWS lambda URLs の Webhook Proxy経由で Discord Webhook へ通知
  - AWS lambda URLs 経由なのは Discord のレートリミット回避のため
- 洗濯機の状態を KV に保存
- cron トリガーによる定期監視

## 注意事項

- 認証情報は **Cloudflare Secrets Store** に格納してください。
  - **SWITCH_BOT_TOKEN** : SwitchBot APIのトークン
  - **SWITCH_BOT_SECRET** : SwitchBot APIのシークレット
  - **WEBHOOK_PROXY_SECRET** : lambdaの環境変数 **SECRET_TOKEN** に設定した値

- `wrangler.jsonc` での環境変数の設定
  - KVのバインディング情報
  - DiscordのWebhook URL
  - AWS lambda URLs の公開URL(Webhook Proxy)
  - SwitchBot Plug Mini のデバイスID
  - 稼働状態とみなすワット数

---

詳しくは [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/) を参照してください。
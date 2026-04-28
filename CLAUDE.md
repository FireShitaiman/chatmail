# Chatmail

Gmail をチャット UI（LINE/WhatsApp 風）で操作できるローカル Electron アプリ。

## 起動

```
npm start
```

`start.js` が `ELECTRON_RUN_AS_NODE` を削除してから Electron を起動する。  
Claude Code 環境ではこの環境変数が設定されているため、直接 `electron .` は使わない。

## 構成

| ファイル | 役割 |
|---|---|
| `main.js` | Electron メインプロセス。Gmail API、OAuth2、IPC ハンドラー |
| `preload.js` | `window.electronAPI` を contextBridge で公開 |
| `index.html` | UI 全体（チャット表示、作成、設定モーダル） |
| `start.js` | npm start 用ラッパー（ELECTRON_RUN_AS_NODE 削除） |

## Gmail API セットアップ（ユーザー向け）

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) でプロジェクト作成
2. Gmail API を有効化
3. OAuth クライアント ID を **「デスクトップアプリ」** タイプで作成
4. リダイレクト URI に `http://localhost:3000/oauth/callback` を追加
5. アプリ設定（⚙）に Client ID / Client Secret を入力 → 「Gmail に接続」

認証情報・トークンは `{userData}/chatmail-config.json` に保存される。

## IPC チャネル（main ↔ renderer）

| チャネル | 内容 |
|---|---|
| `gmail:get-config` | 認証状態・clientId を返す |
| `gmail:save-config` | clientId / clientSecret を保存 |
| `gmail:authenticate` | OAuth2 フロー開始（ブラウザ → port 3000 コールバック） |
| `gmail:signout` | トークン削除 |
| `gmail:fetch-threads` | 受信トレイ上位 20 スレッドを取得 |
| `gmail:fetch-messages` | スレッドの全メッセージを取得 |
| `gmail:send` | メール送信（スレッド返信） |
| `open-external` | ブラウザで URL を開く |

## ローカルストレージ（renderer）

| キー | 内容 |
|---|---|
| `chatmail_signature` | 全メール共通署名 |
| `chatmail_greetings` | 相手 email をキーとした冒頭文 JSON |
| `chatmail_apikey` | Claude API キー |

## ビジネス方針

- シンプルさとプライバシーが差別化軸。機能を増やしすぎない。
- Electron アプリとして配布（ローカル動作）
- GumroadまたはLemonSqueezyで販売
- Claude API キーはユーザー持ち込み（BYOK）

## 次のステップ

- 実機テスト（Gmail OAuth フローの動作確認）
- 送信後のスレッド再読み込み
- electron-builder でインストーラー作成

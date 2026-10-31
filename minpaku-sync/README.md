# minpaku-sync — 民泊予約の一括管理（ダブルブッキング防止）

Airbnb・Booking.com・Agoda の予約カレンダーを iCal で1つにまとめ、各サイトに「他サイトで埋まっている日」を自動で伝えるアプリです。
Cloudflare Workers（無料プラン）で動き、スマホのブラウザから管理画面を見られます。

## 仕組み

```
Airbnb ─┐                                 ┌─▶ Airbnb には Booking.com + Agoda + 手動ブロック
Booking ─┼─(10分ごとに取得)─▶ minpaku-sync ─┼─▶ Booking.com には Airbnb + Agoda + 手動ブロック
Agoda ──┘                                 └─▶ Agoda には Airbnb + Booking.com + 手動ブロック
```

- 予約サイトのカレンダーが取得できなかったときは、**前回の予約を保持**します（日付が空いてしまわないように）
- 日程が重なる予約を見つけると、画面に赤い警告を出します。設定すればスマホにプッシュ通知も届きます
- 各サイトに送るのは「予約不可」の情報だけで、ゲスト名などは送りません

### 知っておいてほしい制約
- **各予約サイトが iCal を読み込むタイミングは、サイト側が決めます**（数十分〜数時間おき）。そのため、ほぼ同時に2つのサイトで予約が入るとダブルブッキングは起こりえます。その場合はすぐ気づけるよう、警告と通知を出す仕組みにしています
- iCal ではゲスト名・人数・金額は取得できません
- Agoda の iCal 連携は物件の種類（Agoda Homes など）によって使えない場合があります。管理画面（YCS）で確認してください

## セットアップ（PC で1回だけ・約15分）

必要なもの：Node.js 20以上、無料の Cloudflare アカウント

```bash
cd minpaku-sync
npm install
npx wrangler login                       # ブラウザで Cloudflare にログイン
npx wrangler kv namespace create STORE   # 表示された id を wrangler.toml の REPLACE_WITH_KV_NAMESPACE_ID と置き換える

# 管理画面のパスワード
npx wrangler secret put ADMIN_PASSWORD
# 書き出しURL用の推測されにくい文字列（例: `openssl rand -hex 16` の出力）
npx wrangler secret put EXPORT_TOKEN

# 各予約サイトの「カレンダーをエクスポート」で表示される iCal URL（まだ無いサイトは後から追加でOK）
npx wrangler secret put ICAL_AIRBNB
npx wrangler secret put ICAL_BOOKING
npx wrangler secret put ICAL_AGODA

npx wrangler deploy
```

デプロイすると `https://minpaku-sync.<あなたのサブドメイン>.workers.dev` が表示されます。スマホで開いてパスワードを入力してください（ユーザー名は何でもOK）。ホーム画面に追加しておくとアプリのように使えます。

### 予約サイト側の設定

管理画面の一番下「予約サイトの設定」にサイトごとの URL があります。それぞれのサイトの**カレンダーインポート**に登録してください。

| サイト | エクスポート（ICAL_* に設定） / インポート（管理画面の URL を登録） |
|---|---|
| Airbnb | リスティング → カレンダー → 空室状況 → 「カレンダーを接続」 |
| Booking.com | エクストラネット → 料金・空室状況 → 「カレンダーを同期」 |
| Agoda | YCS → カレンダー → iCal 連携 |

※ メニュー名は変わることがあります。

### スマホ通知（任意）
1. スマホに無料アプリ [ntfy](https://ntfy.sh/) を入れ、推測されにくい名前のトピック（例: `minpaku-8f3k2x9q`）を購読します
2. `npx wrangler secret put NTFY_TOPIC` で同じ名前を設定します

日程が重なる予約を見つけると、すぐにプッシュ通知が届きます。

## 開発

```bash
npm test        # テスト
npm run dev     # ローカル実行（.dev.vars に上記の値を書く）
```

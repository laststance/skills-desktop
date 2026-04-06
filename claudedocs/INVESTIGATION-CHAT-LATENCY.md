# Skills Desktop チャット遅延 調査レポート

**日付:** 2026-04-02
**対象:** Skills Assistant（右パネルのAIチャット機能）
**症状:** 質問送信から回答表示まで60秒以上かかる

---

## 📊 アーキテクチャ概要

```
[ChatInput] → IPC → [chatHandler.ts (main)] → claude-agent-sdk query() → IPC stream → [Redux → UI]
```

- **SDK:** `@anthropic-ai/claude-agent-sdk` v0.2.87
- **呼び出し方法:** `query()` の AsyncIterable（ストリーミング）
- **IPC:** `chat:chunk` イベントでレンダラーに逐次送信
- **UI更新:** Redux `appendTextDelta` でリアルタイム表示

---

## 🔍 遅延の原因分析

### 1. 🐌 Claude Code サブプロセス起動コスト（主要因）

`query()` は内部で **Claude Code CLI をサブプロセスとして起動** する。これが最大のボトルネック。

```typescript
// chatHandler.ts L38-47
const stream = query({
  prompt: params.message,
  options: {
    cwd,
    systemPrompt,
    pathToClaudeCodeExecutable: claudeInfo.path, // ← CLIバイナリのパス
    abortController,
    permissionMode: 'default',
  },
})
```

**起動時に発生すること:**

- Claude Code の Node.js プロセス立ち上げ
- 設定ファイル読み込み（`.claude/`, CLAUDE.md 等）
- Anthropic API への認証・接続確立
- システムプロンプトの送信

OpenClawも同じSDKを使っているが、OpenClawは**常駐プロセス（デーモン）** として動いているため起動コストがない。Skills Desktopは**毎回新しいプロセスを起動** している。

### 2. 📝 システムプロンプトの肥大化（副要因）

```typescript
// chatHelpers.ts - buildSystemPrompt()
const skillList = skillContext
  .map((s) => `- **${s.name}**: ${s.description}`)
  .join('\n')
```

61個のスキル × (名前 + description) が毎回システムプロンプトに含まれる。
さらに `activeSkillContent`（選択中スキルの SKILL.md 全文）も追加。

→ 入力トークン数が多く、APIのFirst Token Latency (TTFT) が増大。

### 3. 🔄 `transformMessage` のフィルタリング

```typescript
// chatHelpers.ts - transformMessage()
case 'assistant': {
  const assistantMsg = msg.message as Record<string, unknown> | undefined
  if (assistantMsg?.content && Array.isArray(assistantMsg.content)) {
    for (const block of assistantMsg.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        return { type: 'text-delta', delta: block.text }
      }
    }
  }
  return null  // ← thinking等のブロックは捨てられる
}
```

SDK は `assistant` メッセージを**テキストブロック単位**で送ってくる。`text-delta` ではなく完成した `text` ブロック単位なので、ストリーミング感が薄い。

**比較:** OpenClawのsubscription modeでは `content_block_delta` イベントで**文字単位**のストリーミングが可能。

### 4. ⏱️ `permissionMode: 'default'` の影響

```typescript
permissionMode: 'default'
```

デフォルトモードでは、ツール呼び出し時にパーミッション確認が入る可能性がある。
チャット機能ではツール実行は不要なので、`permissionMode: 'plan'`（読み取り専用）にすべき。

---

## 💡 改善提案（優先度順）

### A. Anthropic API 直接呼び出しに切り替える（最も効果大）

Claude Code CLIを経由せず、`@anthropic-ai/sdk` で直接 Messages API を呼ぶ。

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()
const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  system: systemPrompt,
  messages: [{ role: 'user', content: message }],
})

for await (const event of stream) {
  if (event.type === 'content_block_delta') {
    sendChatChunk({ type: 'text-delta', delta: event.delta.text })
  }
}
```

**メリット:**

- サブプロセス起動コスト **ゼロ**
- 文字単位のリアルタイムストリーミング
- TTFT が体感 1-3 秒に改善
- APIキー管理は必要になるが、Electron の `safeStorage` で暗号化保存可能

**デメリット:**

- Claude Code CLI の依存が不要になる（=シンプルになるが、ツール実行機能は使えない）
- APIキーの管理UIが必要

### B. claude-agent-sdk の subscription mode を使う（中程度の効果）

現在の `query()` ではなく、subscription パターンで接続を使い回す。

```typescript
import { ClaudeCodeSession } from '@anthropic-ai/claude-agent-sdk'

// アプリ起動時に1回だけセッション確立
const session = new ClaudeCodeSession({
  pathToClaudeCodeExecutable: claudeInfo.path,
})

// 各チャットメッセージは既存セッションに送信
const stream = session.query({ prompt: message, systemPrompt })
```

**メリット:**

- 2回目以降のメッセージは起動コストなし
- 会話コンテキストを維持できる

**デメリット:**

- SDK のバージョンやAPIの安定性に依存
- セッション管理（タイムアウト、再接続）が必要

### C. システムプロンプトの最適化（簡単・即効）

```typescript
// 全スキルのdescriptionを送る代わりに、名前のみリスト化
const skillList = skillContext.map((s) => s.name).join(', ')

// activeSkillContent は要約 or 最初の500文字に制限
const truncated = activeSkillContent?.slice(0, 500) ?? null
```

**効果:** 入力トークン数削減 → TTFT 改善（数秒〜10秒程度）

### D. permissionMode を 'plan' に変更（簡単）

```typescript
permissionMode: 'plan' // ツール実行を許可しない
```

ツール呼び出しのオーバーヘッドがなくなる。

---

## 🎯 推奨アクション

| 優先度 | 施策                  | 工数        | 効果                 |
| ------ | --------------------- | ----------- | -------------------- |
| ★★★    | A. API直接呼び出し    | 中（1-2日） | TTFT 1-3秒に         |
| ★★☆    | C. プロンプト最適化   | 小（30分）  | TTFT 5-10秒改善      |
| ★★☆    | D. permissionMode変更 | 小（5分）   | ツール関連の遅延排除 |
| ★☆☆    | B. subscription mode  | 中（1日）   | 2回目以降高速化      |

**現実的なロードマップ:**

1. まずは C + D を即適用（今日できる）
2. チャット機能復活時に A を実装（API直接呼び出し）
3. 将来的に会話コンテキスト維持が必要なら B を検討

---

## 📁 関連ファイル

- `src/main/chat/chatHandler.ts` — メインのチャットロジック
- `src/main/chat/chatHelpers.ts` — プロンプト生成 & メッセージ変換
- `src/main/chat/claudeDetector.ts` — Claude Code 検出
- `src/shared/chat-types.ts` — 型定義
- `src/renderer/src/redux/slices/chatSlice.ts` — Redux状態管理
- `src/renderer/src/components/chat/ChatPanel.tsx` — UIコンポーネント

---

_調査: Clawdbot 🤖 | 2026-04-02_

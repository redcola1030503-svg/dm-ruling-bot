# T013: 無償版のバナー広告を常時表示に変更し、表示位置を質問入力欄の直後へ移動

Status: 実装済み・Codexコードレビュー7回実施済み(全指摘反映済み、Review 7で「重大な問題なし」)。未確定事項はユーザー判断済み・反映済み。残るは実機/エミュレータでの視覚確認のみ

## Goal

ユーザーからの要望: 無償版(非購読ユーザー)の場合、バナー広告を常に表示するように変更する。表示位置は、質問入力欄の補助テキスト「長押しでカード名を入力」と「質問する」ボタンの間にする。

## 現状の実装(コード確認済み)

- `mobile_app/lib/widgets/loading_banner_ad.dart`の`LoadingBannerAd`ウィジェットは、`initState()`で広告を読み込み、`build()`では購読中(`SubscriptionProvider.isSubscribed`)なら`SizedBox.shrink()`(非表示)を返す設計。**ウィジェット自体は「常時表示」に対応できる作りだが、呼び出し側が限定的な場面でしかツリーに含めていない。**
- 実際に`LoadingBannerAd()`が配置されているのは以下の2箇所のみで、いずれも**裁定生成が処理中(`!job.isFinished`)の間だけ**表示される設計になっている:
  - `mobile_app/lib/screens/ruling_screen.dart:295`(新規質問画面、処理中のインジケーターの下)
  - `mobile_app/lib/widgets/ruling_turn_view.dart:39`(スレッド内の各ターン表示、同様に処理中の間のみ)
- 質問入力欄そのものは`ruling_screen.dart:225-236`(`InlineCardSuggestField`、`helperText: '長押しでカード名を入力'`)、その直後(`SizedBox(height: 12)`を挟んで)に`質問する`ボタン(`ruling_screen.dart:238-258`)がある。**ユーザーが指定した挿入位置はこの2つの間(`ruling_screen.dart:236`と`238`の間)。**
- なお、同じUIパターン(`長押しでカード名を入力`という補助テキスト)は`ruling_thread_detail_screen.dart:194-222`(スレッド内の追加質問欄)にも存在するが、ボタン文言は「質問する」ではなく「送信」であり、ユーザーの指定(「質問する」と長押しヒントの間)には直接該当しない。同じ変更をここにも適用するかは別途確認が必要(下記「未確定事項」参照)。

## 対応方針(ドラフト、未確定)

1. `ruling_screen.dart`の質問入力欄(`InlineCardSuggestField`、236行目付近)と「質問する」ボタン(238行目)の間に`LoadingBannerAd()`を追加し、常に(処理中かどうかに関わらず)表示されるようにする。
2. 現在「処理中のみ表示」している2箇所(`ruling_screen.dart:295`、`ruling_turn_view.dart:39`)の扱いを検討する: (a)そのまま残し画面内に広告が2箇所同時に表示されうる状態にするか、(b)常時表示化した分を残し処理中専用の表示は削除するか。ユーザーの意図(「常に表示に変更」)からは(b)が自然と考えられるが、要確認。
3. `LoadingBannerAd`というクラス名は「読み込み中に表示する広告」を意味しており、常時表示に用途が変わる場合はクラス名・コメントの見直しも検討する(実質的な問題ではないが命名の正確性のため)。

## 判断・実装内容(2026-09-04、ユーザー「進めて」指示に基づきAuto Modeで判断)

調査の結果、`RulingTurnView`(`ruling_turn_view.dart`の`LoadingBannerAd`)は`ruling_screen.dart`だけでなく`RulingJobDetailScreen`(履歴からの単発ジョブ詳細画面、入力欄が無く代替の広告掲載場所が無い)からも共用されていると判明した。この画面から広告表示機会を奪わないよう、変更範囲を**ユーザーが明示的に指定した`ruling_screen.dart`のみ**に限定した。

- `ruling_screen.dart`: 質問入力欄(236行目)と「質問する」ボタン(238行目)の間に`LoadingBannerAd()`を追加(常時表示、購読中は`LoadingBannerAd`自身が非表示にする)
- 同一画面内での二重表示を避けるため、`ruling_screen.dart`内にあった「処理中のみ表示」の`LoadingBannerAd()`(297行目)は削除した(同じ画面に広告が2つ同時に出るのを防止する判断)
- `ruling_turn_view.dart`(`RulingJobDetailScreen`・`RulingThreadDetailScreen`で共用)、および`ruling_thread_detail_screen.dart`の追加質問欄(ボタン文言「送信」、ユーザー指定の「質問する」とは文言が異なる)は、今回のスコープ外として**変更していない**

検証: `flutter analyze` 0 issues。

## 未確定・要検討事項(2026-09-05、ユーザー確認済み)

- `ruling_thread_detail_screen.dart`(スレッド内追加質問、ボタン文言「送信」)にも同様の常時表示化を適用するか → **ユーザー判断「はい、同様に適用する」**。実装完了(下記「追加実装」参照)
- `RulingJobDetailScreen`(`ruling_turn_view.dart`経由)にも常時表示の広告を追加するか(現状は処理中のみ表示のまま) → **ユーザー判断「いいえ、現状のまま(処理中のみ表示)」**。変更なし
- T012(Batch API全廃)実施後は裁定生成が数十秒〜数分で完了する見込みのため、「処理中のみ表示」だった従来設計では表示時間がさらに短くなり広告収益への影響が大きかった可能性がある(常時表示化の動機の一つと推測されるが、ユーザーへの確認はしていない、対応不要)

## 追加実装(2026-09-05、ユーザー確認への回答を反映)

- `ruling_thread_detail_screen.dart`: 追加質問欄(`InlineCardSuggestField`)と「送信」ボタンの間に`LoadingBannerAd()`を追加(常時表示)。
- `ruling_turn_view.dart`(`RulingTurnView`、`RulingThreadDetailScreen`・`RulingJobDetailScreen`で共用): 処理中広告(`!job.isFinished`時の`LoadingBannerAd()`)の表示可否を制御する`showLoadingBannerAd`プロパティ(既定`true`)を追加。`RulingThreadDetailScreen`は追加質問欄の下に常時広告を別途持つため、二重表示を避けるためこの画面からの呼び出しでは`showLoadingBannerAd: false`を指定。`RulingJobDetailScreen`は既定の`true`のまま変更なし(ユーザー判断により他に広告が無いこの画面の表示機会を維持)。
- `loading_banner_ad.dart`: Review 4のP2指摘(購読へ切り替わった際、`BannerAd`インスタンスがdisposeされないままリソースが解放されない不備)に対応。`didChangeDependencies()`をオーバーライドし、購読状態が変わるたびに購読中と判明していれば保持中の広告をdisposeするよう修正。

**検証**: `flutter analyze` 0 issues。

### Review 5 — 2026-09-05(追加実装へのコードレビュー、Codex)

P0なし。P1 1件・P2 1件を検出・反映済み。

- P1: `didChangeDependencies()`が購読開始時に`_bannerAd`をdisposeするだけで、その後非購読へ戻った場合(購読期限切れ・アカウント切替等)の再読み込み処理が無く、「無償版では常時表示」を満たせなくなる → 購読中に転じた際`_loadRequested`もfalseへリセットし、次回`build()`で`_maybeLoadAd`が再度広告を読み込めるようにした。あわせて、リセット後の再読み込みで「前のリクエストの非同期コールバックが後から返ってきて現在の状態を上書きする」競合を避けるため、リクエストごとに`_loadGeneration`(世代番号)を発行し、コールバック側で最新の世代かどうかを確認してから状態を更新するよう修正
- P2: `ruling_thread_detail_screen.dart`で`LoadingBannerAd`の前後に`SizedBox(height: 8)`を配置しており、購読中(広告非表示)でも両方の余白が残り従来の8pxから16pxへ変わってしまう。**同じパターンが`ruling_screen.dart`(元のReview 1〜3の実装)にも存在していた** → `LoadingBannerAd`自体が上下の余白(`verticalMargin`、既定8・`ruling_screen.dart`は12を指定)を内包する設計に変更し、呼び出し側(`ruling_screen.dart`・`ruling_thread_detail_screen.dart`・`ruling_turn_view.dart`)の前後の明示的な`SizedBox`を削除。購読中は`LoadingBannerAd`全体が`SizedBox.shrink()`になるため、完全に0サイズになり間隔の変化が起こらない

**再検証**: `flutter analyze` 0 issues。

### Review 6 — 2026-09-05(Review 5対応後の再レビュー、Codex)

P0なし。P1 2件を検出・反映済み。

- P1: 世代チェック(`_loadGeneration`)を`onAdLoaded`にしか追加しておらず、`onAdFailedToLoad`には無かった。旧世代の失敗コールバックが遅れて到着すると`_loadRequested`を誤って`false`へ戻し、重複リクエストや正常な結果の破棄を招きうる → `onAdFailedToLoad`にも同じ世代チェックを追加し、世代が一致する場合のみ`_loadRequested`を`false`に戻すよう修正(失敗時の再試行を許可する設計に統一)
- P1: `LoadingBannerAd`が余白を内包する設計(Review 5)で、購読中は単純に高さ0(`SizedBox.shrink()`)へ倒していたが、呼び出し元が元々持っていた`SizedBox`は「広告のための余白」だけでなく「フォームの入力欄とボタンの最低限の間隔」も兼ねていた。購読中に間隔まで消えてしまい、入力欄とボタンが密着してしまう不備 → `collapsedHeight`パラメータを追加し、広告非表示時に維持する高さを呼び出し側で指定できるようにした(`ruling_screen.dart`は`collapsedHeight: 12`、`ruling_thread_detail_screen.dart`は`collapsedHeight: 8`。`ruling_turn_view.dart`はフォーム間隔ではなく「処理中テキストの後に続く広告」という位置づけのため既定値0のまま)

**再検証**: `flutter analyze` 0 issues。

## Acceptance Criteria(現段階)

- [x] 実装に着手する(`flutter analyze`) → **2026-09-04、`flutter analyze`はPASS**
- [x] AGENTS.mdの運用に従いCodexへ実装のコードレビューを依頼する → **2026-09-04〜05、7回実施・全指摘反映済み、Review 7で「重大な問題なし」(下記Review History参照)**
- [x] 上記「未確定・要検討事項」への対応要否をユーザーへ確認する → **完了、上記「追加実装」参照**
- [x] 実機/エミュレータでの視覚確認 → **2026-09-05完了(下記「実機確認結果」参照)**

## 実機確認結果(2026-09-05、Androidエミュレータ`emulator-5554`)

- `ruling_screen.dart`: 質問送信前(処理中でない状態)でも、質問入力欄と「質問する」ボタンの間に常時テスト広告が表示されることを確認。レイアウト崩れ無し
- `ruling_thread_detail_screen.dart`: 実際に質問を送信しスレッド詳細画面へ遷移した上で、追加質問欄(「追加で質問する」)と「送信」ボタンの間に常時テスト広告が表示されることを確認。レイアウト崩れ無し
- 購読中の表示(広告が消え`collapsedHeight`分の間隔のみ残ること)は、このエミュレータ(Google Play非対応システムイメージ)ではRevenueCatの`Billing is not available in this device`エラーにより購読状態を作れず、視覚的な確認はできなかった(既知の制約、過去のセッションでも同様の記録あり)。ロジック自体はCodexレビュー(Review 5〜7)で確認済み
- ビルド時の留意点: `JAVA_HOME`が未設定だと`assembleDebug`が失敗する(`Android Studio`同梱の`jbr`ディレクトリを指定する必要がある)。また、既存インストール済みアプリと署名が異なる場合`INSTALL_FAILED_UPDATE_INCOMPATIBLE`が発生するが、`flutter run`が自動的にアンインストール後に再インストールする

## Implementation Owner

Claude Code(2026-09-04、ユーザー「進めて」指示によりAuto Modeで判断・実装)

## Reviewer

Codex

## Review History

### Review 1 — 2026-09-04(実装直後、`ruling_screen.dart`・`loading_banner_ad.dart`・`subscription_provider.dart`の差分レビュー)

P0なし。P1 2件を検出・反映済み。

- P1: 購読状態が未確定のまま`LoadingBannerAd`が広告を読み込んでおり、購読者にも起動直後に一瞬広告が表示されうる → `SubscriptionProvider`に`isStatusKnown`ゲッターを追加し、`checkEntitlement()`完了(確定)まで広告読み込みをスキップするよう修正
- P1: 広告の非同期な出現・消失でボタン位置がずれ、意図しないタップを誘発しうる → 広告読み込み前後で常にAdSize.banner分の高さを確保する`SizedBox`でラップするよう修正

**検証**: `flutter analyze` 0 issues。

### Review 2 — 2026-09-04(T014のP1修正差分レビューに同梱。他の未コミット差分と共に埋め込まれ、本タスクの差分についても追加指摘を受けた)

- P1: `checkEntitlement()`が`Purchases.getCustomerInfo()`の例外を捕捉しておらず、RevenueCat側の一時障害等で問い合わせに失敗すると`isStatusKnown`が`true`にならないまま残り、`LoadingBannerAd`がそのセッション中ずっと広告を読み込まなくなる(「無償版は常時表示」の要件をRevenueCatの一時障害だけで恒久的に満たせなくなる) → `checkEntitlement()`にtry/catchを追加し、問い合わせ失敗時も`isStatusKnown`をtrueにして未購読(広告表示)側へフォールバックするよう修正(`subscription_provider.dart`)。`!_configured`の早期returnパスも同様に`isStatusKnown`を確定させるよう修正
- P2: `LoadingBannerAd`のドキュメントコメントが「広告読み込み前後でレイアウトが変わらないよう常に領域を確保する」と無条件に書かれていたが、実際には購読中と判明すると`SizedBox.shrink()`になりレイアウトが変わる → コメントを「非購読/未確定の間のみレイアウト不変」と正確化(購読開始・復元でのレイアウト変化自体は許容する設計であることを明記)

**検証**: `npm run typecheck`・`npm test`(45ファイル/280テスト、本タスク無関係のバックエンド全体)PASS、`flutter analyze` 0 issues。実機/エミュレータでの視覚確認は今回も未実施。

### Review 3 — 2026-09-04(Review 2の修正自体に対する再レビュー、`subscription_provider.dart`)

- P1: Review 2の修正(問い合わせ失敗時に無条件で`_isSubscribed = false`へフォールバック)が新たな不具合を招いていた: 既に一度「購読中」と確定済みのユーザーでも、RevenueCatの一時的な問い合わせ失敗が起きるたびに`_isSubscribed`が`false`へ上書きされ、有料特典であるはずの「広告非表示」が一時的に崩れてしまう → `_hasConfirmedOnce`フラグを追加し、**一度も確定したことが無い場合のみ**未購読側へフォールバックし、既に一度でも確定済みの場合は問い合わせ失敗時も直前の確定値をそのまま維持するよう修正

**検証**: `flutter analyze` 0 issues。`SubscriptionProvider`単体のFlutterテストは未整備(RevenueCat SDKのモックが必要でプロジェクトに前例が無いため今回は追加せず、既知のギャップとして残す)。

### Review 4 — 2026-09-04(T012 worker_id/heartbeatリース実装レビューに同梱、T013自体への指摘ではないが記録)

T012の差分レビュー時、他の未コミット差分と共に埋め込まれていた本タスクの`loading_banner_ad.dart`についても指摘を受けた。**対応は次回以降に持ち越し**(未実装、実装は本タスクのスコープ外)。

- P2: `mobile_app/lib/widgets/loading_banner_ad.dart` — 購読へ切り替わった際、`isSubscribed`なら`SizedBox.shrink()`を返すだけで既存の`_bannerAd`をdisposeしていない。画面を開いたまま購入・復元した場合、非表示になっても`BannerAd`インスタンスを保持し続け、広告SDK側のリソースが解放されない可能性がある。修正案: 非購読→購読への遷移時に既存`BannerAd`をdisposeして参照を消すライフサイクル処理を追加する。

# サブスクリプション課金(モバイルアプリ) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RevenueCat SDKを使い、無料枠(月10問)超過時にペイウォールを表示し、月額300円のサブスクリプション購入・復元ができるようにする。

**Architecture:** 既存の`DeviceIdProvider`(`lib/push/device_id.dart`、flutter_secure_storageで永続化済み)のdeviceIdをそのままRevenueCatの`appUserId`として使う。`ApiClient`にバックエンドの`/api/ruling/usage`・`/api/billing/sync`呼び出しを追加し、質問投稿が402(`subscription_required`)を返した場合にペイウォール画面へ遷移する。

**Tech Stack:** Flutter/Dart、`purchases_flutter`(RevenueCat SDK、新規追加)、既存の`provider`パッケージ

**Spec:** `docs/superpowers/specs/2026-08-30-subscription-monetization-design.md`(バックエンド側は`docs/superpowers/plans/2026-08-30-subscription-backend.md`で実装済みであること前提)

## Global Constraints

- 既存の`DeviceIdProvider`(`lib/push/device_id.dart`)は変更しない。deviceIdはこれをそのまま流用する
- `test/widget_test.dart`の起動スモークテストを壊さないこと。RevenueCat SDKの初期化は起動時の`pumpAndSettle`をブロックしないよう非同期・非ブロッキングで行う
- 価格・エンタイトルメントID等の商品設定はRevenueCat/App Store Connect/Google Play Console側で事前に作成されている前提とする(本プランはアプリ側の実装のみを対象とする)
- 既存の日本語コメント規約に従う

---

### Task 1: RevenueCat SDKの追加

**Files:**
- Modify: `pubspec.yaml`

**Interfaces:**
- Produces: なし(依存追加のみ)

- [ ] **Step 1: パッケージを追加**

Run: `cd mobile_app && flutter pub add purchases_flutter`

(バージョンを手動指定せず`pub add`で解決させることで、実装時点の最新安定版が自動的に`pubspec.yaml`に反映される)

- [ ] **Step 2: 依存解決を確認**

Run: `flutter pub get`
Expected: エラーなく完了

- [ ] **Step 3: コミット**

```bash
git add mobile_app/pubspec.yaml mobile_app/pubspec.lock
git commit -m "RevenueCat SDK(purchases_flutter)を追加"
```

---

### Task 2: RevenueCat公開SDKキーの管理

**Files:**
- Create: `mobile_app/lib/billing/revenue_cat_keys.dart`

**Interfaces:**
- Produces: `RevenueCatKeys.publicSdkKey`(String getter)

RevenueCatの「Public SDK Key」はクライアントアプリに埋め込む前提の公開鍵(Stripeのpublishable keyと同種)であり、既存の`lib/ads/ad_unit_ids.dart`と同じ「プラットフォーム別に直接コードへ記述する」方式に揃える。バックエンドで使う`REVENUECAT_API_KEY`(Secret API Key)とは別物であり混同しないこと。

- [ ] **Step 1: `lib/billing/revenue_cat_keys.dart`を新規作成**

```dart
import 'dart:io';

/// RevenueCatのPublic SDK Key(クライアント埋め込み前提の公開鍵)。
/// RevenueCatダッシュボード(Project settings > API keys)で
/// Android/iOSそれぞれのアプリを登録すると発行される。
///
/// 以下はRevenueCatプロジェクト作成前のプレースホルダー。実装時に
/// RevenueCatダッシュボードで実際の値に置き換えること。
class RevenueCatKeys {
  static String get publicSdkKey {
    if (Platform.isAndroid) return 'goog_REPLACE_WITH_ANDROID_PUBLIC_SDK_KEY';
    if (Platform.isIOS) return 'appl_REPLACE_WITH_IOS_PUBLIC_SDK_KEY';
    throw UnsupportedError('RevenueCatはAndroid/iOS以外では利用できません。');
  }
}
```

- [ ] **Step 2: コミット**

```bash
git add mobile_app/lib/billing/revenue_cat_keys.dart
git commit -m "RevenueCat公開SDKキーの管理用クラスを追加(要ダッシュボード連携)"
```

---

### Task 3: SubscriptionProviderの実装

**Files:**
- Create: `mobile_app/lib/billing/subscription_provider.dart`

**Interfaces:**
- Consumes: `RevenueCatKeys.publicSdkKey`(Task 2)
- Produces: `SubscriptionProvider`(`ChangeNotifier`)。`Future<void> initialize(String appUserId)`、`Future<bool> checkEntitlement()`、`Future<void> purchase()`(成功時は例外を投げない、失敗時は例外を投げる)、`Future<bool> restorePurchases()`

このタスクにはこのコードベースの既存慣行に合わせ自動テストを追加しない(`lib/state/settings_provider.dart`等、`flutter_secure_storage`やプラットフォームチャンネルに依存する既存のProviderクラスにも単体テストが無く、実機での動作確認が実質的なテスト方法になっている)。Step 4で実機確認する。

- [ ] **Step 1: `lib/billing/subscription_provider.dart`を新規作成**

```dart
import 'package:flutter/foundation.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import 'revenue_cat_keys.dart';

/// エンタイトルメントID。RevenueCatダッシュボードで
/// 月額サブスクリプション商品に紐付けて設定する(バックエンドの
/// REVENUECAT_ENTITLEMENT_ID環境変数と同じ値にすること)。
const _entitlementId = 'unlimited_questions';

class SubscriptionProvider extends ChangeNotifier {
  bool _configured = false;
  bool _isSubscribed = false;

  bool get isSubscribed => _isSubscribed;

  /// RevenueCat SDKを初期化する。アプリ起動をブロックしないよう、
  /// 呼び出し元でawaitせずバックグラウンドで実行すること。
  Future<void> initialize(String appUserId) async {
    await Purchases.configure(
      PurchasesConfiguration(RevenueCatKeys.publicSdkKey)..appUserID = appUserId,
    );
    _configured = true;
    await checkEntitlement();
  }

  /// サーバーに問い合わせず、RevenueCat SDKのキャッシュ済み顧客情報から
  /// 購読中かどうかを判定する。質問送信前の楽観的なUI表示に使う
  /// (実際のアクセス可否判定は常にバックエンドの/api/ruling/jobsが行う)。
  Future<bool> checkEntitlement() async {
    if (!_configured) return _isSubscribed;
    final customerInfo = await Purchases.getCustomerInfo();
    _isSubscribed = customerInfo.entitlements.active.containsKey(_entitlementId);
    notifyListeners();
    return _isSubscribed;
  }

  /// 商品を購入する。RevenueCatダッシュボードで作成済みの現在のOfferingから
  /// 唯一のパッケージ(単一プランのため)を購入する。オファリングが
  /// 空の場合は例外を投げる。
  Future<void> purchase() async {
    final offerings = await Purchases.getOfferings();
    final current = offerings.current;
    if (current == null || current.availablePackages.isEmpty) {
      throw StateError('購入可能なプランが見つかりませんでした。');
    }
    await Purchases.purchasePackage(current.availablePackages.first);
    await checkEntitlement();
  }

  /// 購入の復元(再インストール後・機種変更時)。復元後の購読有無を返す。
  Future<bool> restorePurchases() async {
    await Purchases.restorePurchases();
    return checkEntitlement();
  }
}
```

- [ ] **Step 2: `main.dart`でRevenueCatを初期化(非ブロッキング)**

`lib/main.dart`のimportに追記:

```dart
import 'billing/subscription_provider.dart';
import 'push/device_id.dart';
```

`_MyAppState`に`SubscriptionProvider`のフィールドを追加し、`initState()`内で非同期・非ブロッキングに初期化する:

```dart
  late final SubscriptionProvider _subscriptionProvider;
```

`initState()`内、`_rulingJobsProvider.restore();`の下に追記:

```dart
    _subscriptionProvider = SubscriptionProvider();
    // deviceIdの取得を含め非同期処理をawaitせずバックグラウンドで実行する。
    // ここでawaitすると起動時のUI表示(test/widget_test.dartのpumpAndSettle)が
    // ブロックされるため、既存のflutter_secure_storage系Providerと同様に
    // 「起動は即座に完了し、購読状態は後から反映される」設計にする。
    DeviceIdProvider().getOrCreate().then(_subscriptionProvider.initialize);
```

`MultiProvider`の`providers`リストに追記:

```dart
        ChangeNotifierProvider<SubscriptionProvider>.value(
          value: _subscriptionProvider,
        ),
```

- [ ] **Step 3: 型チェック**

Run: `cd mobile_app && flutter analyze`
Expected: エラーなし(警告があれば内容を確認し、既存コードに影響しないことを確認)

- [ ] **Step 4: 既存の起動スモークテストが壊れていないことを確認**

Run: `cd mobile_app && flutter test test/widget_test.dart`
Expected: PASS(RevenueCat初期化は非同期・非ブロッキングのため、SDK未設定のテスト環境でも起動UIの表示は妨げられない)

- [ ] **Step 5: コミット**

```bash
git add mobile_app/lib/billing/subscription_provider.dart mobile_app/lib/main.dart
git commit -m "RevenueCat SDKの初期化とSubscriptionProviderを追加"
```

---

### Task 4: ApiClientに利用状況・同期エンドポイントを追加

**Files:**
- Modify: `mobile_app/lib/api/api_client.dart`

**Interfaces:**
- Produces: `Future<RulingUsage> getRulingUsage(String deviceId)`、`Future<void> syncBilling(String deviceId)`

- [ ] **Step 1: `RulingUsage`モデルを追加**

`lib/api/api_client.dart`冒頭、`RulingJobSubmission`クラスの直後に追記:

```dart
class RulingUsage {
  final int remainingFree;
  final bool subscriptionActive;
  final bool canAskQuestion;

  const RulingUsage({
    required this.remainingFree,
    required this.subscriptionActive,
    required this.canAskQuestion,
  });

  factory RulingUsage.fromJson(Map<String, dynamic> json) => RulingUsage(
    remainingFree: json['remainingFree'] as int,
    subscriptionActive: json['subscriptionActive'] as bool,
    canAskQuestion: json['canAskQuestion'] as bool,
  );
}
```

- [ ] **Step 2: `ApiClient`にメソッドを追加**

`registerPushToken`の直前に追記:

```dart
  Future<RulingUsage> getRulingUsage(String deviceId) async {
    final resp = await _client.get(
      _uri('/api/ruling/usage', {'deviceId': deviceId}),
      headers: _headers(),
    );
    return RulingUsage.fromJson(_handleObject(resp));
  }

  /// 購入直後にRevenueCatの購読状態をバックエンドへ即時反映させる
  /// (Webhook到達までの数秒〜数十秒のタイムラグを埋めるため)。
  Future<void> syncBilling(String deviceId) async {
    final resp = await _client.post(
      _uri('/api/billing/sync'),
      headers: _headers(),
      body: jsonEncode({'deviceId': deviceId}),
    );
    if (resp.statusCode == 204) return;
    _handleObject(resp);
  }
```

- [ ] **Step 3: 型チェック**

Run: `cd mobile_app && flutter analyze`
Expected: エラーなし

- [ ] **Step 4: コミット**

```bash
git add mobile_app/lib/api/api_client.dart
git commit -m "利用状況取得・課金同期APIをApiClientに追加"
```

---

### Task 5: ペイウォール画面

**Files:**
- Create: `mobile_app/lib/screens/paywall_screen.dart`

**Interfaces:**
- Consumes: `SubscriptionProvider`(Task 3)、`ApiClient.syncBilling`(Task 4)
- Produces: `PaywallScreen`ウィジェット。購入成功時に`Navigator.pop(context, true)`で戻る

- [ ] **Step 1: `lib/screens/paywall_screen.dart`を新規作成**

```dart
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../billing/subscription_provider.dart';
import '../push/device_id.dart';

/// 無料枠(月10問)を超えた際に表示するペイウォール画面。
/// 購入・復元のいずれかが成功すると呼び出し元にtrueを返して閉じる。
class PaywallScreen extends StatefulWidget {
  final ApiClient apiClient;

  const PaywallScreen({super.key, required this.apiClient});

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> {
  bool _processing = false;
  String? _error;

  Future<void> _handlePurchase() async {
    setState(() {
      _processing = true;
      _error = null;
    });
    try {
      await context.read<SubscriptionProvider>().purchase();
      final deviceId = await DeviceIdProvider().getOrCreate();
      await widget.apiClient.syncBilling(deviceId);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() => _error = '購入に失敗しました: $e');
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  Future<void> _handleRestore() async {
    setState(() {
      _processing = true;
      _error = null;
    });
    try {
      final restored = await context.read<SubscriptionProvider>().restorePurchases();
      if (restored) {
        final deviceId = await DeviceIdProvider().getOrCreate();
        await widget.apiClient.syncBilling(deviceId);
        if (mounted) Navigator.pop(context, true);
      } else if (mounted) {
        setState(() => _error = '有効な購読が見つかりませんでした。');
      }
    } catch (e) {
      if (mounted) setState(() => _error = '復元に失敗しました: $e');
    } finally {
      if (mounted) setState(() => _processing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('質問し放題プラン')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              '無料枠(月10問)を使い切りました',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            const Text(
              '月額300円で質問し放題になります。\n運営コストを賄うための最小限の価格設定です。',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
            ],
            FilledButton(
              onPressed: _processing ? null : _handlePurchase,
              child: _processing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('月額300円で購読する'),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _processing ? null : _handleRestore,
              child: const Text('購入を復元する'),
            ),
          ],
        ),
      ),
    );
  }
}
```

- [ ] **Step 2: 型チェック**

Run: `cd mobile_app && flutter analyze`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add mobile_app/lib/screens/paywall_screen.dart
git commit -m "ペイウォール画面を追加"
```

---

### Task 6: 質問送信フローへの組み込み(402ハンドリング)

**Files:**
- Modify: `mobile_app/lib/api/api_exception.dart`
- Modify: `mobile_app/lib/screens/ruling_screen.dart`
- Modify: `mobile_app/lib/screens/ruling_thread_detail_screen.dart`

**Interfaces:**
- Consumes: `PaywallScreen`(Task 5)

- [ ] **Step 1: `ApiException`に402判定ヘルパーを追加**

`lib/api/api_exception.dart`の`friendlyMessage`ゲッターの直前に追記:

```dart
  bool get isSubscriptionRequired =>
      statusCode == 402 && message == 'subscription_required';
```

`friendlyMessage`の`switch`文に`case`を追加(`default:`の直前):

```dart
      case 'subscription_required':
        return '無料枠の上限に達しました。';
```

- [ ] **Step 2: `ruling_screen.dart`の`_submit()`を修正**

`lib/screens/ruling_screen.dart`のimportに追記:

```dart
import 'paywall_screen.dart';
```

`_submit()`メソッドの`catch`ブロックを次のように変更:

```dart
    try {
      await context.read<RulingJobsProvider>().submitQuestion(question);
      _questionController.clear();
    } catch (e) {
      if (e is ApiException && e.isSubscriptionRequired) {
        final purchased = await Navigator.push<bool>(
          context,
          MaterialPageRoute(
            builder: (_) => PaywallScreen(apiClient: widget.apiClient),
          ),
        );
        if (purchased == true) {
          // 購読完了後、同じ質問を自動的に再送信する。
          await _submit();
          return;
        }
      } else {
        setState(() {
          _submitError = e is ApiException
              ? e.friendlyMessage
              : '通信エラーが発生しました: $e';
        });
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
```

- [ ] **Step 3: `ruling_thread_detail_screen.dart`の追加質問送信にも同様の処理を追加**

`submitFollowUp`の呼び出し箇所を`grep -n "submitFollowUp" lib/screens/ruling_thread_detail_screen.dart`で特定し、Step 2と同じパターン(`ApiException.isSubscriptionRequired`を見てペイウォールへ遷移し、`purchased == true`なら元の送信処理を再実行)を適用する。既存の`catch`ブロックの構造に合わせて実装すること(ファイル内の既存エラー表示コードを壊さないよう、`if (e is ApiException && e.isSubscriptionRequired) { ... } else { 既存の処理 }`という形にする)。

- [ ] **Step 4: 型チェック**

Run: `cd mobile_app && flutter analyze`
Expected: エラーなし

- [ ] **Step 5: 既存の起動スモークテストを確認**

Run: `cd mobile_app && flutter test test/widget_test.dart`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add mobile_app/lib/api/api_exception.dart mobile_app/lib/screens/ruling_screen.dart mobile_app/lib/screens/ruling_thread_detail_screen.dart
git commit -m "無料枠超過(402)検知時にペイウォールへ誘導し購読後に自動再送信するよう変更"
```

---

### Task 7: 残り無料回数の表示

**Files:**
- Modify: `mobile_app/lib/screens/ruling_screen.dart`

**Interfaces:**
- Consumes: `ApiClient.getRulingUsage`(Task 4)

- [ ] **Step 1: 画面表示時に利用状況を取得**

`_RulingScreenState`に状態を追加:

```dart
  RulingUsage? _usage;
```

`initState()`の`Future.microtask(() => provider.loadThreads());`の下に追記:

```dart
    Future.microtask(() async {
      final deviceId = await context.read<RulingJobsProvider>().deviceIdProvider.getOrCreate();
      try {
        final usage = await widget.apiClient.getRulingUsage(deviceId);
        if (mounted) setState(() => _usage = usage);
      } catch (_) {
        // 取得失敗時は表示を省略する(質問送信自体には影響しない)
      }
    });
```

(`import '../api/api_client.dart';`は既存でimport済みのため`RulingUsage`もそのまま参照できる)

- [ ] **Step 2: 質問入力欄の近くに表示**

質問入力用の`TextField`(または`InlineCardSuggestField`)の直前に追記:

```dart
            if (_usage != null && !_usage!.subscriptionActive)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '今月の残り無料質問回数: ${_usage!.remainingFree}回',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
```

(挿入位置は既存のWidgetツリー構造に合わせて`grep -n "TextField\|InlineCardSuggestField" lib/screens/ruling_screen.dart`で実際の入力欄の位置を確認してから調整すること)

- [ ] **Step 3: 質問送信成功後に利用状況を更新**

`_submit()`内、`_questionController.clear();`の直後に追記:

```dart
      unawaited(
        widget.apiClient.getRulingUsage(await context.read<RulingJobsProvider>().deviceIdProvider.getOrCreate())
            .then((usage) {
          if (mounted) setState(() => _usage = usage);
        }),
      );
```

(`dart:async`の`unawaited`を使うため、ファイル冒頭に`import 'dart:async';`が無ければ追加する)

- [ ] **Step 4: 型チェック・起動テスト確認**

Run: `cd mobile_app && flutter analyze && flutter test test/widget_test.dart`
Expected: どちらもエラーなし

- [ ] **Step 5: コミット**

```bash
git add mobile_app/lib/screens/ruling_screen.dart
git commit -m "質問画面に今月の残り無料回数を表示"
```

---

## 完了後の確認事項(コード外)

- RevenueCatダッシュボードでプロジェクト作成、Android/iOSアプリの登録、月額300円商品・Offering・エンタイトルメント(`unlimited_questions`)の作成
- `lib/billing/revenue_cat_keys.dart`のプレースホルダーを実際のPublic SDK Keyに置き換え
- App Store Connect / Google Play Consoleでのサブスクリプション商品作成(価格300円、自動更新)
- Apple「中小企業向けプログラム」・Google Playの手数料軽減プログラムへの申請
- Android(ライセンステスター)・iOS(Sandboxアカウント)実機での購入・復元・再インストール後の動作確認
- `docs/mobile-app-privacy-policy.html`に、購入データがRevenueCat(第三者)を経由する旨を追記する(仕様書7章の宿題)

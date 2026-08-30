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

import 'package:flutter/foundation.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import 'revenue_cat_keys.dart';

/// エンタイトルメントID。RevenueCatダッシュボードで
/// 月額サブスクリプション商品に紐付けて設定する(バックエンドの
/// REVENUECAT_ENTITLEMENT_ID環境変数と同じ値にすること)。
const _entitlementId = 'unlimited_questions';

/// 初期化に失敗している状態で購入・復元が呼ばれた際に投げるメッセージ。
/// ネイティブSDKの不透明な例外をそのまま見せず、日本語の指示を返す。
const _notConfiguredMessage = 'サブスクリプションの初期化に失敗しています。アプリを再起動してください。';

class SubscriptionProvider extends ChangeNotifier {
  bool _configured = false;
  bool _isSubscribed = false;
  bool _statusKnown = false;
  // checkEntitlement()が一度でも成功したことがあるか。問い合わせ失敗時、
  // 既に確定済みの購読状態を一時的なエラーだけで巻き戻さないために使う
  // (Codexレビュー指摘、2026-09-04: 例外時に無条件でfalseへ倒すと、既に
  // 購読中と確認済みのユーザーがRevenueCatの一時障害だけで広告表示側へ
  // 誤って戻ってしまう)。
  bool _hasConfirmedOnce = false;

  /// initialize()に渡された最後のappUserId。初期化に失敗した場合でも
  /// 後から同じIDで再初期化できるよう保持する。
  String? _appUserId;

  bool get isSubscribed => _isSubscribed;

  /// checkEntitlement()が一度でも解決済みかどうか。起動直後はRevenueCatの
  /// 初期化・問い合わせが非同期でバックグラウンド実行されるため、この値が
  /// falseの間は「未購読と確定した」わけではない。購読中ユーザーに広告を
  /// 一瞬表示してしまうのを避けたい箇所(LoadingBannerAd等)は、
  /// isSubscribedだけでなくこちらも合わせて確認すること。
  bool get isStatusKnown => _statusKnown;

  /// RevenueCat SDKを初期化する。アプリ起動をブロックしないよう、
  /// 呼び出し元でawaitせずバックグラウンドで実行すること。
  Future<void> initialize(String appUserId) async {
    _appUserId = appUserId;
    await Purchases.configure(
      PurchasesConfiguration(RevenueCatKeys.publicSdkKey)..appUserID = appUserId,
    );
    _configured = true;
    await checkEntitlement();
  }

  /// 起動時のinitialize()が失敗していた場合(RevenueCatキー未設定・
  /// 通信断など)に、同じappUserIdで一度だけ再初期化を試みる。
  /// それでも初期化できない場合は日本語のStateErrorを投げ、
  /// 未初期化のSDKを呼び出して不可解なネイティブ例外が出るのを防ぐ。
  Future<void> _ensureConfigured() async {
    if (_configured) return;
    final appUserId = _appUserId;
    if (appUserId == null) {
      throw StateError(_notConfiguredMessage);
    }
    try {
      await initialize(appUserId);
    } catch (_) {
      throw StateError(_notConfiguredMessage);
    }
    if (!_configured) {
      throw StateError(_notConfiguredMessage);
    }
  }

  /// サーバーに問い合わせず、RevenueCat SDKのキャッシュ済み顧客情報から
  /// 購読中かどうかを判定する。質問送信前の楽観的なUI表示に使う
  /// (実際のアクセス可否判定は常にバックエンドの/api/ruling/jobsが行う)。
  ///
  /// 問い合わせに失敗した場合(RevenueCat側の一時障害等)の扱い:
  /// - 一度も確定したことが無い(起動直後の初回確認等)場合は未購読として
  ///   扱いisStatusKnownをtrueにする。ここで確定させずに例外を伝播させると、
  ///   無償ユーザーの広告表示(LoadingBannerAd)がそのセッション中ずっと
  ///   止まったままになってしまう(Codexレビュー指摘、2026-09-04)。誤って
  ///   購読者に広告を出すより、無償ユーザーに一時的に広告が出る方が実害が
  ///   小さいと判断し、安全側(広告を出す側)へフォールバックする。
  /// - 既に一度でも確定済み(購読/非購読いずれか)の場合は、一時的な問い
  ///   合わせ失敗だけで直前の確定値を上書きしない(Codexレビュー指摘、
  ///   2026-09-04: 上記の安全側フォールバックを無条件に適用すると、既に
  ///   購読中と確認済みのユーザーがRevenueCatの一時障害だけで広告表示側へ
  ///   誤って戻ってしまう)。
  Future<bool> checkEntitlement() async {
    if (!_configured) {
      if (!_hasConfirmedOnce) {
        _isSubscribed = false;
        _statusKnown = true;
      }
      notifyListeners();
      return _isSubscribed;
    }
    try {
      final customerInfo = await Purchases.getCustomerInfo();
      _isSubscribed = customerInfo.entitlements.active.containsKey(_entitlementId);
      _hasConfirmedOnce = true;
      _statusKnown = true;
    } catch (_) {
      if (!_hasConfirmedOnce) {
        _isSubscribed = false;
        _statusKnown = true;
      }
    }
    notifyListeners();
    return _isSubscribed;
  }

  /// 現在のOfferingから購入対象のパッケージ(単一プランのため先頭)を返す。
  /// Offeringが未設定・空の場合はnullを返す(ペイウォール側で案内を出す)。
  Future<Package?> loadCurrentPackage() async {
    await _ensureConfigured();
    final offerings = await Purchases.getOfferings();
    final current = offerings.current;
    if (current == null || current.availablePackages.isEmpty) return null;
    return current.availablePackages.first;
  }

  /// 商品を購入する。ペイウォールが表示のために取得済みのパッケージを
  /// 渡すこと。省略した場合は現在のOfferingから取得する。
  Future<void> purchase([Package? package]) async {
    await _ensureConfigured();
    final target = package ?? await loadCurrentPackage();
    if (target == null) {
      throw StateError('購入可能なプランが見つかりませんでした。');
    }
    await Purchases.purchase(PurchaseParams.package(target));
    await checkEntitlement();
  }

  /// 購入の復元(再インストール後・機種変更時)。復元後の購読有無を返す。
  Future<bool> restorePurchases() async {
    await _ensureConfigured();
    await Purchases.restorePurchases();
    return checkEntitlement();
  }

  /// 端末のストア(App Store / Google Play)上のサブスクリプション管理画面URL。
  /// 解約・支払い方法変更等はアプリ内では行えず、必ずこの画面へ誘導する。
  /// 取得できない場合(未購読・通信断等)はnullを返す。
  Future<String?> getManagementUrl() async {
    if (!_configured) return null;
    final customerInfo = await Purchases.getCustomerInfo();
    return customerInfo.managementURL;
  }
}

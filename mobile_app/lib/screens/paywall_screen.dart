import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import '../api/api_client.dart';
import '../billing/subscription_provider.dart';
import '../push/device_id.dart';
import '../utils/external_links.dart';

/// App Store Guideline 3.1.2 / Google Playの要件により、
/// ペイウォールからプライバシーポリシーと利用規約へ到達できる必要がある。
/// (オプション画面と同じURLを使用)
const _privacyPolicyUrl =
    'https://redcola1030503-svg.github.io/dm-ruling-bot/mobile-app-privacy-policy.html';
const _termsOfServiceUrl =
    'https://redcola1030503-svg.github.io/dm-ruling-bot/mobile-app-terms-of-service.html';

/// 無料枠(月10問)を超えた際、またはオプション画面から能動的にアクセスされた
/// 際に表示するプラン画面。購入・復元のいずれかが成功すると呼び出し元にtrueを
/// 返して閉じる。既に購読中の場合は購入導線ではなく、サブスクリプション管理
/// (端末のストア設定を開く)導線を表示する。
///
/// 価格・期間はハードコードせず、ストアが返すローカライズ済みの値
/// (StoreProduct.priceString / subscriptionPeriod)をそのまま表示する
/// (App Store Guideline 3.1.2の必須要件)。
class PaywallScreen extends StatefulWidget {
  final ApiClient apiClient;

  /// 無料枠超過(402)によって呼び出されたかどうか。trueの場合のみ
  /// 「無料枠を使い切りました」という導入文を表示する。オプション画面等から
  /// 能動的にアクセスされた場合(false)は、まだ枠を使い切っていないユーザーに
  /// 誤解を与えないためこの文言を出さない。
  final bool triggeredByQuotaLimit;

  const PaywallScreen({
    super.key,
    required this.apiClient,
    this.triggeredByQuotaLimit = false,
  });

  @override
  State<PaywallScreen> createState() => _PaywallScreenState();
}

class _PaywallScreenState extends State<PaywallScreen> {
  bool _processing = false;
  bool _loadingOffering = true;
  String? _error;
  String? _offeringError;
  Package? _package;
  bool _loadingManagementUrl = false;

  @override
  void initState() {
    super.initState();
    final subscription = context.read<SubscriptionProvider>();
    _loadOffering(subscription);
  }

  Future<void> _loadOffering(SubscriptionProvider subscription) async {
    try {
      final package = await subscription.loadCurrentPackage();
      if (!mounted) return;
      setState(() {
        _package = package;
        _offeringError = package == null
            ? '現在購入できるプランが見つかりませんでした。しばらくしてから再度お試しください。'
            : null;
        _loadingOffering = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _offeringError = _friendlyMessage(e, fallback: 'プラン情報の取得に失敗しました。通信環境をご確認のうえ、再度お試しください。');
        _loadingOffering = false;
      });
    }
  }

  /// PlatformExceptionからRevenueCatのエラーコードを取り出す。
  /// RevenueCat以外のPlatformException(codeが数値でない)の場合はnullを返す。
  PurchasesErrorCode? _errorCodeOf(Object e) {
    if (e is! PlatformException) return null;
    try {
      return PurchasesErrorHelper.getErrorCode(e);
    } catch (_) {
      return null;
    }
  }

  /// ユーザーが購入シートを閉じた(キャンセルした)かどうか。
  /// キャンセルは失敗ではないため、エラー表示しない。
  bool _isCancelled(Object e) =>
      _errorCodeOf(e) == PurchasesErrorCode.purchaseCancelledError;

  /// 生の例外を画面に出さず、必ず日本語のメッセージへ変換する。
  String _friendlyMessage(Object e, {required String fallback}) {
    switch (_errorCodeOf(e)) {
      case PurchasesErrorCode.productAlreadyPurchasedError:
        return '既に購読済みです。アプリを再起動してみてください。';
      case PurchasesErrorCode.networkError:
      case PurchasesErrorCode.offlineConnectionError:
        return '通信エラーが発生しました。しばらくしてから再度お試しください。';
      case PurchasesErrorCode.purchaseNotAllowedError:
        return 'この端末では購入が許可されていません。端末の設定をご確認ください。';
      case PurchasesErrorCode.paymentPendingError:
        return '支払いの承認待ちです。完了までしばらくお待ちください。';
      case PurchasesErrorCode.storeProblemError:
        return 'ストアとの通信で問題が発生しました。しばらくしてから再度お試しください。';
      default:
        // 初期化失敗などアプリ側で投げた日本語のStateErrorはそのまま表示する。
        if (e is StateError) return e.message;
        return fallback;
    }
  }

  /// 購入成功後にバックエンドへ購読状態を即時反映する。
  /// 失敗してもRevenueCatのWebhookが後追いで反映するため、
  /// ユーザーにはエラーを出さず握りつぶす(課金は成立している)。
  Future<void> _syncBillingSilently() async {
    try {
      final deviceId = await DeviceIdProvider().getOrCreate();
      await widget.apiClient.syncBilling(deviceId);
    } catch (_) {
      // 無視(Webhookで反映される)
    }
  }

  Future<void> _handlePurchase() async {
    final package = _package;
    if (package == null) return;
    final subscription = context.read<SubscriptionProvider>();
    setState(() {
      _processing = true;
      _error = null;
    });
    try {
      await subscription.purchase(package);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _processing = false;
        // キャンセルは失敗ではないため何も表示しない。
        _error = _isCancelled(e)
            ? null
            : _friendlyMessage(e, fallback: '購入に失敗しました。しばらくしてから再度お試しください。');
      });
      return;
    }
    // ここまで来たら購入は成立している。以降の失敗で「購入に失敗」とは表示しない。
    await _syncBillingSilently();
    if (!mounted) return;
    setState(() => _processing = false);
    Navigator.pop(context, true);
  }

  Future<void> _handleRestore() async {
    final subscription = context.read<SubscriptionProvider>();
    setState(() {
      _processing = true;
      _error = null;
    });
    bool restored;
    try {
      restored = await subscription.restorePurchases();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _processing = false;
        _error = _friendlyMessage(e, fallback: '復元に失敗しました。しばらくしてから再度お試しください。');
      });
      return;
    }
    if (!restored) {
      if (!mounted) return;
      setState(() {
        _processing = false;
        _error = '有効な購読が見つかりませんでした。';
      });
      return;
    }
    await _syncBillingSilently();
    if (!mounted) return;
    setState(() => _processing = false);
    Navigator.pop(context, true);
  }

  /// 端末のストア(App Store / Google Play)のサブスクリプション管理画面を開く。
  /// 解約・支払い方法変更はアプリ内では行えず、常にストア側の画面へ委ねる。
  Future<void> _handleManageSubscription() async {
    if (_loadingManagementUrl) return;
    final subscription = context.read<SubscriptionProvider>();
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _loadingManagementUrl = true);
    String? url;
    try {
      url = await subscription.getManagementUrl();
    } catch (_) {
      url = null;
    }
    if (!mounted) return;
    setState(() => _loadingManagementUrl = false);
    if (url == null) {
      messenger.showSnackBar(
        const SnackBar(content: Text('管理画面を開けませんでした。しばらくしてから再度お試しください。')),
      );
      return;
    }
    if (!mounted) return;
    await openExternalUri(context, Uri.parse(url));
  }

  /// ISO 8601のサブスクリプション期間(P1M等)を日本語の期間ラベルへ変換する。
  /// 未知の値やAmazon(期間がnull)の場合は空文字を返す。
  String _periodLabel(String? period) {
    switch (period) {
      case 'P1W':
      case 'P7D':
        return '週額';
      case 'P1M':
        return '月額';
      case 'P2M':
        return '2ヶ月ごと';
      case 'P3M':
        return '3ヶ月ごと';
      case 'P6M':
        return '6ヶ月ごと';
      case 'P1Y':
        return '年額';
      default:
        return '';
    }
  }

  String _priceLabel(StoreProduct product) {
    final label = _periodLabel(product.subscriptionPeriod);
    return label.isEmpty ? product.priceString : '$label ${product.priceString}';
  }

  Widget _buildPlanInfo() {
    if (_loadingOffering) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: CircularProgressIndicator(),
      );
    }
    final package = _package;
    if (package == null) {
      return Text(
        _offeringError ?? '現在購入できるプランが見つかりませんでした。',
        style: const TextStyle(color: Colors.red),
        textAlign: TextAlign.center,
      );
    }
    final product = package.storeProduct;
    return Column(
      children: [
        Text(
          product.title,
          style: Theme.of(context).textTheme.titleMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          _priceLabel(product),
          style: Theme.of(context).textTheme.headlineSmall,
          textAlign: TextAlign.center,
        ),
        if (product.description.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(product.description, textAlign: TextAlign.center),
        ],
        const SizedBox(height: 8),
        Text(
          '購読期間が終了する前に解約しない限り自動更新されます。'
          // 半角スペースの代わりに改行禁止スペース(U+00A0)を使い、
          // ストア名の括弧書きが行の途中で分断されないようにする。
          '解約は端末のストア(App Store / Google Play)から行えます。',
          style: Theme.of(context).textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildSubscribedView(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('質問し放題プラン')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.check_circle,
              color: Theme.of(context).colorScheme.primary,
              size: 48,
            ),
            const SizedBox(height: 16),
            const Text(
              // 「す」だけが孤立して次行に折り返るのを避けるため、
              // 文節境界(助詞の後)で明示的に改行する。
              '質問し放題プランを\nご利用中です',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            const Text(
              '無料枠を超えて質問し放題・広告非表示が有効です。',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            FilledButton(
              onPressed: _loadingManagementUrl ? null : _handleManageSubscription,
              child: _loadingManagementUrl
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('サブスクリプションを管理'),
            ),
            const SizedBox(height: 8),
            Text(
              '解約・支払い方法の変更は端末のストア(App Store / Google Play)の'
              '定期購読設定から行えます。',
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSubscribed = context.watch<SubscriptionProvider>().isSubscribed;
    if (isSubscribed) return _buildSubscribedView(context);

    final package = _package;
    final purchaseLabel = package == null
        ? 'アップグレードする'
        : '${_priceLabel(package.storeProduct)}にアップグレード';
    return Scaffold(
      appBar: AppBar(title: const Text('質問し放題プラン')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (widget.triggeredByQuotaLimit) ...[
              const Text(
                // 「た」だけが孤立して次行に折り返るのを避けるため、
                // 文節境界(助詞の後)で明示的に改行する。
                '無料枠(月10問)を\n使い切りました',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
            ],
            _buildPlanInfo(),
            const SizedBox(height: 32),
            if (_error != null) ...[
              Text(_error!, style: const TextStyle(color: Colors.red)),
              const SizedBox(height: 16),
            ],
            FilledButton(
              onPressed: (_processing || package == null)
                  ? null
                  : _handlePurchase,
              child: _processing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(purchaseLabel),
            ),
            const SizedBox(height: 12),
            TextButton(
              onPressed: _processing ? null : _handleRestore,
              child: const Text('購入を復元する'),
            ),
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              children: [
                TextButton(
                  onPressed: () =>
                      openExternalUri(context, Uri.parse(_termsOfServiceUrl)),
                  child: const Text('利用規約'),
                ),
                TextButton(
                  onPressed: () =>
                      openExternalUri(context, Uri.parse(_privacyPolicyUrl)),
                  child: const Text('プライバシーポリシー'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

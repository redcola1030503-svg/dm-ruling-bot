import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:provider/provider.dart';

import '../ads/ad_unit_ids.dart';
import '../billing/subscription_provider.dart';

/// 無償版に表示するバナー広告。読み込み中・失敗時は何も表示しない
/// (広告なしでも本来の裁定機能に影響させないため、エラーは握りつぶしてよい)。
/// 購読者向け特典として、購読中は広告自体を読み込まない。
///
/// 購読状態が確定する(SubscriptionProvider.isStatusKnown)までは広告を
/// 読み込まない。起動直後は購読確認が非同期でバックグラウンド実行されており、
/// isSubscribedの初期値はfalseのため、確定前に読み込むと購読中ユーザーにも
/// 一瞬広告が表示されてしまう(Codexレビュー指摘、2026-09-04)。
///
/// 非購読と判明している間は、広告読み込み前後でレイアウトが変わらないよう
/// 常にAdSize.bannerと同じ高さの領域を確保する(読み込み前・失敗時は空の枠、
/// 読み込み後に広告を表示)。これにより、直前まで表示されていなかったボタン等が
/// 広告の出現で押し下げられて意図しないタップを誘発する事態を防ぐ
/// (Codexレビュー指摘、2026-09-04)。ただし購読中と判明した場合はウィジェット
/// 自体がSizedBox.shrinkになるため、この不変条件は「非購読/未確定」の間のみ
/// 成り立つ(購読開始・復元でレイアウトが変わること自体は許容する設計)。
class LoadingBannerAd extends StatefulWidget {
  const LoadingBannerAd({super.key});

  @override
  State<LoadingBannerAd> createState() => _LoadingBannerAdState();
}

class _LoadingBannerAdState extends State<LoadingBannerAd> {
  BannerAd? _bannerAd;
  bool _loadRequested = false;

  void _maybeLoadAd(SubscriptionProvider subscription) {
    if (_loadRequested) return;
    if (!subscription.isStatusKnown) return;
    if (subscription.isSubscribed) return;
    _loadRequested = true;
    _loadAd();
  }

  void _loadAd() {
    final ad = BannerAd(
      adUnitId: AdUnitIds.banner,
      size: AdSize.banner,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (loadedAd) {
          if (!mounted) {
            loadedAd.dispose();
            return;
          }
          setState(() => _bannerAd = loadedAd as BannerAd);
        },
        onAdFailedToLoad: (failedAd, error) {
          failedAd.dispose();
        },
      ),
    );
    ad.load();
  }

  @override
  void dispose() {
    _bannerAd?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final subscription = context.watch<SubscriptionProvider>();
    if (subscription.isStatusKnown && subscription.isSubscribed) {
      return const SizedBox.shrink();
    }

    _maybeLoadAd(subscription);

    final ad = _bannerAd;
    return SizedBox(
      width: AdSize.banner.width.toDouble(),
      height: AdSize.banner.height.toDouble(),
      child: ad == null
          ? null
          : Align(
              alignment: Alignment.center,
              child: SizedBox(
                width: ad.size.width.toDouble(),
                height: ad.size.height.toDouble(),
                child: AdWidget(ad: ad),
              ),
            ),
    );
  }
}

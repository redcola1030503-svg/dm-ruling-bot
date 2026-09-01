import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:provider/provider.dart';

import '../ads/ad_unit_ids.dart';
import '../billing/subscription_provider.dart';

/// 裁定生成の待ち時間中に表示するバナー広告。
/// 読み込み中・失敗時は何も表示しない(広告なしでも本来の裁定機能に
/// 影響させないため、エラーは握りつぶしてよい)。
/// 購読者向け特典として、購読中は広告自体を読み込まない。
class LoadingBannerAd extends StatefulWidget {
  const LoadingBannerAd({super.key});

  @override
  State<LoadingBannerAd> createState() => _LoadingBannerAdState();
}

class _LoadingBannerAdState extends State<LoadingBannerAd> {
  BannerAd? _bannerAd;

  @override
  void initState() {
    super.initState();
    // 起動時にSubscriptionProvider.initialize()が既に解決済みであることが
    // 大半のため、ここでの判定で十分。仮に未解決でも購読者でなければ
    // 広告を読み込んで問題ないため、購読者側だけを取りこぼさなければよい。
    if (!context.read<SubscriptionProvider>().isSubscribed) {
      _loadAd();
    }
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
    // 起動直後などSubscriptionProviderの初期化がinitState()時点でまだ
    // 解決していなかった場合に備え、build()側でも購読中なら非表示にする。
    final isSubscribed = context.watch<SubscriptionProvider>().isSubscribed;
    if (isSubscribed) return const SizedBox.shrink();

    final ad = _bannerAd;
    if (ad == null) return const SizedBox.shrink();
    return Align(
      alignment: Alignment.center,
      child: SizedBox(
        width: ad.size.width.toDouble(),
        height: ad.size.height.toDouble(),
        child: AdWidget(ad: ad),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import '../ads/ad_unit_ids.dart';

/// 裁定生成の待ち時間中に表示するバナー広告。
/// 読み込み中・失敗時は何も表示しない(広告なしでも本来の裁定機能に
/// 影響させないため、エラーは握りつぶしてよい)。
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

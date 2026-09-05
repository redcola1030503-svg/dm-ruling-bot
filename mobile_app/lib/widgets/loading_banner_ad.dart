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
///
/// 上下の余白(`verticalMargin`)はウィジェット自身が含む。呼び出し側が
/// 前後にSizedBoxを別途置くと、購読中(広告非表示)でも両方の余白が残って
/// しまい、購読の有無で間隔が変わってしまう(Codexレビュー指摘、2026-09-05、
/// T013 Review 5)。ただし、呼び出し元がこのウィジェットの前後に置いていた
/// SizedBoxは、広告のためだけでなく「フォームの入力欄とボタンの最低限の
/// 間隔」も兼ねていた場合がある。購読中(広告非表示)に単純な高さ0へ倒すと、
/// 今度はその最低限の間隔まで失われてしまう(Codexレビュー指摘、2026-09-05、
/// T013 Review 6)。`collapsedHeight`で、広告非表示時にも維持したい高さを
/// 呼び出し側が指定できるようにする。
class LoadingBannerAd extends StatefulWidget {
  final double verticalMargin;
  final double collapsedHeight;

  const LoadingBannerAd({super.key, this.verticalMargin = 8, this.collapsedHeight = 0});

  @override
  State<LoadingBannerAd> createState() => _LoadingBannerAdState();
}

class _LoadingBannerAdState extends State<LoadingBannerAd> {
  BannerAd? _bannerAd;
  bool _loadRequested = false;
  // T013(Codexレビュー指摘、2026-09-05、Review 5): 購読解除後の再読み込みを
  // 許可すると、前のリクエストの非同期コールバックが後から返ってきて現在の
  // 状態を上書きしうる。リクエストごとに世代番号を発行し、コールバック側で
  // 最新の世代かどうかを確認してから状態を更新することでこれを防ぐ。
  int _loadGeneration = 0;

  void _maybeLoadAd(SubscriptionProvider subscription) {
    if (_loadRequested) return;
    if (!subscription.isStatusKnown) return;
    if (subscription.isSubscribed) return;
    _loadRequested = true;
    _loadAd(++_loadGeneration);
  }

  void _loadAd(int generation) {
    final ad = BannerAd(
      adUnitId: AdUnitIds.banner,
      size: AdSize.banner,
      request: const AdRequest(),
      listener: BannerAdListener(
        onAdLoaded: (loadedAd) {
          if (!mounted || generation != _loadGeneration) {
            loadedAd.dispose();
            return;
          }
          setState(() => _bannerAd = loadedAd as BannerAd);
        },
        onAdFailedToLoad: (failedAd, error) {
          failedAd.dispose();
          // T013(Codexレビュー指摘、2026-09-05、Review 6): onAdLoadedと同様に
          // 世代チェックをしないと、購読解除後に再読み込みした新しいリクエストが
          // 進行中でも、旧世代の失敗コールバックが遅れて到着した際に
          // _loadRequestedをfalseへ戻してしまい、重複リクエストや正常な
          // 結果の破棄を招く。
          if (!mounted || generation != _loadGeneration) return;
          setState(() => _loadRequested = false);
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

  // T013(Codexレビュー指摘、2026-09-05、Review 4・5): 画面を開いたまま購読を
  // 開始・復元した場合、build()がSizedBox.shrinkを返すだけでは既存の
  // BannerAdインスタンスがdisposeされず、広告SDK側のリソースが解放され
  // ないまま保持され続ける(Review 4)。また、購読開始時にリセットするだけで
  // 再読み込みの手当てをしないと、その後購読解除(期限切れ・アカウント切替等)
  // しても「無償版では常時表示」を満たせなくなる(Review 5)。購読状態が変わる
  // たびに呼ばれるdidChangeDependenciesで、購読中に転じていれば保持中の広告を
  // 破棄しつつ次回非購読へ戻った際に再読み込みできる状態へリセットする。
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final subscription = context.read<SubscriptionProvider>();
    if (subscription.isStatusKnown && subscription.isSubscribed && (_bannerAd != null || _loadRequested)) {
      final ad = _bannerAd;
      _bannerAd = null;
      _loadRequested = false;
      _loadGeneration++; // 進行中のロードのコールバックを無効化する
      ad?.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final subscription = context.watch<SubscriptionProvider>();
    if (subscription.isStatusKnown && subscription.isSubscribed) {
      return SizedBox(height: widget.collapsedHeight);
    }

    _maybeLoadAd(subscription);

    final ad = _bannerAd;
    return Padding(
      padding: EdgeInsets.symmetric(vertical: widget.verticalMargin),
      child: SizedBox(
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
      ),
    );
  }
}

import 'dart:io';

/// 広告ユニットIDの管理。
/// 現在はGoogle公式のテスト用IDを使用している。本番リリース前に、
/// 自分のAdMobアカウントで発行した広告ユニットID(Android/iOSそれぞれ別)へ
/// 差し替えること。テストIDのまま本番公開すると審査で問題になるため注意。
class AdUnitIds {
  static String get banner {
    if (Platform.isAndroid) return 'ca-app-pub-3940256099942544/6300978111';
    if (Platform.isIOS) return 'ca-app-pub-3940256099942544/2934735716';
    throw UnsupportedError('この広告ユニットはAndroid/iOS以外では利用できません。');
  }
}

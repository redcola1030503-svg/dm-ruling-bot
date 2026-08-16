import 'dart:io';

/// 広告ユニットIDの管理。
/// Androidは本番のAdMobアカウントで発行したIDを使用。
/// iOSはAdMob側でアプリ・広告ユニット未登録のため、登録後に差し替えること
/// (それまではGoogle公式のテスト用IDを使用)。
class AdUnitIds {
  static String get banner {
    if (Platform.isAndroid) return 'ca-app-pub-9649943716514595/2326100766';
    if (Platform.isIOS) return 'ca-app-pub-3940256099942544/2934735716';
    throw UnsupportedError('この広告ユニットはAndroid/iOS以外では利用できません。');
  }
}

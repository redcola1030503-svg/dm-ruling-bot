import 'dart:io';

/// 広告ユニットIDの管理。
/// Android/iOSともに本番のAdMobアカウントで発行したIDを使用。
class AdUnitIds {
  static String get banner {
    if (Platform.isAndroid) return 'ca-app-pub-9649943716514595/2326100766';
    if (Platform.isIOS) return 'ca-app-pub-9649943716514595/9826150983';
    throw UnsupportedError('この広告ユニットはAndroid/iOS以外では利用できません。');
  }
}

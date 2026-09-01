import 'dart:io';

/// RevenueCatのPublic SDK Key(クライアント埋め込み前提の公開鍵)。
/// RevenueCatダッシュボード(Project settings > API keys)で
/// Android/iOSそれぞれのアプリを登録すると発行される。
///
/// プロジェクト「デュエマ裁定確認」(RevenueCatダッシュボード、2026-08-31作成)の値。
class RevenueCatKeys {
  static String get publicSdkKey {
    if (Platform.isAndroid) return 'goog_xDVJQZhSQTIfbrduewYBlnmnEYJ';
    if (Platform.isIOS) return 'appl_zheTwZuqhUGWZbIqUcKUVqtOfOO';
    throw UnsupportedError('RevenueCatはAndroid/iOS以外では利用できません。');
  }
}

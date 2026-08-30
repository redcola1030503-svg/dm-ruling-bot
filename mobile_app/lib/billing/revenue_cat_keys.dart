import 'dart:io';

/// RevenueCatのPublic SDK Key(クライアント埋め込み前提の公開鍵)。
/// RevenueCatダッシュボード(Project settings > API keys)で
/// Android/iOSそれぞれのアプリを登録すると発行される。
///
/// 以下はRevenueCatプロジェクト作成前のプレースホルダー。実装時に
/// RevenueCatダッシュボードで実際の値に置き換えること。
class RevenueCatKeys {
  static String get publicSdkKey {
    if (Platform.isAndroid) return 'goog_REPLACE_WITH_ANDROID_PUBLIC_SDK_KEY';
    if (Platform.isIOS) return 'appl_REPLACE_WITH_IOS_PUBLIC_SDK_KEY';
    throw UnsupportedError('RevenueCatはAndroid/iOS以外では利用できません。');
  }
}

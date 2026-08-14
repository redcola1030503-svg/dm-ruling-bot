// Firebaseコンソールでダウンロードしたandroid/app/google-services.jsonの値から
// 手動生成(このプロジェクトはWindows開発環境のためflutterfire CLIの対話ログイン
// フローが使えず、`flutterfire configure`の代わりに直接作成している)。
// Android以外のプラットフォームは未対応(このアプリはAndroidのみサポート)。
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('DefaultFirebaseOptions have not been configured for web.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      default:
        throw UnsupportedError(
          'DefaultFirebaseOptions are only configured for Android in this app.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyABkfDFSg6oLtazVQpZHfAquF-Fbn6jnIU',
    appId: '1:244258250345:android:940c888e15249e23b80cf8',
    messagingSenderId: '244258250345',
    projectId: 'dm-ruling-bot',
    storageBucket: 'dm-ruling-bot.firebasestorage.app',
  );
}

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../firebase_options.dart';

/// バックグラウンド/終了状態でメッセージを受信した際にFlutterエンジン外で
/// 呼ばれるトップレベル関数(クラスメソッドにはできない)。notificationブロックが
/// 付いたFCMメッセージはAndroidが自動でシステムトレイに表示するため、
/// ここでは追加の表示処理は不要(Firebase初期化のみ行う)。
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
}

class PushService {
  static const _jobIdDataKey = 'jobId';

  Future<void> initialize() async {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  }

  /// 通知許可をリクエストし、許可されればFCMトークンを返す。
  /// 既に許可/拒否済みの場合、OSダイアログは再表示されずすぐ結果が返る。
  Future<String?> requestPermissionAndGetToken() async {
    final settings = await FirebaseMessaging.instance.requestPermission();
    if (settings.authorizationStatus == AuthorizationStatus.denied) return null;
    try {
      return await FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  void listenTokenRefresh(void Function(String token) onToken) {
    FirebaseMessaging.instance.onTokenRefresh.listen(onToken);
  }

  /// 通知タップによる起動(アプリ終了状態からの起動・バックグラウンドからの復帰)を検知する。
  void listenNotificationTap(void Function(String jobId) onTap) {
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      final jobId = message?.data[_jobIdDataKey];
      if (jobId != null) onTap(jobId);
    });
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final jobId = message.data[_jobIdDataKey];
      if (jobId != null) onTap(jobId);
    });
  }
}

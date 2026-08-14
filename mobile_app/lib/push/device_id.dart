import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// プッシュ通知の送信先を紐付けるための匿名デバイスID。
/// ログイン不要の一般ユーザーでも使えるよう、認証トークンとは別に
/// 端末ごとに生成しflutter_secure_storageへ永続化する。
class DeviceIdProvider {
  static const _deviceIdKey = 'push_device_id';

  final FlutterSecureStorage _storage;

  DeviceIdProvider({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  Future<String> getOrCreate() async {
    String? existing;
    try {
      existing = await _storage.read(key: _deviceIdKey);
    } catch (_) {
      existing = null;
    }
    if (existing != null && existing.isNotEmpty) return existing;

    final generated = _generate();
    try {
      await _storage.write(key: _deviceIdKey, value: generated);
    } catch (_) {
      // 永続化に失敗しても、このセッション内では生成したIDをそのまま使う
    }
    return generated;
  }

  String _generate() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }
}

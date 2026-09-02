import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// プッシュ通知の送信先を紐付けるための匿名デバイスID。
/// ログイン不要の一般ユーザーでも使えるよう、認証トークンとは別に
/// 端末ごとに生成しflutter_secure_storageへ永続化する。
///
/// D-005(インストール単位ID方針)により、再インストール等での失効は
/// 既知の限界として受容するが、同一プロセス内では常に同じIDを返す必要が
/// ある(呼び出しのたびに異なるIDを返すとdevice_monthly_usage等の集計が
/// 意味を成さなくなるため)。呼び出し元は`DeviceIdProvider()`を都度newする
/// 設計のため、キャッシュと進行中Futureはインスタンスではなくクラス(static)
/// で共有し、どのインスタンス経由で呼んでも同一プロセス内では同じIDを返す。
/// Storageのawait中に複数箇所からの呼び出しが重なり得るため、進行中の
/// Futureを共有して二重生成を防ぐ。
class DeviceIdProvider {
  static const _deviceIdKey = 'push_device_id';

  final FlutterSecureStorage _storage;

  static String? _cachedId;
  static Future<String>? _inFlight;

  DeviceIdProvider({FlutterSecureStorage? storage}) : _storage = storage ?? const FlutterSecureStorage();

  Future<String> getOrCreate() {
    final cached = _cachedId;
    if (cached != null) return Future.value(cached);

    return _inFlight ??= _resolve();
  }

  Future<String> _resolve() async {
    try {
      String? existing;
      var readFailed = false;
      try {
        existing = await _storage.read(key: _deviceIdKey);
      } catch (_) {
        readFailed = true;
      }
      if (existing != null && existing.isNotEmpty) {
        _cachedId = existing;
        return existing;
      }

      final generated = _generate();
      if (readFailed) {
        // 読み込み自体が失敗した場合、実際には既存IDが保存されている可能性を
        // 否定できないため、書き込んで上書きすることはしない。生成したIDは
        // メモリキャッシュのみでこのプロセスの間だけ使う。
      } else {
        try {
          await _storage.write(key: _deviceIdKey, value: generated);
        } catch (_) {
          // 永続化に失敗しても、生成したIDをメモリキャッシュしプロセス内で使い続ける
        }
      }
      _cachedId = generated;
      return generated;
    } finally {
      _inFlight = null;
    }
  }

  String _generate() {
    final random = Random.secure();
    final bytes = List<int>.generate(16, (_) => random.nextInt(256));
    return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }

  /// テスト専用。static化したキャッシュ・進行中Futureをテストケース間で
  /// リークさせないために使う。
  @visibleForTesting
  static void resetCacheForTesting() {
    _cachedId = null;
    _inFlight = null;
  }
}

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/push/device_id.dart';

class _FakeSecureStorage extends FlutterSecureStorage {
  const _FakeSecureStorage({
    this.existingValue,
    this.failRead = false,
    this.failWrite = false,
    this.writes,
  });

  final String? existingValue;
  final bool failRead;
  final bool failWrite;
  final List<String>? writes;

  @override
  Future<String?> read({
    required String key,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (failRead) throw Exception('read failed');
    return existingValue;
  }

  @override
  Future<void> write({
    required String key,
    required String? value,
    IOSOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    MacOsOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (failWrite) throw Exception('write failed');
    if (value != null) writes?.add(value);
  }
}

void main() {
  group('DeviceIdProvider', () {
    // キャッシュ・進行中FutureはD-005対応でクラス(static)共有のため、
    // テストケース間でリークしないよう毎回リセットする。
    setUp(DeviceIdProvider.resetCacheForTesting);
    tearDown(DeviceIdProvider.resetCacheForTesting);

    test('保存済みのIDがあればそれを返す', () async {
      final provider = DeviceIdProvider(
        storage: const _FakeSecureStorage(existingValue: 'existing-id'),
      );
      expect(await provider.getOrCreate(), 'existing-id');
    });

    test('保存済みのIDが無ければ新規生成して保存する', () async {
      final writes = <String>[];
      final provider = DeviceIdProvider(
        storage: _FakeSecureStorage(writes: writes),
      );
      final id = await provider.getOrCreate();
      expect(id, isNotEmpty);
      expect(writes, [id]);
    });

    test('読込が失敗しても生成したIDをメモリキャッシュし、以降同じIDを返す。'
        '既存IDを誤って上書きしないよう書込は行わない', () async {
      final writes = <String>[];
      final provider = DeviceIdProvider(
        storage: _FakeSecureStorage(failRead: true, writes: writes),
      );
      final first = await provider.getOrCreate();
      final second = await provider.getOrCreate();
      expect(first, second);
      expect(writes, isEmpty);
    });

    test('書込が失敗しても生成したIDをメモリキャッシュし、以降同じIDを返す', () async {
      final provider = DeviceIdProvider(
        storage: const _FakeSecureStorage(failWrite: true),
      );
      final first = await provider.getOrCreate();
      final second = await provider.getOrCreate();
      expect(first, second);
    });

    test('同一インスタンス内の並行呼出しでも常に同じIDを返す', () async {
      final writes = <String>[];
      final provider = DeviceIdProvider(
        storage: _FakeSecureStorage(writes: writes),
      );
      final results = await Future.wait([
        provider.getOrCreate(),
        provider.getOrCreate(),
        provider.getOrCreate(),
      ]);
      expect(results.toSet(), hasLength(1));
      // 進行中のFutureを共有するため、保存への書き込みも1回のみ
      expect(writes, hasLength(1));
    });

    test('別インスタンスから呼んでも同じIDを返す(呼び出し元は都度newする設計のため)', () async {
      final writes = <String>[];
      final storage = _FakeSecureStorage(writes: writes);
      final providerA = DeviceIdProvider(storage: storage);
      final providerB = DeviceIdProvider(storage: storage);

      final results = await Future.wait([
        providerA.getOrCreate(),
        providerB.getOrCreate(),
      ]);
      expect(results.toSet(), hasLength(1));
      expect(writes, hasLength(1));

      // 解決済み後に新しく作った3つ目のインスタンスからも同じIDが返る
      final providerC = DeviceIdProvider(storage: storage);
      expect(await providerC.getOrCreate(), results.first);
    });
  });
}

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../models/ruling_job.dart';
import '../push/device_id.dart';
import '../push/push_service.dart';

const _maxStoredJobs = 20;
const _pollInterval = Duration(seconds: 4);

/// 裁定ジョブの投稿・ポーリング・永続化を担う。フォアグラウンドではポーリングで
/// 即時反映し、バックグラウンド/終了状態からの継続はプッシュ通知に委ねる。
/// 通知を取りこぼした場合に備え、アプリ起動時・resumed復帰時に
/// refreshAllPending()で未完了ジョブを再確認するフォールバックも持つ。
class RulingJobsProvider extends ChangeNotifier {
  static const _jobsKey = 'ruling_jobs';

  final ApiClient apiClient;
  final PushService pushService;
  final DeviceIdProvider deviceIdProvider;
  final FlutterSecureStorage _storage;

  final List<RulingJob> _jobs = [];
  final Map<String, Timer> _pollers = {};
  bool _pushRegistered = false;
  bool _restored = false;

  RulingJobsProvider({
    required this.apiClient,
    PushService? pushService,
    DeviceIdProvider? deviceIdProvider,
    FlutterSecureStorage? storage,
  })  : pushService = pushService ?? PushService(),
        deviceIdProvider = deviceIdProvider ?? DeviceIdProvider(),
        _storage = storage ?? const FlutterSecureStorage();

  List<RulingJob> get jobs => List.unmodifiable(_jobs);

  Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      final raw = await _storage.read(key: _jobsKey);
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw) as List<dynamic>;
        _jobs.addAll(list.map((e) => RulingJob.fromStorageJson(e as Map<String, dynamic>)));
      }
    } catch (_) {
      // 永続化データが壊れていても致命的ではないため、空の状態から始める
    }
    notifyListeners();
    unawaited(refreshAllPending());
  }

  Future<void> _persist() async {
    try {
      final list = _jobs.take(_maxStoredJobs).map((j) => j.toStorageJson()).toList();
      await _storage.write(key: _jobsKey, value: jsonEncode(list));
    } catch (_) {
      // 永続化に失敗しても、このセッション内のメモリ上の状態は維持される
    }
  }

  Future<String> submitQuestion(String question) async {
    final deviceId = await deviceIdProvider.getOrCreate();
    if (!_pushRegistered) {
      unawaited(_setUpPush(deviceId));
    }

    final jobId = await apiClient.submitRulingJob(question, deviceId);
    final job = RulingJob(
      jobId: jobId,
      question: question,
      status: RulingJobStatus.pending,
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    _jobs.insert(0, job);
    await _persist();
    notifyListeners();

    _startPolling(jobId);
    return jobId;
  }

  Future<void> _setUpPush(String deviceId) async {
    _pushRegistered = true;
    try {
      final token = await pushService.requestPermissionAndGetToken();
      if (token != null) {
        await apiClient.registerPushToken(deviceId, token);
      }
      pushService.listenTokenRefresh((newToken) {
        unawaited(apiClient.registerPushToken(deviceId, newToken));
      });
    } catch (_) {
      // プッシュ通知の初期化に失敗しても、ポーリングでの結果取得は引き続き機能する
    }
  }

  void _startPolling(String jobId) {
    if (_pollers.containsKey(jobId)) return;
    _pollers[jobId] = Timer.periodic(_pollInterval, (_) => _pollOnce(jobId));
  }

  void _stopPolling(String jobId) {
    _pollers.remove(jobId)?.cancel();
  }

  Future<void> _pollOnce(String jobId) async {
    try {
      await refreshJob(jobId);
    } catch (_) {
      // 一時的なネットワークエラーは無視し、次のポーリングで再試行する
    }
  }

  Future<void> refreshJob(String jobId) async {
    final index = _jobs.indexWhere((j) => j.jobId == jobId);
    final question = index >= 0 ? _jobs[index].question : null;
    final updated = await apiClient.getRulingJob(jobId, question: question);

    if (index >= 0) {
      _jobs[index] = updated;
    } else {
      _jobs.insert(0, updated);
    }
    await _persist();
    notifyListeners();

    if (updated.isFinished) {
      _stopPolling(jobId);
    } else {
      _startPolling(jobId);
    }
  }

  /// 通知を取りこぼした場合のフォールバック。未完了として保存されている
  /// ジョブを全て再確認する(アプリ起動時・AppLifecycleState.resumed復帰時に呼ぶ)。
  Future<void> refreshAllPending() async {
    final pendingIds = _jobs.where((j) => !j.isFinished).map((j) => j.jobId).toList();
    for (final jobId in pendingIds) {
      await _pollOnce(jobId);
    }
  }

  @override
  void dispose() {
    for (final timer in _pollers.values) {
      timer.cancel();
    }
    _pollers.clear();
    super.dispose();
  }
}

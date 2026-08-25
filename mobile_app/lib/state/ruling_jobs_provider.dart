import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../models/ruling_job.dart';
import '../models/ruling_thread.dart';
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
  static const _notificationsEnabledKey = 'push_notifications_enabled';
  static const _favoriteThreadIdsKey = 'favorite_thread_ids';

  final ApiClient apiClient;
  final PushService pushService;
  final DeviceIdProvider deviceIdProvider;
  final FlutterSecureStorage _storage;

  final List<RulingJob> _jobs = [];
  final List<RulingThreadSummary> _threads = [];
  final Set<String> _favoriteThreadIds = {};
  final Map<String, Timer> _pollers = {};
  bool _pushRegistered = false;
  bool _restored = false;
  bool _notificationsEnabled = true;

  RulingJobsProvider({
    required this.apiClient,
    PushService? pushService,
    DeviceIdProvider? deviceIdProvider,
    FlutterSecureStorage? storage,
  }) : pushService = pushService ?? PushService(),
       deviceIdProvider = deviceIdProvider ?? DeviceIdProvider(),
       _storage = storage ?? const FlutterSecureStorage();

  List<RulingJob> get jobs => List.unmodifiable(_jobs);

  /// お気に入りのスレッドを先頭にまとめ、それぞれのグループ内では
  /// 元の順序(更新日時の新しい順)を維持したリストを返す。
  List<RulingThreadSummary> get threads {
    final favorites = _threads
        .where((t) => _favoriteThreadIds.contains(t.threadId))
        .toList();
    final others = _threads
        .where((t) => !_favoriteThreadIds.contains(t.threadId))
        .toList();
    return List.unmodifiable([...favorites, ...others]);
  }

  bool get notificationsEnabled => _notificationsEnabled;

  bool isFavoriteThread(String threadId) =>
      _favoriteThreadIds.contains(threadId);

  Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      final raw = await _storage.read(key: _jobsKey);
      if (raw != null && raw.isNotEmpty) {
        final list = jsonDecode(raw) as List<dynamic>;
        _jobs.addAll(
          list.map((e) => RulingJob.fromStorageJson(e as Map<String, dynamic>)),
        );
      }
    } catch (_) {
      // 永続化データが壊れていても致命的ではないため、空の状態から始める
    }
    try {
      final enabledValue = await _storage.read(key: _notificationsEnabledKey);
      if (enabledValue != null) {
        _notificationsEnabled = enabledValue == 'true';
      }
    } catch (_) {}
    try {
      final favRaw = await _storage.read(key: _favoriteThreadIdsKey);
      if (favRaw != null && favRaw.isNotEmpty) {
        final list = jsonDecode(favRaw) as List<dynamic>;
        _favoriteThreadIds.addAll(list.map((e) => e as String));
      }
    } catch (_) {}
    notifyListeners();
    unawaited(refreshAllPending());
  }

  Future<void> _persistFavoriteThreadIds() async {
    try {
      await _storage.write(
        key: _favoriteThreadIdsKey,
        value: jsonEncode(_favoriteThreadIds.toList()),
      );
    } catch (_) {}
  }

  /// スレッドのお気に入り状態を切り替える。お気に入りは端末ローカルの表示
  /// 順序のみに影響し、サーバー側のスレッドデータそのものは変更しない。
  Future<void> toggleFavoriteThread(String threadId) async {
    if (!_favoriteThreadIds.add(threadId)) {
      _favoriteThreadIds.remove(threadId);
    }
    notifyListeners();
    await _persistFavoriteThreadIds();
  }

  /// スレッドをサーバー・ローカル双方から削除する(取り消し不可)。
  Future<void> deleteThread(String threadId) async {
    final deviceId = await deviceIdProvider.getOrCreate();
    await apiClient.deleteRulingThread(threadId, deviceId);

    _threads.removeWhere((t) => t.threadId == threadId);
    _jobs.removeWhere((j) => j.threadId == threadId);
    _favoriteThreadIds.remove(threadId);
    await _persist();
    await _persistFavoriteThreadIds();
    notifyListeners();
  }

  /// 通知のON/OFFをユーザー操作で切り替える。OFFにする際はサーバー側に
  /// 登録済みのプッシュトークンも解除し、以後の質問投稿では再登録しない。
  /// ONに戻した際は次回の質問投稿を待たずその場で再登録する。
  Future<void> setNotificationsEnabled(bool enabled) async {
    if (_notificationsEnabled == enabled) return;
    _notificationsEnabled = enabled;
    notifyListeners();
    try {
      await _storage.write(
        key: _notificationsEnabledKey,
        value: enabled.toString(),
      );
    } catch (_) {}

    final deviceId = await deviceIdProvider.getOrCreate();
    _pushRegistered = false;
    if (enabled) {
      unawaited(_setUpPush(deviceId));
    } else {
      try {
        await apiClient.unregisterPushToken(deviceId);
      } catch (_) {
        // オフライン等で解除に失敗しても、ローカルの設定(OFF)は維持する
      }
    }
  }

  /// 現在の端末宛にテスト通知を送信する(オプション画面の動作確認用)。
  Future<void> sendTestNotification() async {
    final deviceId = await deviceIdProvider.getOrCreate();
    await apiClient.sendTestPushNotification(deviceId);
  }

  Future<void> _persist() async {
    try {
      final list = _jobs
          .take(_maxStoredJobs)
          .map((j) => j.toStorageJson())
          .toList();
      await _storage.write(key: _jobsKey, value: jsonEncode(list));
    } catch (_) {
      // 永続化に失敗しても、このセッション内のメモリ上の状態は維持される
    }
  }

  /// 新規質問を送信する。常に新規スレッドとして開始される。
  Future<String> submitQuestion(String question) async {
    final deviceId = await deviceIdProvider.getOrCreate();
    if (!_pushRegistered && _notificationsEnabled) {
      unawaited(_setUpPush(deviceId));
    }

    final submission = await apiClient.submitRulingJob(question, deviceId);
    final job = RulingJob(
      jobId: submission.jobId,
      question: question,
      status: RulingJobStatus.pending,
      threadId: submission.threadId,
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    _jobs.insert(0, job);
    if (submission.threadId != null) {
      _upsertThreadOptimistic(
        submission.threadId!,
        question,
        job,
        isNewJob: true,
      );
    }
    await _persist();
    notifyListeners();

    _startPolling(submission.jobId);
    return submission.jobId;
  }

  /// 既存スレッドへの追加質問(フォローアップ)を送信する。
  Future<String> submitFollowUp(String threadId, String question) async {
    final deviceId = await deviceIdProvider.getOrCreate();
    if (!_pushRegistered && _notificationsEnabled) {
      unawaited(_setUpPush(deviceId));
    }

    final submission = await apiClient.submitRulingJob(
      question,
      deviceId,
      threadId: threadId,
    );
    final job = RulingJob(
      jobId: submission.jobId,
      question: question,
      status: RulingJobStatus.pending,
      threadId: threadId,
      createdAt: DateTime.now().millisecondsSinceEpoch,
    );
    _jobs.insert(0, job);
    _upsertThreadOptimistic(threadId, question, job, isNewJob: true);
    await _persist();
    notifyListeners();

    _startPolling(submission.jobId);
    return submission.jobId;
  }

  /// スレッド一覧をサーバーから取得し直す(質問画面表示時・アプリ起動時に呼ぶ想定)。
  Future<void> loadThreads() async {
    final deviceId = await deviceIdProvider.getOrCreate();
    final result = await apiClient.getRulingThreads(deviceId);
    _threads
      ..clear()
      ..addAll(result);
    notifyListeners();
  }

  /// スレッド一覧へ即時反映する(サーバーからの最新取得を待たない楽観更新)。
  /// 正式なタイトル・件数等は次回loadThreads()で上書きされる。
  /// isNewJob: 新規投稿(submitQuestion/submitFollowUp)ならtrueでjobCountを+1し、
  /// 既存ジョブの状態更新(refreshJobのポーリング結果)ならfalseでjobCountを変えない。
  void _upsertThreadOptimistic(
    String threadId,
    String question,
    RulingJob job, {
    required bool isNewJob,
  }) {
    final now = DateTime.now().millisecondsSinceEpoch;
    final index = _threads.indexWhere((t) => t.threadId == threadId);
    final latestJob = RulingThreadLatestJob(
      jobId: job.jobId,
      status: job.status.name,
      outcomeStatus: job.outcomeStatus,
      conclusion: job.result?.conclusion,
    );
    if (index >= 0) {
      final existing = _threads.removeAt(index);
      _threads.insert(
        0,
        RulingThreadSummary(
          threadId: existing.threadId,
          title: existing.title,
          createdAt: existing.createdAt,
          updatedAt: now,
          jobCount: isNewJob ? existing.jobCount + 1 : existing.jobCount,
          latestJob: latestJob,
        ),
      );
    } else if (isNewJob) {
      _threads.insert(
        0,
        RulingThreadSummary(
          threadId: threadId,
          title: question,
          createdAt: now,
          updatedAt: now,
          jobCount: 1,
          latestJob: latestJob,
        ),
      );
    }
  }

  Future<void> _setUpPush(String deviceId) async {
    try {
      final token = await pushService.requestPermissionAndGetToken();
      if (token == null) {
        // 許可が下りない/トークンを取得できない場合は失敗として扱い、
        // 次回の質問投稿時に再試行できるよう_pushRegisteredはfalseのままにする。
        return;
      }
      await apiClient.registerPushToken(deviceId, token);
      // ここまで成功して初めて「登録済み」とみなす。
      _pushRegistered = true;
      pushService.listenTokenRefresh((newToken) {
        unawaited(apiClient.registerPushToken(deviceId, newToken));
      });
    } catch (_) {
      // プッシュ通知の初期化に失敗しても、ポーリングでの結果取得は引き続き機能する。
      // _pushRegisteredはfalseのままにして、次回の質問投稿時に再試行させる。
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
    if (updated.threadId != null) {
      _upsertThreadOptimistic(
        updated.threadId!,
        updated.question,
        updated,
        isNewJob: false,
      );
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
    final pendingIds = _jobs
        .where((j) => !j.isFinished)
        .map((j) => j.jobId)
        .toList();
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

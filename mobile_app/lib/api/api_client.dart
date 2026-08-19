import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/card_suggestion.dart';
import '../models/correction.dart';
import '../models/judge.dart';
import '../models/reindex_status.dart';
import '../models/ruling_job.dart';
import '../models/ruling_result.dart';
import '../models/ruling_thread.dart';
import '../models/session.dart';
import 'api_exception.dart';

class RulingJobSubmission {
  final String jobId;
  final String? threadId;

  const RulingJobSubmission({required this.jobId, this.threadId});
}

class ApiClient {
  final String baseUrl;
  final http.Client _client;

  ApiClient({
    this.baseUrl = 'https://dm-ruling-bot.onrender.com',
    http.Client? client,
  }) : _client = client ?? http.Client();

  Map<String, String> _headers([String? token]) => {
        'Content-Type': 'application/json; charset=utf-8',
        if (token != null) 'Authorization': 'Bearer $token',
      };

  Uri _uri(String path, [Map<String, String>? query]) {
    final uri = Uri.parse('$baseUrl$path');
    if (query == null) return uri;
    return uri.replace(queryParameters: query);
  }

  dynamic _decodeBody(http.Response resp) {
    if (resp.body.isEmpty) return null;
    return jsonDecode(utf8.decode(resp.bodyBytes));
  }

  Map<String, dynamic> _handleObject(http.Response resp) {
    final decoded = _decodeBody(resp);
    if (resp.statusCode >= 200 && resp.statusCode < 300) {
      return decoded as Map<String, dynamic>;
    }
    final message = (decoded is Map<String, dynamic> ? decoded['error'] : null)
            ?.toString() ??
        'リクエストに失敗しました (HTTP ${resp.statusCode})';
    throw ApiException(message, statusCode: resp.statusCode);
  }

  Future<RulingResult> getRuling(String question) async {
    http.Response resp;
    try {
      resp = await _client
          .post(
            _uri('/api/ruling'),
            headers: _headers(),
            body: jsonEncode({'question': question}),
          )
          .timeout(const Duration(seconds: 300));
    } on TimeoutException {
      throw const ApiException('サーバーの応答がありませんでした。時間をおいて再度お試しください。');
    }
    // 裁定生成はLLM呼び出しを含み60秒を超える場合があり、Renderのプロキシが
    // タイムアウトして502を返すことがあるが、その場合でも処理自体は完了して
    // レスポンス本体(conclusion等)が正しく返ってくることがあるため、
    // ステータスコードに関わらずconclusionを含む有効なJSONなら採用する。
    final decoded = _decodeBody(resp);
    if (decoded is Map<String, dynamic> && decoded.containsKey('conclusion')) {
      return RulingResult.fromJson(decoded);
    }
    return RulingResult.fromJson(_handleObject(resp));
  }

  /// 質問を非同期ジョブとして投稿する。即座にjobIdが返り、結果は
  /// getRulingJobでポーリングするか、プッシュ通知を受けて取得する。
  /// threadIdを省略した場合はサーバー側で新規スレッドが自動作成され、
  /// 指定した場合はそのスレッドへの追加質問(フォローアップ)として扱われる。
  Future<RulingJobSubmission> submitRulingJob(
    String question,
    String? deviceId, {
    String? threadId,
  }) async {
    final resp = await _client.post(
      _uri('/api/ruling/jobs'),
      headers: _headers(),
      body: jsonEncode({
        'question': question,
        'deviceId': ?deviceId,
        'threadId': ?threadId,
      }),
    );
    final json = _handleObject(resp);
    return RulingJobSubmission(
      jobId: json['jobId'] as String,
      threadId: json['threadId'] as String?,
    );
  }

  Future<RulingJob> getRulingJob(String jobId, {String? question}) async {
    final resp = await _client.get(_uri('/api/ruling/jobs/$jobId'), headers: _headers());
    return RulingJob.fromJson(_handleObject(resp), question: question);
  }

  /// deviceId(匿名端末ID)に紐づくスレッド一覧を、更新日時の新しい順で取得する。
  Future<List<RulingThreadSummary>> getRulingThreads(String deviceId) async {
    final resp = await _client.get(
      _uri('/api/ruling/threads', {'deviceId': deviceId}),
      headers: _headers(),
    );
    final json = _handleObject(resp);
    final list = json['threads'] as List<dynamic>? ?? [];
    return list.map((e) => RulingThreadSummary.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<RulingThreadDetail> getRulingThread(String threadId, String deviceId) async {
    final resp = await _client.get(
      _uri('/api/ruling/threads/$threadId', {'deviceId': deviceId}),
      headers: _headers(),
    );
    return RulingThreadDetail.fromJson(_handleObject(resp));
  }

  Future<void> registerPushToken(String deviceId, String fcmToken) async {
    final resp = await _client.post(
      _uri('/api/push/register-token'),
      headers: _headers(),
      body: jsonEncode({'deviceId': deviceId, 'fcmToken': fcmToken, 'platform': 'android'}),
    );
    if (resp.statusCode == 204) return;
    _handleObject(resp);
  }

  Future<Session> login(String judgeId) async {
    final resp = await _client.post(
      _uri('/api/login'),
      headers: _headers(),
      body: jsonEncode({'judgeId': judgeId}),
    );
    final json = _handleObject(resp);
    return Session.fromLoginResponse(json['token'] as String, json);
  }

  Future<void> logout(String token) async {
    final resp = await _client.post(_uri('/api/logout'), headers: _headers(token));
    _handleObject(resp);
  }

  Future<Session> getSession(String token) async {
    final resp = await _client.get(_uri('/api/session'), headers: _headers(token));
    final json = _handleObject(resp);
    return Session.fromSessionResponse(token, json);
  }

  Future<void> postCorrection({
    required String token,
    required String originalQuestion,
    required String botConclusion,
    required String correctRuling,
  }) async {
    final resp = await _client.post(
      _uri('/api/corrections'),
      headers: _headers(token),
      body: jsonEncode({
        'originalQuestion': originalQuestion,
        'botConclusion': botConclusion,
        'correctRuling': correctRuling,
      }),
    );
    _handleObject(resp);
  }

  /// 自分の訂正一覧を取得する。管理者トークンの場合はサーバー側で
  /// 全ジャッジ分の訂正が返る(ロール分岐はバックエンドが行う)。
  Future<List<Correction>> getCorrections(String token) async {
    final resp = await _client.get(_uri('/api/corrections'), headers: _headers(token));
    final json = _handleObject(resp);
    final list = json['corrections'] as List<dynamic>? ?? [];
    return list.map((e) => Correction.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Correction> updateCorrection({
    required String token,
    required int id,
    required String correctRuling,
  }) async {
    final resp = await _client.patch(
      _uri('/api/corrections/$id'),
      headers: _headers(token),
      body: jsonEncode({'correctRuling': correctRuling}),
    );
    final json = _handleObject(resp);
    return Correction.fromJson(json['correction'] as Map<String, dynamic>);
  }

  Future<void> withdrawCorrection(String token, int id) async {
    final resp = await _client.delete(
      _uri('/api/corrections/$id'),
      headers: _headers(token),
    );
    _handleObject(resp);
  }

  Future<List<Judge>> getJudges(String token) async {
    final resp = await _client.get(_uri('/api/judges'), headers: _headers(token));
    final json = _handleObject(resp);
    final list = json['judges'] as List<dynamic>? ?? [];
    return list.map((e) => Judge.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> addJudge(String token, String judgeId) async {
    final resp = await _client.post(
      _uri('/api/judges'),
      headers: _headers(token),
      body: jsonEncode({'judgeId': judgeId}),
    );
    _handleObject(resp);
  }

  Future<void> removeJudge(String token, String judgeId) async {
    final resp = await _client.delete(
      _uri('/api/judges/$judgeId'),
      headers: _headers(token),
    );
    _handleObject(resp);
  }

  Future<List<CardSuggestion>> suggestCards(String query) async {
    if (query.length < 2) return [];
    final resp = await _client.get(
      _uri('/api/cards/suggest', {'q': query}),
      headers: _headers(),
    );
    final json = _handleObject(resp);
    final list = json['suggestions'] as List<dynamic>? ?? [];
    return list
        .map((e) => CardSuggestion.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> startReindex(String token) async {
    final resp = await _client.post(_uri('/api/cards/reindex'), headers: _headers(token));
    if (resp.statusCode == 202 || resp.statusCode == 409) return;
    _handleObject(resp);
  }

  Future<ReindexStatus> getReindexStatus(String token) async {
    final resp = await _client.get(_uri('/api/cards/reindex/status'), headers: _headers(token));
    return ReindexStatus.fromJson(_handleObject(resp));
  }

  Future<Map<String, dynamic>> checkReindex(String token) async {
    final resp = await _client.post(_uri('/api/cards/reindex/check'), headers: _headers(token));
    return _handleObject(resp);
  }
}

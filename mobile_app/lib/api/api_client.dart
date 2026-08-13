import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/card_suggestion.dart';
import '../models/judge.dart';
import '../models/reindex_status.dart';
import '../models/ruling_result.dart';
import '../models/session.dart';
import 'api_exception.dart';

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
          .timeout(const Duration(seconds: 120));
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

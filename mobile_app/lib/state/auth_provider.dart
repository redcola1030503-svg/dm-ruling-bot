import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';
import '../models/session.dart';

class AuthProvider extends ChangeNotifier {
  static const _tokenKey = 'session_token';

  final ApiClient apiClient;
  final FlutterSecureStorage _storage;

  Session? _session;
  bool _initializing = true;

  AuthProvider({required this.apiClient, FlutterSecureStorage? storage})
      : _storage = storage ?? const FlutterSecureStorage();

  Session? get session => _session;
  bool get isLoggedIn => _session != null;
  bool get isAdmin => _session?.isAdmin ?? false;
  bool get initializing => _initializing;

  Future<void> restoreSession() async {
    String? token;
    try {
      token = await _storage.read(key: _tokenKey);
    } catch (_) {
      token = null;
    }
    if (token != null) {
      try {
        _session = await apiClient.getSession(token);
      } catch (_) {
        try {
          await _storage.delete(key: _tokenKey);
        } catch (_) {}
        _session = null;
      }
    }
    _initializing = false;
    notifyListeners();
  }

  Future<void> login(String judgeId) async {
    final session = await apiClient.login(judgeId);
    await _storage.write(key: _tokenKey, value: session.token);
    _session = session;
    notifyListeners();
  }

  Future<void> logout() async {
    final current = _session;
    _session = null;
    notifyListeners();
    await _storage.delete(key: _tokenKey);
    if (current != null) {
      try {
        await apiClient.logout(current.token);
      } catch (_) {
        // ログアウトはローカル側のトークン破棄を優先し、サーバー側の失敗は無視する
      }
    }
  }
}

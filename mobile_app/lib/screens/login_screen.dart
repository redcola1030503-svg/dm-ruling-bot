import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../state/auth_provider.dart';

class LoginScreen extends StatefulWidget {
  final ApiClient apiClient;

  const LoginScreen({super.key, required this.apiClient});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _judgeIdController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _judgeIdController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    final judgeId = _judgeIdController.text.trim();
    if (judgeId.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await context.read<AuthProvider>().login(judgeId);
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      setState(() {
        _error = e is ApiException ? e.friendlyMessage : 'ログインに失敗しました: $e';
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('ジャッジログイン')),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('公認ジャッジ・管理者のIDを入力してください(パスワードは不要です)。'),
            const SizedBox(height: 16),
            TextField(
              controller: _judgeIdController,
              decoration: const InputDecoration(
                labelText: 'ジャッジID',
                border: OutlineInputBorder(),
              ),
              onSubmitted: (_) => _login(),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _loading ? null : _login,
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('ログイン'),
              ),
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
          ],
        ),
      ),
    );
  }
}

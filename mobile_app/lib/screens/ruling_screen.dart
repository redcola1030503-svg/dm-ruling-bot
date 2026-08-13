import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/ruling_result.dart';
import '../state/auth_provider.dart';
import '../widgets/card_suggest_field.dart';
import '../widgets/ruling_result_view.dart';
import 'correction_dialog.dart';
import 'judges_screen.dart';
import 'card_index_screen.dart';
import 'login_screen.dart';

class RulingScreen extends StatefulWidget {
  final ApiClient apiClient;

  const RulingScreen({super.key, required this.apiClient});

  @override
  State<RulingScreen> createState() => _RulingScreenState();
}

class _RulingScreenState extends State<RulingScreen> {
  final _questionController = TextEditingController();
  final _questionFocusNode = FocusNode();
  RulingResult? _result;
  String? _lastQuestion;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _questionController.dispose();
    _questionFocusNode.dispose();
    super.dispose();
  }

  void _insertCardName(String name) {
    final text = _questionController.text;
    final selection = _questionController.selection;
    final insertion = '《$name》';
    final start = selection.isValid ? selection.start : text.length;
    final end = selection.isValid ? selection.end : text.length;
    final newText = text.replaceRange(start, end, insertion);
    _questionController.value = _questionController.value.copyWith(
      text: newText,
      selection: TextSelection.collapsed(offset: start + insertion.length),
    );
    _questionFocusNode.requestFocus();
  }

  Future<void> _submit() async {
    final question = _questionController.text.trim();
    if (question.isEmpty) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.apiClient.getRuling(question);
      setState(() {
        _result = result;
        _lastQuestion = question;
      });
    } catch (e) {
      setState(() {
        _error = e is ApiException ? e.friendlyMessage : '通信エラーが発生しました: $e';
      });
    } finally {
      setState(() => _loading = false);
    }
  }

  void _openCorrectionDialog() {
    if (_result == null || _lastQuestion == null) return;
    showDialog(
      context: context,
      builder: (_) => CorrectionDialog(
        apiClient: widget.apiClient,
        originalQuestion: _lastQuestion!,
        botConclusion: _result!.conclusion,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('DM裁定確認'),
        actions: [
          if (auth.isLoggedIn)
            PopupMenuButton<String>(
              icon: const Icon(Icons.account_circle),
              onSelected: (value) {
                switch (value) {
                  case 'judges':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => JudgesScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'card_index':
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => CardIndexScreen(apiClient: widget.apiClient),
                      ),
                    );
                    break;
                  case 'logout':
                    context.read<AuthProvider>().logout();
                    break;
                }
              },
              itemBuilder: (context) => [
                PopupMenuItem(
                  enabled: false,
                  child: Text('${auth.session!.judgeId} (${auth.isAdmin ? '管理者' : 'ジャッジ'})'),
                ),
                if (auth.isAdmin) const PopupMenuItem(value: 'judges', child: Text('ジャッジ管理')),
                if (auth.isAdmin) const PopupMenuItem(value: 'card_index', child: Text('カードインデックス管理')),
                const PopupMenuItem(value: 'logout', child: Text('ログアウト')),
              ],
            )
          else
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => LoginScreen(apiClient: widget.apiClient)),
              ),
              child: const Text('ログイン', style: TextStyle(color: Colors.white)),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CardSuggestField(apiClient: widget.apiClient, onSelected: _insertCardName),
            const SizedBox(height: 12),
            TextField(
              controller: _questionController,
              focusNode: _questionFocusNode,
              maxLines: 5,
              decoration: const InputDecoration(
                labelText: '質問を入力',
                hintText: '例: 《ボルメテウス・ホワイト・ドラゴン》でシールドをブレイクした場合、S・トリガーは使えますか？',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _loading ? null : _submit,
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('質問する'),
              ),
            ),
            if (_loading) ...[
              const SizedBox(height: 8),
              Text(
                '公式情報の検索とLLMによる裁定生成には最大1〜2分程度かかることがあります。',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Colors.red)),
            ],
            if (_result != null) ...[
              const SizedBox(height: 16),
              RulingResultView(result: _result!),
              if (auth.isLoggedIn) ...[
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: _openCorrectionDialog,
                  child: const Text('この裁定を訂正する'),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

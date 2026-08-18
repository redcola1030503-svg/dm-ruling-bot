import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/correction.dart';
import '../state/auth_provider.dart';

/// ジャッジは自分の訂正のみ、管理者は全ジャッジの訂正を表示・編集・取り下げできる
/// (どちらを返すかはバックエンドの/api/correctionsがセッションのroleで分岐する)。
class CorrectionsScreen extends StatefulWidget {
  final ApiClient apiClient;

  const CorrectionsScreen({super.key, required this.apiClient});

  @override
  State<CorrectionsScreen> createState() => _CorrectionsScreenState();
}

class _CorrectionsScreenState extends State<CorrectionsScreen> {
  List<Correction> _corrections = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  String? get _token => context.read<AuthProvider>().session?.token;

  Future<void> _load() async {
    final token = _token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final corrections = await widget.apiClient.getCorrections(token);
      setState(() => _corrections = corrections);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.friendlyMessage : '一覧の取得に失敗しました: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _edit(Correction correction) async {
    final token = _token;
    if (token == null) return;
    final controller = TextEditingController(text: correction.correctRuling);
    final newRuling = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('訂正内容を編集'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('質問', style: Theme.of(context).textTheme.labelMedium),
              Text(correction.originalQuestion),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                maxLines: 3,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: '正しい裁定',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('保存'),
          ),
        ],
      ),
    );
    if (newRuling == null || newRuling.isEmpty) return;
    try {
      await widget.apiClient.updateCorrection(
        token: token,
        id: correction.id,
        correctRuling: newRuling,
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '更新に失敗しました: $e')),
      );
    }
  }

  Future<void> _withdraw(Correction correction) async {
    final token = _token;
    if (token == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('取り下げの確認'),
        content: const Text('この訂正を取り下げますか？取り下げた訂正は以後の裁定生成の参考情報として使われなくなります。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('取り下げる'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.apiClient.withdrawCorrection(token, correction.id);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '取り下げに失敗しました: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAdmin = context.watch<AuthProvider>().isAdmin;
    return Scaffold(
      appBar: AppBar(title: Text(isAdmin ? '訂正内容(全ジャッジ)' : '自分の訂正内容')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : _corrections.isEmpty
                  ? const Center(child: Text('訂正はまだありません'))
                  : RefreshIndicator(
                      onRefresh: _load,
                      child: ListView.builder(
                        itemCount: _corrections.length,
                        itemBuilder: (context, index) {
                          final correction = _corrections[index];
                          return Card(
                            margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            child: Padding(
                              padding: const EdgeInsets.all(12),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    correction.originalQuestion,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: Theme.of(context).textTheme.titleSmall,
                                  ),
                                  const SizedBox(height: 6),
                                  Text('正しい裁定', style: Theme.of(context).textTheme.labelSmall),
                                  Text(correction.correctRuling),
                                  if (isAdmin) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      'ジャッジ: ${correction.judgeId}',
                                      style: Theme.of(context).textTheme.labelSmall,
                                    ),
                                  ],
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(Icons.edit_outlined),
                                          tooltip: '編集',
                                          onPressed: () => _edit(correction),
                                        ),
                                        IconButton(
                                          icon: const Icon(Icons.delete_outline),
                                          tooltip: '取り下げ',
                                          onPressed: () => _withdraw(correction),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
    );
  }
}

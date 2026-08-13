import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/judge.dart';
import '../state/auth_provider.dart';

class JudgesScreen extends StatefulWidget {
  final ApiClient apiClient;

  const JudgesScreen({super.key, required this.apiClient});

  @override
  State<JudgesScreen> createState() => _JudgesScreenState();
}

class _JudgesScreenState extends State<JudgesScreen> {
  List<Judge> _judges = [];
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
      final judges = await widget.apiClient.getJudges(token);
      setState(() => _judges = judges);
    } catch (e) {
      setState(() => _error = e is ApiException ? e.friendlyMessage : '一覧の取得に失敗しました: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _addJudge() async {
    final token = _token;
    if (token == null) return;
    final controller = TextEditingController();
    final judgeId = await showDialog<String>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('ジャッジを追加'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'ジャッジID'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(controller.text.trim()),
            child: const Text('追加'),
          ),
        ],
      ),
    );
    if (judgeId == null || judgeId.isEmpty) return;
    try {
      await widget.apiClient.addJudge(token, judgeId);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '追加に失敗しました: $e')),
      );
    }
  }

  Future<void> _removeJudge(Judge judge) async {
    final token = _token;
    if (token == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('削除の確認'),
        content: Text('ジャッジ「${judge.id}」を削除しますか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('削除'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.apiClient.removeJudge(token, judge.id);
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '削除に失敗しました: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final myJudgeId = context.watch<AuthProvider>().session?.judgeId;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ジャッジ管理'),
        actions: [
          IconButton(onPressed: _addJudge, icon: const Icon(Icons.person_add)),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    itemCount: _judges.length,
                    itemBuilder: (context, index) {
                      final judge = _judges[index];
                      final isSelf = judge.id == myJudgeId;
                      return ListTile(
                        leading: Icon(
                          judge.role == 'admin' ? Icons.shield : Icons.gavel,
                        ),
                        title: Text(judge.id),
                        subtitle: Text(judge.role == 'admin' ? '管理者' : 'ジャッジ'),
                        trailing: isSelf
                            ? const Tooltip(message: '自分自身は削除できません', child: Icon(Icons.lock_outline))
                            : IconButton(
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () => _removeJudge(judge),
                              ),
                      );
                    },
                  ),
                ),
    );
  }
}

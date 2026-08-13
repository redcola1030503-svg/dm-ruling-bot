import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/reindex_status.dart';
import '../state/auth_provider.dart';

class CardIndexScreen extends StatefulWidget {
  final ApiClient apiClient;

  const CardIndexScreen({super.key, required this.apiClient});

  @override
  State<CardIndexScreen> createState() => _CardIndexScreenState();
}

class _CardIndexScreenState extends State<CardIndexScreen> {
  ReindexStatus? _status;
  bool _loading = true;
  String? _error;
  Timer? _poller;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _poller?.cancel();
    super.dispose();
  }

  String? get _token => context.read<AuthProvider>().session?.token;

  Future<void> _refresh() async {
    final token = _token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final status = await widget.apiClient.getReindexStatus(token);
      setState(() => _status = status);
      _updatePolling();
    } catch (e) {
      setState(() => _error = e is ApiException ? e.friendlyMessage : '状態取得に失敗しました: $e');
    } finally {
      setState(() => _loading = false);
    }
  }

  void _updatePolling() {
    final running = _status?.status == 'running';
    if (running && _poller == null) {
      _poller = Timer.periodic(const Duration(seconds: 5), (_) => _refresh());
    } else if (!running && _poller != null) {
      _poller?.cancel();
      _poller = null;
    }
  }

  Future<void> _startReindex() async {
    final token = _token;
    if (token == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('全件再構築の確認'),
        content: const Text(
          '全カード(約1万件超)を公式サイトからクロールし直します。'
          'レート制限のため最大約1.6時間かかります。実行しますか？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('実行'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await widget.apiClient.startReindex(token);
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '開始に失敗しました: $e')),
      );
    }
  }

  Future<void> _checkForUpdates() async {
    final token = _token;
    if (token == null) return;
    try {
      final result = await widget.apiClient.checkReindex(token);
      if (!mounted) return;
      final hasUpdate = result['hasUpdate'] == true;
      final message = hasUpdate
          ? '新カードの可能性を検知し、再構築を開始しました(${result['previousCount']} → ${result['currentCount']})'
          : '新カードは検知されませんでした(現在 ${result['currentCount']} 件)';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
      await _refresh();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : 'チェックに失敗しました: $e')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _status;
    return Scaffold(
      appBar: AppBar(title: const Text('カードインデックス管理')),
      body: _loading && status == null
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(_error!, style: const TextStyle(color: Colors.red)),
                    ),
                  if (status != null) _buildStatusCard(status),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: status?.status == 'running' ? null : _startReindex,
                    icon: const Icon(Icons.refresh),
                    label: const Text('全件再構築を開始'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: status?.status == 'running' ? null : _checkForUpdates,
                    icon: const Icon(Icons.fact_check_outlined),
                    label: const Text('新カードの有無を軽量チェック'),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildStatusCard(ReindexStatus status) {
    switch (status.status) {
      case 'running':
        final processed = status.processed ?? 0;
        final total = status.total ?? 0;
        final progress = total > 0 ? processed / total : null;
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('実行中', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                LinearProgressIndicator(value: progress),
                const SizedBox(height: 8),
                Text('$processed / $total 件処理済み'),
                Text('更新: ${status.updated ?? 0} / スキップ: ${status.skipped ?? 0} / 失敗: ${status.failed ?? 0}'),
              ],
            ),
          ),
        );
      case 'completed':
        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('前回完了', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                Text('全 ${status.totalCount ?? 0} 件中 更新 ${status.updated ?? 0} / スキップ ${status.skipped ?? 0} / 失敗 ${status.failed ?? 0}'),
              ],
            ),
          ),
        );
      default:
        return const Card(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Text('未実行'),
          ),
        );
    }
  }
}

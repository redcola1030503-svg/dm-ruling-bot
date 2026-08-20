import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/card_query_stat.dart';
import '../models/correction.dart';
import '../models/source_reference_stat.dart';
import '../state/auth_provider.dart';
import '../utils/external_links.dart';

class _SourceTypeTab {
  final String type;
  final String label;
  const _SourceTypeTab(this.type, this.label);
}

const _sourceTypeTabs = [
  _SourceTypeTab('generalRule', '総合ルール'),
  _SourceTypeTab('qa', 'Q&A'),
  _SourceTypeTab('ruleChange', 'ルール変更'),
  _SourceTypeTab('correction', '訂正事例'),
];

/// 管理者向けの利用統計画面。「カード」タブはカード名が質問された回数、
/// それ以外のタブは各種別で実際に裁定の根拠として参照された個別項目の
/// 回数を、多い順のランキングで表示する。各項目はタップすると、種別に
/// 応じて出典を確認できる(カード名はdm-wiki、Q&A・ルール変更は該当ページ、
/// 総合ルール・訂正事例はその場で全文を表示)。
class UsageStatsScreen extends StatefulWidget {
  final ApiClient apiClient;

  const UsageStatsScreen({super.key, required this.apiClient});

  @override
  State<UsageStatsScreen> createState() => _UsageStatsScreenState();
}

class _UsageStatsScreenState extends State<UsageStatsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  List<CardQueryStat> _cardStats = [];
  final Map<String, List<SourceReferenceStat>> _sourceStats = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _sourceTypeTabs.length + 1, vsync: this);
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  // 利用統計は一般ユーザーも閲覧できる公開情報。ログイン済みならトークンを
  // 添えるが、未ログイン(token null)でも閲覧できる。
  String? get _token => context.read<AuthProvider>().session?.token;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cardStats = await widget.apiClient.getCardQueryStats(token: _token);
      final sourceEntries = await Future.wait(
        _sourceTypeTabs.map(
          (tab) => widget.apiClient.getSourceReferenceStats(tab.type, token: _token),
        ),
      );
      if (!mounted) return;
      setState(() {
        _cardStats = cardStats;
        for (var i = 0; i < _sourceTypeTabs.length; i++) {
          _sourceStats[_sourceTypeTabs[i].type] = sourceEntries[i];
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e is ApiException ? e.friendlyMessage : '統計の取得に失敗しました: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openCardStat(CardQueryStat stat) {
    openExternalUri(context, buildDmWikiUri(stat.cardName));
  }

  void _openSourceStat(SourceReferenceStat stat) {
    switch (stat.sourceType) {
      case 'qa':
      case 'ruleChange':
        if (stat.url.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('この項目にはリンクがありません')),
          );
          return;
        }
        openExternalUri(context, Uri.parse(stat.url));
        break;
      case 'generalRule':
        _showGeneralRuleDialog(stat);
        break;
      case 'correction':
        _showCorrectionDialog(stat);
        break;
    }
  }

  Future<void> _showGeneralRuleDialog(SourceReferenceStat stat) async {
    await _runWithLoadingDialog(() async {
      final text = await widget.apiClient.getGeneralRuleText(stat.itemKey, token: _token);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => AlertDialog(
          title: Text('総合ルール ${stat.itemKey}'),
          content: SingleChildScrollView(child: SelectableText(text)),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('閉じる'),
            ),
          ],
        ),
      );
    });
  }

  Future<void> _showCorrectionDialog(SourceReferenceStat stat) async {
    final id = int.tryParse(stat.itemKey);
    if (id == null) return;
    await _runWithLoadingDialog(() async {
      final correction = await widget.apiClient.getCorrection(id, token: _token);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => _CorrectionDetailDialog(correction: correction),
      );
    });
  }

  /// 非同期取得中は閉じられないローディングダイアログを出し、完了・失敗どちらでも閉じる。
  Future<void> _runWithLoadingDialog(Future<void> Function() action) async {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator()),
    );
    try {
      await action();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e is ApiException ? e.friendlyMessage : '取得に失敗しました: $e')),
      );
    } finally {
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('利用統計'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          labelColor: Colors.white,
          unselectedLabelColor: Colors.white70,
          indicatorColor: Colors.white,
          tabs: [
            const Tab(text: 'カード'),
            for (final tab in _sourceTypeTabs) Tab(text: tab.label),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildCardList(),
                      for (final tab in _sourceTypeTabs)
                        _buildSourceList(_sourceStats[tab.type] ?? []),
                    ],
                  ),
                ),
    );
  }

  Widget _buildCardList() {
    if (_cardStats.isEmpty) {
      return ListView(children: const [_EmptyHint()]);
    }
    return ListView.builder(
      itemCount: _cardStats.length,
      itemBuilder: (context, index) {
        final stat = _cardStats[index];
        return ListTile(
          leading: CircleAvatar(child: Text('${index + 1}')),
          title: Text(stat.cardName),
          trailing: Text('${stat.queryCount}回'),
          onTap: () => _openCardStat(stat),
        );
      },
    );
  }

  Widget _buildSourceList(List<SourceReferenceStat> stats) {
    if (stats.isEmpty) {
      return ListView(children: const [_EmptyHint()]);
    }
    return ListView.builder(
      itemCount: stats.length,
      itemBuilder: (context, index) {
        final stat = stats[index];
        return ListTile(
          leading: CircleAvatar(child: Text('${index + 1}')),
          title: Text(
            stat.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          trailing: Text('${stat.referenceCount}回'),
          onTap: () => _openSourceStat(stat),
        );
      },
    );
  }
}

class _CorrectionDetailDialog extends StatelessWidget {
  final Correction correction;

  const _CorrectionDetailDialog({required this.correction});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('訂正事例'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('質問', style: theme.textTheme.labelMedium),
            SelectableText(correction.originalQuestion),
            const SizedBox(height: 12),
            Text('Botの回答(訂正前)', style: theme.textTheme.labelMedium),
            SelectableText(correction.botConclusion),
            const SizedBox(height: 12),
            Text('正しい裁定', style: theme.textTheme.labelMedium),
            SelectableText(correction.correctRuling),
            const SizedBox(height: 12),
            Text('訂正したジャッジ: ${correction.judgeId}', style: theme.textTheme.labelSmall),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('閉じる'),
        ),
      ],
    );
  }
}

class _EmptyHint extends StatelessWidget {
  const _EmptyHint();

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.only(top: 48),
      child: Center(child: Text('まだ記録がありません')),
    );
  }
}

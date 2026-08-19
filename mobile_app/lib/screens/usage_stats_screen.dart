import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_client.dart';
import '../api/api_exception.dart';
import '../models/card_query_stat.dart';
import '../models/source_reference_stat.dart';
import '../state/auth_provider.dart';

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
/// 回数を、多い順のランキングで表示する。
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

  String? get _token => context.read<AuthProvider>().session?.token;

  Future<void> _load() async {
    final token = _token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cardStats = await widget.apiClient.getCardQueryStats(token);
      final sourceEntries = await Future.wait(
        _sourceTypeTabs.map((tab) => widget.apiClient.getSourceReferenceStats(token, tab.type)),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('利用統計'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
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
        );
      },
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

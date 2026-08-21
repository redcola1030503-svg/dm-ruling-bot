import 'dart:async';

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

  // 総合ルール/Q&A/ルール変更タブのキーワード検索用(訂正事例・カードは対象外)。
  final Map<String, TextEditingController> _searchControllers = {};
  final Map<String, List<SourceReferenceStat>> _searchResults = {};
  final Map<String, bool> _searching = {};
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(
      length: _sourceTypeTabs.length + 1,
      vsync: this,
    );
    _load();
  }

  @override
  void dispose() {
    _tabController.dispose();
    _debounceTimer?.cancel();
    for (final controller in _searchControllers.values) {
      controller.dispose();
    }
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
          (tab) =>
              widget.apiClient.getSourceReferenceStats(tab.type, token: _token),
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
      setState(
        () =>
            _error = e is ApiException ? e.friendlyMessage : '統計の取得に失敗しました: $e',
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onSearchChanged(String type, String query) {
    setState(() {}); // 入力欄のクリアボタン表示・表示リスト切り替えを即時反映する
    _debounceTimer?.cancel();
    if (query.trim().isEmpty) {
      setState(() => _searchResults.remove(type));
      return;
    }
    _debounceTimer = Timer(
      const Duration(milliseconds: 300),
      () => _runSearch(type, query),
    );
  }

  Future<void> _runSearch(String type, String query) async {
    setState(() => _searching[type] = true);
    try {
      final results = await widget.apiClient.getSourceReferenceStats(
        type,
        token: _token,
        query: query,
      );
      if (!mounted) return;
      setState(() => _searchResults[type] = results);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e is ApiException ? e.friendlyMessage : '検索に失敗しました: $e',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _searching[type] = false);
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
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(const SnackBar(content: Text('この項目にはリンクがありません')));
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
      final text = await widget.apiClient.getGeneralRuleText(
        stat.itemKey,
        token: _token,
      );
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
      final correction = await widget.apiClient.getCorrection(
        id,
        token: _token,
      );
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
        SnackBar(
          content: Text(
            e is ApiException ? e.friendlyMessage : '取得に失敗しました: $e',
          ),
        ),
      );
    } finally {
      if (mounted) Navigator.of(context, rootNavigator: true).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(
        title: const Text('ルール確認&利用統計'),
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelColor: colorScheme.onPrimary,
          unselectedLabelColor: colorScheme.onSurfaceVariant,
          dividerColor: Colors.transparent,
          indicatorSize: TabBarIndicatorSize.tab,
          indicatorPadding: const EdgeInsets.symmetric(vertical: 6),
          indicator: BoxDecoration(
            color: colorScheme.primary,
            borderRadius: BorderRadius.circular(999),
          ),
          tabs: [
            const Tab(text: 'カード'),
            for (final tab in _sourceTypeTabs) Tab(text: tab.label),
          ],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
          ? Center(
              child: Text(_error!, style: const TextStyle(color: Colors.red)),
            )
          : RefreshIndicator(
              onRefresh: _load,
              child: TabBarView(
                controller: _tabController,
                children: [
                  _buildCardList(),
                  for (final tab in _sourceTypeTabs)
                    tab.type == 'correction'
                        ? _buildSourceList(_sourceStats[tab.type] ?? [])
                        : _buildSourceTab(tab.type),
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

  /// 総合ルール/Q&A/ルール変更タブ: 上部にキーワード検索欄を表示し、入力が
  /// 空なら参照回数ランキング、入力があれば検索結果をその下(同じ位置)に表示する。
  Widget _buildSourceTab(String type) {
    final controller = _searchControllers.putIfAbsent(
      type,
      () => TextEditingController(),
    );
    final isSearching = controller.text.trim().isNotEmpty;
    final displayList = isSearching
        ? (_searchResults[type] ?? [])
        : (_sourceStats[type] ?? []);
    final showPreview = type == 'generalRule';

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: TextField(
            controller: controller,
            decoration: InputDecoration(
              hintText: 'キーワードで検索',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: controller.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear),
                      onPressed: () {
                        controller.clear();
                        _onSearchChanged(type, '');
                      },
                    )
                  : null,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onChanged: (value) => _onSearchChanged(type, value),
          ),
        ),
        if (_searching[type] == true)
          const LinearProgressIndicator(minHeight: 2),
        Expanded(
          child: displayList.isEmpty
              ? ListView(
                  children: [
                    _EmptyHint(
                      text: isSearching ? '該当する項目が見つかりません' : 'まだ記録がありません',
                    ),
                  ],
                )
              : ListView.builder(
                  itemCount: displayList.length,
                  itemBuilder: (context, index) {
                    final stat = displayList[index];
                    return ListTile(
                      leading: CircleAvatar(child: Text('${index + 1}')),
                      title: Text(
                        stat.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: showPreview && (stat.preview ?? '').isNotEmpty
                          ? Text(
                              stat.preview!,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall,
                            )
                          : null,
                      isThreeLine:
                          showPreview && (stat.preview ?? '').isNotEmpty,
                      trailing: Text('${stat.referenceCount}回'),
                      onTap: () => _openSourceStat(stat),
                    );
                  },
                ),
        ),
      ],
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
          title: Text(stat.title, maxLines: 2, overflow: TextOverflow.ellipsis),
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
            Text(
              '訂正したジャッジ: ${correction.judgeId}',
              style: theme.textTheme.labelSmall,
            ),
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
  final String text;
  const _EmptyHint({this.text = 'まだ記録がありません'});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 48),
      child: Center(child: Text(text)),
    );
  }
}

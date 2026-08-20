import 'package:flutter/material.dart';

import '../models/ruling_result.dart';
import '../utils/external_links.dart';
import 'confidence_badge.dart';

/// APIレスポンスのcards/sourcesは要素の型が固定されていないため、
/// Mapであれば代表的なキー(name/title/url等)を推測して表示する。
class RulingResultView extends StatelessWidget {
  final RulingResult result;

  const RulingResultView({super.key, required this.result});

  /// ツインパクトカードは各面の名前(例: "A", "B")と統合名(例: "A / B")が
  /// 別要素として混在して返ってくるため、他の要素に部分文字列として
  /// 含まれる名前は除外し、統合名だけを表示する。
  List<String> get _dedupedCardNames {
    final names = result.cards.map(_describe).toList();
    return names
        .where((name) => !names.any((other) => other != name && other.contains(name)))
        .toList();
  }

  String _describe(dynamic item) {
    if (item is String) return item;
    if (item is Map) {
      final name = item['name'] ?? item['title'] ?? item['url'];
      if (name != null) return name.toString();
      return item.toString();
    }
    return item.toString();
  }

  String? _sourceUrl(dynamic item) {
    // 過去の訂正事例などWebページを持たない出典はurlが空文字で返るため、
    // リンクとして扱わずタイトルのみのテキスト表示にする。
    if (item is Map && item['url'] != null && (item['url'] as String).isNotEmpty) {
      return item['url'].toString();
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text('結論', style: theme.textTheme.labelLarge),
                ),
                ConfidenceBadge(confidence: result.confidence),
              ],
            ),
            const SizedBox(height: 4),
            SelectableText(result.conclusion, style: theme.textTheme.titleMedium),
            const SizedBox(height: 16),
            Text('説明', style: theme.textTheme.labelLarge),
            const SizedBox(height: 4),
            SelectableText(result.explanation),
            if (result.steps.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('推論ステップ', style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              ...result.steps.map(
                (s) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: SelectableText('• $s'),
                ),
              ),
            ],
            if (_dedupedCardNames.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('関連カード', style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _dedupedCardNames
                    .map(
                      (name) => ActionChip(
                        label: Text(name),
                        onPressed: () => openExternalUri(context, buildDmWikiUri(name)),
                      ),
                    )
                    .toList(),
              ),
            ],
            if (result.sources.isNotEmpty) ...[
              const SizedBox(height: 16),
              Text('根拠(出典)', style: theme.textTheme.labelLarge),
              const SizedBox(height: 4),
              ...result.sources.map((s) {
                final url = _sourceUrl(s);
                final textWidget = Text(
                  '- ${_describe(s)}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: url != null ? theme.colorScheme.primary : null,
                    decoration: url != null ? TextDecoration.underline : null,
                  ),
                );
                return Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: url != null
                      ? InkWell(
                          onTap: () => openExternalUri(context, Uri.parse(url)),
                          child: textWidget,
                        )
                      : textWidget,
                );
              }),
            ],
          ],
        ),
      ),
    );
  }
}

/// 総合ルール条文・公式Q&A・ルール変更・訂正事例・カードのうち、実際に裁定の
/// 根拠(sources)として採用された個別項目1件分の参照統計。
class SourceReferenceStat {
  final String sourceType;
  final String itemKey;
  final String title;
  final String url;
  final int referenceCount;
  final int lastReferencedAt;
  /// 総合ルールのみ設定される、条文本文(一覧でのプレビュー表示用)。
  final String? preview;

  const SourceReferenceStat({
    required this.sourceType,
    required this.itemKey,
    required this.title,
    required this.url,
    required this.referenceCount,
    required this.lastReferencedAt,
    this.preview,
  });

  factory SourceReferenceStat.fromJson(Map<String, dynamic> json) {
    return SourceReferenceStat(
      sourceType: json['sourceType'] as String,
      itemKey: json['itemKey'] as String,
      title: json['title'] as String,
      url: json['url'] as String,
      referenceCount: json['referenceCount'] as int,
      lastReferencedAt: json['lastReferencedAt'] as int,
      preview: json['preview'] as String?,
    );
  }
}

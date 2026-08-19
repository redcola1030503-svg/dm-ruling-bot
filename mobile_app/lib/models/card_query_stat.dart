class CardQueryStat {
  final String cardId;
  final String cardName;
  final String cardUrl;
  final int queryCount;
  final int lastQueriedAt;

  const CardQueryStat({
    required this.cardId,
    required this.cardName,
    required this.cardUrl,
    required this.queryCount,
    required this.lastQueriedAt,
  });

  factory CardQueryStat.fromJson(Map<String, dynamic> json) {
    return CardQueryStat(
      cardId: json['cardId'] as String,
      cardName: json['cardName'] as String,
      cardUrl: json['cardUrl'] as String,
      queryCount: json['queryCount'] as int,
      lastQueriedAt: json['lastQueriedAt'] as int,
    );
  }
}

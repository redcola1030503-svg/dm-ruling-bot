class Correction {
  final int id;
  final String originalQuestion;
  final String botConclusion;
  final String correctRuling;
  final List<String> cardNames;
  final String correctedBy;
  final String judgeId;
  final int createdAt;

  const Correction({
    required this.id,
    required this.originalQuestion,
    required this.botConclusion,
    required this.correctRuling,
    required this.cardNames,
    required this.correctedBy,
    required this.judgeId,
    required this.createdAt,
  });

  factory Correction.fromJson(Map<String, dynamic> json) {
    return Correction(
      id: json['id'] as int,
      originalQuestion: json['originalQuestion'] as String,
      botConclusion: json['botConclusion'] as String,
      correctRuling: json['correctRuling'] as String,
      cardNames: (json['cardNames'] as List<dynamic>? ?? [])
          .map((e) => e as String)
          .toList(),
      correctedBy: json['correctedBy'] as String,
      judgeId: json['judgeId'] as String,
      createdAt: json['createdAt'] as int,
    );
  }
}

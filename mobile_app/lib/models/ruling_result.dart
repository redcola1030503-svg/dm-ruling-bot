class RulingResult {
  final String conclusion;
  final String explanation;
  final List<String> steps;
  final String confidence;
  final List<dynamic> cards;
  final List<dynamic> sources;

  const RulingResult({
    required this.conclusion,
    required this.explanation,
    required this.steps,
    required this.confidence,
    required this.cards,
    required this.sources,
  });

  factory RulingResult.fromJson(Map<String, dynamic> json) {
    return RulingResult(
      conclusion: json['conclusion'] as String? ?? '',
      explanation: json['explanation'] as String? ?? '',
      steps: (json['steps'] as List<dynamic>? ?? []).map((e) => e.toString()).toList(),
      confidence: json['confidence'] as String? ?? 'low',
      cards: json['cards'] as List<dynamic>? ?? [],
      sources: json['sources'] as List<dynamic>? ?? [],
    );
  }
}

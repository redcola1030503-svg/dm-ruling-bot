class CardSuggestion {
  final String id;
  final String name;

  const CardSuggestion({required this.id, required this.name});

  factory CardSuggestion.fromJson(Map<String, dynamic> json) {
    return CardSuggestion(
      id: json['id'] as String,
      name: json['name'] as String,
    );
  }
}
